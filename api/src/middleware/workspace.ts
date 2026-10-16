import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    workspaceId: number;
  }
}

/**
 * Fastify preHandler hook that extracts and validates workspace_id.
 * Looks in querystring first, then body.
 */
export async function requireWorkspaceId(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as Record<string, unknown>;
  const body = (typeof request.body === 'object' && request.body !== null)
    ? request.body as Record<string, unknown>
    : {};

  const raw = query.workspace_id ?? body.workspace_id ?? body.workspaceId;
  const id = Number(raw);

  if (!raw || !Number.isFinite(id) || id <= 0) {
    return reply.status(400).send({ error: 'workspace_id is required and must be a positive integer' });
  }

  request.workspaceId = id;
}
