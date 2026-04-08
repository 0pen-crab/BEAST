import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { findSessionByToken } from '../orchestrator/entities.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: number;
      username: string;
      role: string;
      displayName: string | null;
      mustChangePassword: boolean;
    };
    /** Set to true by authorize() calls. Safety net checks this. */
    authorized: boolean;
  }
}

const SKIP_AUTH = new Set([
  'GET /api/health',
  'GET /api/auth/setup-status',
  'POST /api/auth/setup',
  'POST /api/auth/login',
  'POST /api/auth/logout',
]);

function shouldSkipAuth(method: string, url: string): boolean {
  const path = url.split('?')[0];
  if (SKIP_AUTH.has(`${method} ${path}`)) return true;
  if (path.startsWith('/api/webhooks/')) return true;
  if (path === '/api/worker/pause') return true;
  if (path === '/api/worker/resume') return true;
  if (path === '/api/worker-status') return true;
  if (path === '/api/claude-status') return true;
  if (path.startsWith('/api-docs')) return true;
  return false;
}

/**
 * Authentication hook — runs on every request.
 * Identifies the user from token. Does NOT authorize.
 */
export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Every request starts unauthorized
  request.authorized = false;

  if (shouldSkipAuth(request.method, request.url)) {
    request.authorized = true; // public endpoints are pre-authorized
    return;
  }

  const authHeader = request.headers['authorization'];
  const token = authHeader?.replace(/^Token\s+/i, '').replace(/^Bearer\s+/i, '');

  if (!token) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const session = await findSessionByToken(token);
  if (!session) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  request.user = {
    id: session.userId,
    username: session.username,
    role: session.role ?? 'user',
    displayName: session.displayName ?? null,
    mustChangePassword: session.mustChangePassword ?? false,
  };
}

/**
 * Safety net — runs after every response.
 * If a handler returned 2xx without calling authorize(), it's a security bug.
 */
export function registerSafetyNet(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    if (!request.authorized && reply.statusCode >= 200 && reply.statusCode < 400) {
      const url = request.url.split('?')[0];
      console.error(`[SECURITY] ${request.method} ${url} responded ${reply.statusCode} without authorization — this is a bug`);
      reply.status(500);
      return JSON.stringify({ error: 'Internal authorization error' });
    }
    return payload;
  });
}
