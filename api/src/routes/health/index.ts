import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { hasOpenInfraIssues } from '../../orchestrator/infra-check.ts';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/health', async (_request, reply) => {
    let infra: Awaited<ReturnType<typeof hasOpenInfraIssues>>;
    try {
      infra = await hasOpenInfraIssues();
    } catch (err) {
      console.error('[health] infra check query failed:', err);
      // The API is up — don't pretend it isn't because of a transient query
      // failure. The infra-check itself stays diagnosable via worker logs.
      return { status: 'ok', timestamp: new Date().toISOString() };
    }

    if (infra.degraded) {
      return reply.status(503).send({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        issues: infra.issues,
      });
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
};
