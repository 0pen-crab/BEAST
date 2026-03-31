import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { workspaces, workspaceMembers, type NewWorkspace } from '../db/schema.ts';
import { authorizeSuperAdmin } from '../lib/authorize.ts';
import { initDefaultTools } from '../orchestrator/entities.ts';

export const workspaceRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /api/workspaces - list all workspaces (filtered by membership for non-super_admin)
  app.get('/workspaces', async (request) => {
    const user = request.user!;
    // Any authenticated user can list their workspaces
    request.authorized = true;
    if (user.role === 'super_admin') {
      return db.select().from(workspaces).orderBy(asc(workspaces.createdAt));
    }
    // Non-super_admin: only workspaces they're members of
    return db.select({
      id: workspaces.id,
      name: workspaces.name,
      description: workspaces.description,
      defaultLanguage: workspaces.defaultLanguage,
      createdAt: workspaces.createdAt,
    }).from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, user.id))
      .orderBy(asc(workspaces.createdAt));
  });

  // POST /api/workspaces - create workspace
  app.post(
    '/workspaces',
    {
      schema: {
        body: z.object({
          name: z.string().min(1).max(256),
          description: z.string().optional(),
          default_language: z.string().max(10).optional(),
        }),
      },
    },
    async (request, reply) => {
      authorizeSuperAdmin(request);
      const { name, description, default_language } = request.body;
      try {
        const [row] = await db.insert(workspaces).values({
          name,
          description: description ?? null,
          defaultLanguage: default_language ?? 'en',
        }).returning();
        await initDefaultTools(row.id);
        return reply.status(201).send(row);
      } catch (err: any) {
        const pgCode = err.code ?? err.cause?.code;
        if (pgCode === '23505') {
          return reply.status(409).send({ error: `Workspace "${name}" already exists` });
        }
        throw err;
      }
    },
  );

  // PUT /api/workspaces/:id - update workspace
  app.put(
    '/workspaces/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({
          name: z.string().min(1).max(256).optional(),
          description: z.string().optional(),
          default_language: z.string().max(10).optional(),
        }),
      },
    },
    async (request, reply) => {
      authorizeSuperAdmin(request);
      const { id } = request.params;
      const { name, description, default_language } = request.body;

      const updates: Partial<NewWorkspace> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (default_language !== undefined) updates.defaultLanguage = default_language;

      const rows = await db.update(workspaces)
        .set(updates)
        .where(eq(workspaces.id, id))
        .returning();
      if (rows.length === 0)
        return reply.status(404).send({ error: 'Not found' });
      return rows[0];
    },
  );

  // DELETE /api/workspaces/:id - delete workspace (cascades)
  app.delete(
    '/workspaces/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      authorizeSuperAdmin(request);
      const { id } = request.params;
      const rows = await db.delete(workspaces)
        .where(eq(workspaces.id, id))
        .returning({ id: workspaces.id });
      if (rows.length === 0)
        return reply.status(404).send({ error: 'Not found' });
      return { deleted: true };
    },
  );
};
