import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createBeastMcpServer } from './server.ts';
import { validateApiKey } from './auth.ts';

/**
 * Fastify plugin that mounts the MCP Streamable HTTP transport at /mcp.
 *
 * Auth: API key via Authorization: Bearer <key>
 * Mode: stateless (each request creates a fresh server+transport)
 *
 * Uses reply.hijack() to hand the raw Node.js response to the MCP
 * transport — Fastify does not manage the response after that point.
 */
export const mcpTransportPlugin: FastifyPluginAsyncZod = async (app) => {
  // POST /mcp — main tool-call endpoint
  app.post('/mcp', async (request, reply) => {
    const apiKeyData = await authenticateMcpRequest(request);
    if (!apiKeyData) {
      return reply.status(401).send({ error: 'Invalid or missing API key' });
    }

    request.authorized = true;

    const server = createBeastMcpServer(apiKeyData.workspaceId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    await server.connect(transport);

    // Hijack the response — MCP transport writes directly to Node.js res
    reply.hijack();

    try {
      await transport.handleRequest(request.raw, reply.raw, request.body as Record<string, unknown>);
    } finally {
      await transport.close();
      await server.close();
    }
  });

  // GET /mcp — SSE endpoint (not supported in stateless mode)
  app.get('/mcp', async (request, reply) => {
    const apiKeyData = await authenticateMcpRequest(request);
    if (!apiKeyData) {
      return reply.status(401).send({ error: 'Invalid or missing API key' });
    }
    request.authorized = true;
    return reply.status(405).send({ error: 'SSE not supported in stateless mode. Use POST for tool calls.' });
  });

  // DELETE /mcp — session cleanup (not needed in stateless mode)
  app.delete('/mcp', async (request, reply) => {
    const apiKeyData = await authenticateMcpRequest(request);
    if (!apiKeyData) {
      return reply.status(401).send({ error: 'Invalid or missing API key' });
    }
    request.authorized = true;
    return reply.status(405).send({ error: 'Session management not supported in stateless mode.' });
  });
};

/** Extract and validate the API key from the Authorization header. */
async function authenticateMcpRequest(request: any) {
  const authHeader = request.headers['authorization'] as string | undefined;
  if (!authHeader) return null;

  const token = authHeader.replace(/^Bearer\s+/i, '').replace(/^Token\s+/i, '');
  if (!token || token === authHeader) return null; // no prefix found

  return validateApiKey(token);
}
