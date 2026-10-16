import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getWorkspaceTools, setWorkspaceTools } from '../orchestrator/entities.ts';
import { TOOL_REGISTRY, getAllToolKeys, getToolByKey } from '../lib/tool-registry.ts';
import { setSecret, getSecret, deleteSecret } from '../lib/vault.ts';
import { getValidator } from '../lib/tool-validators.ts';
import { authorize, authorizePublic } from '../lib/authorize.ts';

export const workspaceToolRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /tools/registry - return static tool metadata (public, any authenticated user)
  app.get('/tools/registry', async (request, reply) => {
    authorizePublic(request);
    return reply.send(TOOL_REGISTRY);
  });

  // GET /workspaces/:id/tools - get workspace tool selections
  app.get('/workspaces/:id/tools', {
    schema: { params: z.object({ id: z.coerce.number() }) },
  }, async (req, reply) => {
    const workspaceId = req.params.id;
    await authorize(req, workspaceId, 'member');
    const tools = await getWorkspaceTools(workspaceId);
    const result = await Promise.all(
      tools.map(async (t) => {
        const def = getToolByKey(t.toolKey);
        let hasCredentials = true;
        if (def && def.credentials.length > 0) {
          for (const cred of def.credentials) {
            const val = await getSecret('workspace', workspaceId, cred.vaultLabel);
            if (!val) { hasCredentials = false; break; }
          }
        }
        return { tool_key: t.toolKey, enabled: t.enabled, has_credentials: hasCredentials };
      })
    );
    return reply.send(result);
  });

  // PUT /workspaces/:id/tools - bulk update tool selections + credentials
  app.put('/workspaces/:id/tools', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
      body: z.object({
        tools: z.array(z.object({
          tool_key: z.string(),
          enabled: z.boolean(),
          credentials: z.record(z.string(), z.string()).optional(),
        })),
      }),
    },
  }, async (req, reply) => {
    const workspaceId = req.params.id;
    await authorize(req, workspaceId, 'workspace_admin');
    const { tools } = req.body;
    const validKeys = getAllToolKeys();

    for (const t of tools) {
      if (!validKeys.includes(t.tool_key)) {
        return reply.status(400).send({ error: `Invalid tool key: ${t.tool_key}` });
      }
    }

    await setWorkspaceTools(workspaceId, tools.map(t => ({
      toolKey: t.tool_key, enabled: t.enabled,
    })));

    // Save credentials to vault
    for (const t of tools) {
      if (t.credentials) {
        const def = getToolByKey(t.tool_key);
        if (!def) continue;
        for (const cred of def.credentials) {
          const value = t.credentials[cred.envVar];
          if (value) {
            await setSecret({
              name: `${t.tool_key}_${cred.vaultLabel}`,
              value,
              workspaceId,
              ownerType: 'workspace',
              ownerId: workspaceId,
              label: cred.vaultLabel,
            });
          }
        }
      }
    }

    return reply.send({ ok: true });
  });

  // POST /workspaces/:id/tools/validate — validate token and save on success
  app.post(
    '/workspaces/:id/tools/validate',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({
          tool_key: z.string(),
          credentials: z.record(z.string(), z.string()),
        }),
      },
    },
    async (request, reply) => {
      const { id: workspaceId } = request.params;
      await authorize(request, workspaceId, 'workspace_admin');
      const { tool_key, credentials } = request.body;

      const validator = getValidator(tool_key);
      if (!validator) {
        return reply.status(400).send({ error: `No validator for tool: ${tool_key}` });
      }

      const result = await validator(credentials);

      if (!result.valid) {
        return reply.status(400).send({ valid: false, error: result.error });
      }

      // Save credentials to vault on success
      const toolDef = getToolByKey(tool_key);
      if (toolDef) {
        for (const cred of toolDef.credentials) {
          const value = credentials[cred.envVar];
          if (value) {
            await setSecret({
              name: `${tool_key}_${cred.vaultLabel}`,
              value,
              workspaceId,
              ownerType: 'workspace',
              ownerId: workspaceId,
              label: cred.vaultLabel,
            });
          }
        }
      }

      return { valid: true };
    },
  );

  // DELETE /workspaces/:id/tools/credentials — remove credentials for a tool
  app.delete(
    '/workspaces/:id/tools/credentials',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({
          tool_key: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const { id: workspaceId } = request.params;
      await authorize(request, workspaceId, 'workspace_admin');
      const { tool_key } = request.body;

      const toolDef = getToolByKey(tool_key);
      if (!toolDef) {
        return reply.status(400).send({ error: `Unknown tool: ${tool_key}` });
      }

      for (const cred of toolDef.credentials) {
        await deleteSecret('workspace', workspaceId, cred.vaultLabel);
      }

      return { ok: true };
    },
  );
};
