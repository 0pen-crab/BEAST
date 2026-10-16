import { randomBytes } from 'crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { apiKeys } from '../db/schema.ts';
import { authorize, ForbiddenError } from '../lib/authorize.ts';
import { hashApiKey } from '../mcp/auth.ts';

export const apiKeyRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /api-keys?workspace_id=X — list API keys (never returns the hash)
  app.get('/api-keys', {
    schema: {
      querystring: z.object({
        workspace_id: z.coerce.number().positive(),
      }),
    },
  }, async (request) => {
    const { workspace_id } = request.query;
    await authorize(request, workspace_id, 'workspace_admin');

    const keys = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
    }).from(apiKeys)
      .where(eq(apiKeys.workspaceId, workspace_id))
      .orderBy(apiKeys.createdAt);

    return keys;
  });

  // POST /api-keys — generate a new API key
  app.post('/api-keys', {
    schema: {
      body: z.object({
        workspace_id: z.number().positive(),
        name: z.string().min(1).max(128),
      }),
    },
  }, async (request, reply) => {
    const { workspace_id, name } = request.body;
    await authorize(request, workspace_id, 'workspace_admin');

    // Generate a 64-char hex key (32 random bytes)
    const rawKey = randomBytes(32).toString('hex');
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 8);

    const [row] = await db.insert(apiKeys).values({
      workspaceId: workspace_id,
      userId: request.user!.id,
      name,
      keyHash,
      keyPrefix,
    }).returning({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
    });

    // Return the full key ONCE — it cannot be retrieved after this
    return reply.status(201).send({
      ...row,
      key: rawKey,
    });
  });

  // DELETE /api-keys/:id?workspace_id=X — revoke an API key
  app.delete('/api-keys/:id', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
      querystring: z.object({
        workspace_id: z.coerce.number().positive(),
      }),
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { workspace_id } = request.query;
    await authorize(request, workspace_id, 'workspace_admin');

    // Verify the key belongs to this workspace
    const [key] = await db.select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspace_id)));

    if (!key) {
      return reply.status(404).send({ error: 'API key not found' });
    }

    await db.delete(apiKeys).where(eq(apiKeys.id, id));

    return { deleted: true };
  });
};
