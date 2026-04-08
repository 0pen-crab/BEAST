import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  validatorCompiler,
  serializerCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { healthRoutes } from './routes/health/index.ts';
import { authRoutes } from './routes/auth.ts';
import { scanRoutes } from './routes/scans.ts';
import { scanEventRoutes } from './routes/scan-events.ts';
import { engagementReportRoutes } from './routes/engagement-reports.ts';
import { contributorRoutes } from './routes/contributors.ts';
import { workspaceRoutes } from './routes/workspaces.ts';
import { workspaceDataRoutes } from './routes/workspace-data.ts';
import { sourceRoutes } from './routes/sources.ts';
import { workspaceEventRoutes } from './routes/workspace-events.ts';
import { pullRequestRoutes } from './routes/pull-requests.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { memberRoutes } from './routes/members.ts';
import { adminRoutes } from './routes/admin.ts';
import { workspaceToolRoutes } from './routes/workspace-tools.ts';
import { claudeStatusRoutes } from './routes/claude-status.ts';
import { workerStatusRoutes } from './routes/worker-status.ts';
import { highlightsRoutes } from './routes/highlights.ts';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './db/index.ts';
import { createWorkspaceEvent } from './orchestrator/entities.ts';
import { authHook, registerSafetyNet } from './middleware/auth.ts';
import { ForbiddenError } from './lib/authorize.ts';
import { PROVIDER_SECRETS } from './lib/provider-secrets.ts';

export function buildApp() {
  const encryptionKey = process.env.ENCRYPTION_KEY ?? '';
  if (encryptionKey.length !== 64) {
    console.error('[FATAL] ENCRYPTION_KEY must be a 64-character hex string. Set it in .env or run make install.');
    process.exit(1);
  }

  const app = Fastify({ logger: true });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, { origin: true });
  app.register(sensible);
  app.register(multipart, { limits: { fileSize: Infinity } });

  app.register(swagger, {
    openapi: {
      info: { title: 'BEAST API', version: '0.1.0' },
    },
    transform: jsonSchemaTransform,
  });
  app.register(swaggerUi, { routePrefix: '/api-docs' });

  // Global auth — validates session token on every request (with exemptions)
  app.addHook('onRequest', authHook);
  // Deny-by-default safety net — catches handlers that forgot to call authorize()
  registerSafetyNet(app);

  // Global error handler — log errors to workspace events when workspace_id is available
  app.setErrorHandler(async (error: Error & { statusCode?: number }, request, reply) => {
    // Handle ForbiddenError from authorize()
    if (error instanceof ForbiddenError) {
      return reply.status(403).send({ error: error.message });
    }

    request.log.error(error);

    // Try to extract workspace_id from query, params, or body
    let workspaceId: number | undefined;
    const query = (request.query as Record<string, unknown>) ?? {};
    const params = (request.params as Record<string, unknown>) ?? {};
    const body = (typeof request.body === 'object' && request.body !== null)
      ? (request.body as Record<string, unknown>)
      : {};

    const rawId = query.workspace_id ?? params.workspace_id ?? body.workspace_id ?? body.workspaceId;
    if (rawId) {
      const parsed = Number(rawId);
      if (!isNaN(parsed) && parsed > 0) workspaceId = parsed;
    }

    const statusCode = error.statusCode ?? 500;

    // Log to workspace events if we have a workspace context
    if (workspaceId) {
      try {
        await createWorkspaceEvent(workspaceId, 'api_error', {
          method: request.method,
          url: request.url,
          statusCode,
          message: error.message,
          stack: error.stack ?? null,
        });
      } catch (eventErr) {
        console.error('[app] Failed to log API error to workspace events:', eventErr instanceof Error ? eventErr.message : eventErr);
      }
    }

    return reply.status(statusCode).send({
      statusCode,
      error: error.name ?? 'Error',
      message: error.message,
    });
  });

  // Routes
  app.register(healthRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api' });
  app.register(scanRoutes, { prefix: '/api' });
  app.register(scanEventRoutes, { prefix: '/api' });
  app.register(engagementReportRoutes, { prefix: '/api' });
  app.register(contributorRoutes, { prefix: '/api' });
  app.register(workspaceRoutes, { prefix: '/api' });
  app.register(workspaceDataRoutes, { prefix: '/api' });
  app.register(sourceRoutes, { prefix: '/api' });
  app.register(workspaceEventRoutes, { prefix: '/api' });
  app.register(pullRequestRoutes, { prefix: '/api' });
  app.register(webhookRoutes, { prefix: '/api' });
  app.register(memberRoutes, { prefix: '/api' });
  app.register(adminRoutes, { prefix: '/api' });
  app.register(workspaceToolRoutes, { prefix: '/api' });
  app.register(claudeStatusRoutes, { prefix: '/api' });
  app.register(workerStatusRoutes, { prefix: '/api' });
  app.register(highlightsRoutes, { prefix: '/api' });

  app.get('/api/provider-secrets', async (request) => {
    // Public metadata, but requires authentication
    if (request.user) request.authorized = true;
    return PROVIDER_SECRETS;
  });

  // Run Drizzle migrations on startup
  app.addHook('onReady', async () => {
    try {
      await migrate(db, { migrationsFolder: './drizzle' });
    } catch (err: any) {
      // 42P07 = "relation already exists" — safe to ignore on existing DBs
      if (err?.cause?.code === '42P07') {
        console.log('[drizzle] Tables already exist, skipping initial migration');
      } else {
        throw err;
      }
    }
  });

  return app;
}
