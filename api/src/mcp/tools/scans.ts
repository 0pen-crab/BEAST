import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { eq, and, sql, inArray, getTableColumns } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { scans, scanSteps, scanModules, repositories, teams } from '../../db/schema.ts';
import { createScan, getScan, listScans } from '../../orchestrator/db.ts';
import { trimStepPayloadForApi } from '../../lib/sanitize.ts';

export function registerScanTools(server: McpServer, workspaceId: number): void {
  // ── list_scans ─────────────────────────────────────────────────
  server.tool(
    'list_scans',
    'List scans in the workspace with status, duration, and timing info',
    {
      status: z.string().optional().describe('Filter by status: queued, running, paused, completed, failed'),
      repository_id: z.number().optional().describe('Filter by repository ID'),
      limit: z.number().optional().describe('Max results (default 20, max 100)'),
    },
    async ({ status, repository_id, limit: rawLimit }) => {
      const limit = Math.min(Math.max(Number(rawLimit) || 20, 1), 100);

      const { count, results } = await listScans(
        limit,
        0,
        workspaceId,
        status,
        repository_id,
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count, results }, null, 2),
        }],
      };
    },
  );

  // ── get_scan ───────────────────────────────────────────────────
  server.tool(
    'get_scan',
    'Get full scan details including all pipeline steps with status/timing/errors, and AI module progress',
    {
      id: z.string().describe('Scan UUID'),
    },
    async ({ id }) => {
      const scan = await getScan(id);
      if (!scan) {
        return { content: [{ type: 'text' as const, text: 'Error: Scan not found' }], isError: true };
      }
      if (scan.workspaceId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Scan not in this workspace' }], isError: true };
      }

      // Pipeline steps
      const stepRows = await db.select().from(scanSteps)
        .where(eq(scanSteps.scanId, id))
        .orderBy(scanSteps.stepOrder);
      const steps = stepRows.map(s => ({
        ...s,
        input: trimStepPayloadForApi(s.input),
        output: trimStepPayloadForApi(s.output),
      }));

      // Module progress
      const moduleRows = await db.select({
        moduleIndex: scanModules.moduleIndex,
        moduleName: scanModules.moduleName,
        status: scanModules.status,
        fileCount: scanModules.fileCount,
        error: scanModules.error,
        startedAt: scanModules.startedAt,
        completedAt: scanModules.completedAt,
      })
        .from(scanModules)
        .where(eq(scanModules.scanId, id))
        .orderBy(scanModules.moduleIndex);

      const moduleProgress = {
        total: moduleRows.length,
        completed: moduleRows.filter(m => m.status === 'completed').length,
        modules: moduleRows,
      };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ...scan, steps, moduleProgress }, null, 2),
        }],
      };
    },
  );

  // ── start_scan ─────────────────────────────────────────────────
  server.tool(
    'start_scan',
    'Queue a new security scan for a repository',
    {
      repository_id: z.number().describe('Repository ID to scan'),
      branch: z.string().optional().describe('Git branch to scan (optional, defaults to default branch)'),
    },
    async ({ repository_id, branch }) => {
      // Look up repository and verify workspace
      const [repo] = await db.select({
        ...getTableColumns(repositories),
        wsId: teams.workspaceId,
      }).from(repositories)
        .innerJoin(teams, eq(teams.id, repositories.teamId))
        .where(eq(repositories.id, repository_id));

      if (!repo) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not found' }], isError: true };
      }
      if (repo.wsId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not in this workspace' }], isError: true };
      }

      const isLocalPath = repo.repoUrl?.startsWith('/') ?? false;

      const scan = await createScan({
        repoUrl: isLocalPath ? undefined : (repo.repoUrl || undefined),
        localPath: isLocalPath ? repo.repoUrl! : undefined,
        repoName: repo.name,
        branch: branch?.trim() || undefined,
        workspaceId,
        repositoryId: repository_id,
        scanType: 'full',
      });

      await db.update(repositories)
        .set({ status: 'queued', updatedAt: sql`NOW()` })
        .where(eq(repositories.id, repository_id));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: 'Scan queued successfully', scan }, null, 2),
        }],
      };
    },
  );

  // ── cancel_scan ────────────────────────────────────────────────
  server.tool(
    'cancel_scan',
    'Cancel an active (running, queued, or paused) scan',
    {
      id: z.string().describe('Scan UUID'),
    },
    async ({ id }) => {
      const scan = await getScan(id);
      if (!scan) {
        return { content: [{ type: 'text' as const, text: 'Error: Scan not found' }], isError: true };
      }
      if (scan.workspaceId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Scan not in this workspace' }], isError: true };
      }

      if (!['running', 'queued', 'paused'].includes(scan.status)) {
        return { content: [{ type: 'text' as const, text: `Error: Scan is not active (status: ${scan.status})` }], isError: true };
      }

      await db.update(scans)
        .set({
          status: 'failed',
          error: 'Cancelled via MCP',
          completedAt: sql`NOW()`,
          resumesAt: null,
        })
        .where(eq(scans.id, id));

      if (scan.repositoryId) {
        await db.update(repositories)
          .set({ status: 'failed', updatedAt: sql`NOW()` })
          .where(eq(repositories.id, scan.repositoryId));
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ cancelled: true, scanId: id }) }],
      };
    },
  );

  // ── resume_scan ────────────────────────────────────────────────
  server.tool(
    'resume_scan',
    'Resume a paused scan (e.g. after rate limit)',
    {
      id: z.string().describe('Scan UUID'),
    },
    async ({ id }) => {
      const scan = await getScan(id);
      if (!scan) {
        return { content: [{ type: 'text' as const, text: 'Error: Scan not found' }], isError: true };
      }
      if (scan.workspaceId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Scan not in this workspace' }], isError: true };
      }

      if (scan.status !== 'paused') {
        return { content: [{ type: 'text' as const, text: `Error: Scan is not paused (status: ${scan.status})` }], isError: true };
      }

      await db.update(scans)
        .set({ resumesAt: null, error: null })
        .where(eq(scans.id, id));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ resumed: true, scanId: id }) }],
      };
    },
  );

  // ── get_scan_stats ─────────────────────────────────────────────
  server.tool(
    'get_scan_stats',
    'Get aggregate scan statistics for the workspace: total, by status, average duration',
    {},
    async () => {
      const [stats] = await db.select({
        total: sql<number>`COUNT(*)::int`,
        queued: sql<number>`COUNT(*) FILTER (WHERE ${scans.status} = 'queued')::int`,
        running: sql<number>`COUNT(*) FILTER (WHERE ${scans.status} = 'running')::int`,
        paused: sql<number>`COUNT(*) FILTER (WHERE ${scans.status} = 'paused')::int`,
        completed: sql<number>`COUNT(*) FILTER (WHERE ${scans.status} = 'completed')::int`,
        failed: sql<number>`COUNT(*) FILTER (WHERE ${scans.status} = 'failed')::int`,
        avg_duration_sec: sql<number | null>`ROUND(AVG(EXTRACT(EPOCH FROM (${scans.completedAt} - ${scans.startedAt}))) FILTER (WHERE ${scans.status} = 'completed'))::int`,
        earliest_active: sql<string | null>`MIN(${scans.createdAt}) FILTER (WHERE ${scans.status} = 'running' OR ${scans.status} = 'queued' OR ${scans.status} = 'paused')`,
      }).from(scans).where(eq(scans.workspaceId, workspaceId));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(stats, null, 2),
        }],
      };
    },
  );
}
