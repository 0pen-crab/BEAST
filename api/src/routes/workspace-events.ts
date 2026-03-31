import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listWorkspaceEvents } from '../orchestrator/entities.ts';
import { authorize } from '../lib/authorize.ts';

export const workspaceEventRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /api/workspace-events?workspace_id=X
  app.get('/workspace-events', {
    schema: {
      querystring: z.object({
        workspace_id: z.coerce.number().positive(),
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
        event_type: z.string().optional(),
      }),
    },
  }, async (request) => {
    const { workspace_id, limit, offset, event_type } = request.query;
    await authorize(request, workspace_id, 'member');
    return listWorkspaceEvents(workspace_id, {
      limit,
      offset,
      eventType: event_type,
    });
  });
};
