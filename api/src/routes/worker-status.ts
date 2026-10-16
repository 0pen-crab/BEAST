import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { findSessionByToken } from '../orchestrator/entities.ts';

export interface WorkerStatus {
  paused: boolean;
  reason?: string;
  resumesAt?: string;
  pausedAt?: string;
}

let status: WorkerStatus = { paused: false };

/**
 * Auto-resume timed pauses. Overload pauses set resumesAt = now + 2min, but the
 * only other unpause path was the 30-min Claude probe — a transient 529 could
 * stall the whole queue for half an hour. If the pause window has passed, clear
 * the pause state. Manual pauses (no resumesAt) are never auto-cleared.
 */
function clearExpiredPause(): void {
  if (!status.paused || !status.resumesAt) return;
  const resumesAtMs = Date.parse(status.resumesAt);
  if (!Number.isNaN(resumesAtMs) && resumesAtMs <= Date.now()) {
    console.log(`[worker-status] Pause window expired (resumesAt=${status.resumesAt}) — auto-resuming`);
    status = { paused: false };
  }
}

export function getWorkerStatus(): WorkerStatus {
  clearExpiredPause();
  return { ...status };
}

export function pauseWorker(reason: string, resumesAt?: string): void {
  status = { paused: true, reason, resumesAt, pausedAt: new Date().toISOString() };
  console.log(`[worker-status] Paused: ${reason}${resumesAt ? ` (resumes at ${resumesAt})` : ''}`);
}

export function resumeWorker(): void {
  if (status.paused) {
    console.log('[worker-status] Resumed');
  }
  status = { paused: false };
}

export function isWorkerPaused(): boolean {
  clearExpiredPause();
  return status.paused;
}

export const workerStatusRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public status endpoint (auth still required via global hook)
  app.get('/worker-status', async (request) => {
    request.authorized = true;
    return getWorkerStatus();
  });

  // Called by claude-runner hook when rate limit hit (internal token auth)
  app.post('/worker/pause', async (request, reply) => {
    request.authorized = true;
    const token = (request.headers['x-internal-token'] ?? '') as string;
    const expected = process.env.INTERNAL_TOKEN ?? '';
    if (!expected || token !== expected) {
      return reply.status(401).send({ error: 'Invalid internal token' });
    }
    const body = request.body as { reason?: string; resumesAt?: string } | null;
    pauseWorker(body?.reason ?? 'rate_limit', body?.resumesAt);
    return { ok: true };
  });

  // Manual resume. Two callers, two auth paths (without either, anyone who
  // can reach the API could unpause the queue):
  //  - the worker process, authenticating with the internal token;
  //  - the dashboard "Resume now" button, authenticating with a user session
  //    (this route is on the auth-middleware skip-list, so validate it here).
  app.post('/worker/resume', async (request, reply) => {
    request.authorized = true;
    const token = (request.headers['x-internal-token'] ?? '') as string;
    const expected = process.env.INTERNAL_TOKEN ?? '';
    if (expected && token === expected) {
      resumeWorker();
      return { ok: true };
    }
    const authHeader = request.headers['authorization'];
    const sessionToken = authHeader?.replace(/^Token\s+/i, '').replace(/^Bearer\s+/i, '');
    const session = sessionToken ? await findSessionByToken(sessionToken) : null;
    if (session) {
      resumeWorker();
      return { ok: true };
    }
    return reply.status(401).send({ error: 'Unauthorized' });
  });
};
