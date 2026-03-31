import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { scanEvents } from '../db/schema.ts';
import { authorize, ForbiddenError } from '../lib/authorize.ts';

export const scanEventRoutes: FastifyPluginAsyncZod = async (app) => {
  // POST /api/scan-events — log a new event
  app.post(
    '/scan-events',
    {
      schema: {
        body: z.object({
          scan_id: z.string().optional(),
          step_name: z.string().optional(),
          level: z.enum(['info', 'warning', 'error']),
          source: z.string().min(1),
          message: z.string().min(1),
          details: z.record(z.string(), z.any()).optional(),
          repo_name: z.string().optional(),
          workspace_id: z.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { scan_id, step_name, level, source, message, details, repo_name, workspace_id } = request.body;

      if (workspace_id) {
        await authorize(request, workspace_id, 'member');
      } else if (request.user?.role === 'super_admin') {
        request.authorized = true;
      } else {
        throw new ForbiddenError('workspace_id is required');
      }

      const [row] = await db.insert(scanEvents).values({
        scanId: scan_id || null,
        stepName: step_name || null,
        level,
        source,
        message,
        details: details || {},
        repoName: repo_name || null,
        workspaceId: workspace_id || null,
      }).returning();

      return reply.status(201).send(row);
    },
  );

  // GET /api/scan-events — list events with filters
  app.get(
    '/scan-events',
    {
      schema: {
        querystring: z.object({
          limit: z.coerce.number().min(1).max(200).default(50),
          offset: z.coerce.number().min(0).default(0),
          level: z.string().optional(),
          source: z.string().optional(),
          repo_name: z.string().optional(),
          scan_id: z.string().optional(),
          step_name: z.string().optional(),
          resolved: z.enum(['true', 'false']).optional(),
          workspace_id: z.coerce.number().optional(),
        }),
      },
    },
    async (request) => {
      const { limit, offset, level, source, repo_name, scan_id, step_name, resolved, workspace_id } = request.query;

      if (workspace_id) {
        await authorize(request, workspace_id, 'member');
      } else if (request.user?.role === 'super_admin') {
        request.authorized = true;
      } else {
        throw new ForbiddenError('workspace_id is required');
      }

      const conditions: SQL[] = [];

      if (level) {
        conditions.push(eq(scanEvents.level, level));
      }
      if (source) {
        conditions.push(eq(scanEvents.source, source));
      }
      if (repo_name) {
        conditions.push(eq(scanEvents.repoName, repo_name));
      }
      if (scan_id) {
        conditions.push(eq(scanEvents.scanId, scan_id));
      }
      if (step_name) {
        conditions.push(eq(scanEvents.stepName, step_name));
      }
      if (resolved !== undefined) {
        conditions.push(eq(scanEvents.resolved, resolved === 'true'));
      }
      if (workspace_id !== undefined) {
        conditions.push(eq(scanEvents.workspaceId, workspace_id));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(scanEvents)
        .where(where);

      const results = await db.select()
        .from(scanEvents)
        .where(where)
        .orderBy(desc(scanEvents.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        count: Number(countResult[0].count),
        results,
      };
    },
  );

  // GET /api/scan-events/stats — unresolved counts for sidebar badge
  app.get(
    '/scan-events/stats',
    {
      schema: {
        querystring: z.object({
          workspace_id: z.coerce.number().optional(),
        }),
      },
    },
    async (request) => {
      const { workspace_id } = request.query;

      if (workspace_id) {
        await authorize(request, workspace_id, 'member');
      } else if (request.user?.role === 'super_admin') {
        request.authorized = true;
      } else {
        throw new ForbiddenError('workspace_id is required');
      }

      const where = workspace_id !== undefined
        ? eq(scanEvents.workspaceId, workspace_id)
        : undefined;

      const result = await db.select({
        unresolved: sql<number>`count(*) filter (where not ${scanEvents.resolved} and ${scanEvents.level} != 'info')`,
        unresolved_errors: sql<number>`count(*) filter (where not ${scanEvents.resolved} and ${scanEvents.level} = 'error')`,
        unresolved_warnings: sql<number>`count(*) filter (where not ${scanEvents.resolved} and ${scanEvents.level} = 'warning')`,
        total: sql<number>`count(*)`,
      })
        .from(scanEvents)
        .where(where);

      const row = result[0];
      return {
        unresolved: Number(row.unresolved),
        unresolved_errors: Number(row.unresolved_errors),
        unresolved_warnings: Number(row.unresolved_warnings),
        total: Number(row.total),
      };
    },
  );

  // PATCH /api/scan-events/:id — mark resolved
  app.patch(
    '/scan-events/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({
          resolved: z.boolean().optional(),
          resolved_by: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Fetch event to get workspace_id
      const [event] = await db.select({ workspaceId: scanEvents.workspaceId })
        .from(scanEvents)
        .where(eq(scanEvents.id, id));

      if (!event) {
        return reply.status(404).send({ error: 'Event not found' });
      }

      if (event.workspaceId) {
        await authorize(request, event.workspaceId, 'member');
      } else if (request.user?.role === 'super_admin') {
        request.authorized = true;
      } else {
        throw new ForbiddenError('workspace_id is required');
      }

      const { resolved: resolvedInput, resolved_by } = request.body;

      const resolved = resolvedInput ?? true;
      const resolvedAt = resolved ? new Date() : null;
      const resolvedBy = resolved_by || null;

      const rows = await db.update(scanEvents)
        .set({ resolved, resolvedAt, resolvedBy })
        .where(eq(scanEvents.id, id))
        .returning();

      return rows[0];
    },
  );
};
