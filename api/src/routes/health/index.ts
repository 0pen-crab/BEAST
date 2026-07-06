import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { checkAllSystems } from './checks.ts';

/**
 * GET /api/health — full-system health (maintainer decision: the health
 * endpoint must verify EVERY system and name what's broken).
 *
 *   200 { status: 'ok', timestamp }                       — all systems healthy
 *   503 { status: 'degraded' | 'down', timestamp,
 *         failures: [{ system, message }] }               — at least one broken
 *
 * system ∈ 'db' | 'worker' | 'claude-runner' | 'security-tools'.
 * The route is on the auth skip-list (middleware/auth.ts) — dashboards poll it
 * every 10s, including from the login screen.
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/health', async (_request, reply) => {
    const result = await checkAllSystems();
    const timestamp = new Date().toISOString();

    if (result.status === 'ok') {
      return { status: 'ok', timestamp };
    }
    return reply.status(503).send({
      status: result.status,
      timestamp,
      failures: result.failures,
    });
  });
};
