import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export interface WorkerStatus {
  paused: boolean;
  reason?: string;
  resumesAt?: string;
  pausedAt?: string;
}

let status: WorkerStatus = { paused: false };

export function getWorkerStatus(): WorkerStatus {
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

  // Manual resume
  app.post('/worker/resume', async (request, reply) => {
    request.authorized = true;
    resumeWorker();
    return { ok: true };
  });
};
