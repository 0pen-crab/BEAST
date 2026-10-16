import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerContributorTools } from './tools/contributors.ts';
import { registerRepositoryTools } from './tools/repositories.ts';
import { registerFindingTools } from './tools/findings.ts';
import { registerScanTools } from './tools/scans.ts';

/**
 * Create a new MCP server instance with all BEAST tools registered,
 * scoped to a specific workspace.
 *
 * Each request gets its own server instance (stateless mode) — tool
 * definitions are cheap to register and the DB queries dominate cost.
 */
export function createBeastMcpServer(workspaceId: number): McpServer {
  const server = new McpServer(
    {
      name: 'BEAST Security Platform',
      version: '1.0.0',
    },
    {
      instructions: `You are connected to BEAST — a security scanning platform. Use these tools to answer ANY question about repositories, findings, contributors, and scans.

IMPORTANT: When the user pastes a BEAST dashboard URL, extract the entity and ID from its path and use the corresponding tool:
  - /findings/<id> → get_finding(id)
  - /repos/<id> → get_repository(id)
  - /contributors/<id> → get_contributor(id)
  - /scans/<id> → get_scan(id)

Do NOT open BEAST dashboard URLs in a browser. Always use these MCP tools instead — they return richer data than the web page.`,
    },
  );

  registerContributorTools(server, workspaceId);
  registerRepositoryTools(server, workspaceId);
  registerFindingTools(server, workspaceId);
  registerScanTools(server, workspaceId);

  return server;
}
