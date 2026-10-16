import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { eq, and, desc, sql, inArray, getTableColumns, type SQL } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../../db/index.ts';
import { repositories, teams, findings, scans, scanFiles } from '../../db/schema.ts';

/** Resolve the on-disk clone path for a repository. */
async function resolveRepoClonePath(repoId: number): Promise<string | null> {
  const [repo] = await db.select({
    id: repositories.id,
    name: repositories.name,
    sourceId: repositories.sourceId,
    repoUrl: repositories.repoUrl,
  }).from(repositories).where(eq(repositories.id, repoId));

  if (!repo) return null;

  // Local/uploaded repos use repoUrl as the local path directly
  if (repo.repoUrl?.startsWith('/')) return repo.repoUrl;

  const sourceKey = repo.sourceId ? `src-${repo.sourceId}` : `repo-${repo.id}`;
  return `/workspace/${sourceKey}/${repo.name}/repo`;
}

/** Validate a user-supplied path — no traversal, no escapes. */
/**
 * Resolve a user-supplied path to its real location, or null when it does not
 * exist or ends up outside the clone. Scanned repos are untrusted, so symlinks
 * are followed before the containment check — a link to /proc/self/environ
 * must not be readable.
 */
export function resolveInsideRepo(clonePath: string, userPath: string): string | null {
  if (path.isAbsolute(userPath)) return null;
  let root: string;
  let target: string;
  try {
    root = fs.realpathSync(clonePath);
    target = fs.realpathSync(path.join(root, userPath));
  } catch {
    return null;
  }
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

export function registerRepositoryTools(server: McpServer, workspaceId: number): void {
  // ── list_repositories ──────────────────────────────────────────
  server.tool(
    'list_repositories',
    'List all repositories in the workspace with risk scores, finding counts, and scan info',
    {
      team_id: z.number().optional().describe('Filter by team ID'),
      search: z.string().optional().describe('Search by repo name (ILIKE)'),
    },
    async ({ team_id, search }) => {
      const conditions: SQL[] = [eq(teams.workspaceId, workspaceId)];

      if (team_id) conditions.push(eq(repositories.teamId, team_id));
      if (search) conditions.push(sql`${repositories.name} ILIKE ${'%' + search + '%'}`);

      const results = await db.select({
        ...getTableColumns(repositories),
        teamName: teams.name,
        workspaceId: teams.workspaceId,
        findingsCount: sql<number>`(select count(*) from findings f where f.repository_id = ${repositories.id} and f.status = 'open')::int`,
        riskScore: sql<number>`(select least(10, round((coalesce(sum(
          (case when f.severity = 'Critical' then 10 when f.severity = 'High' then 5 when f.severity = 'Medium' then 2 when f.severity = 'Low' then 0.5 else 0 end)
          * (case when f.tool in ('gitleaks','trufflehog','gitguardian','trivy-secrets') then 1.2 when f.tool = 'beast' then 1.0 else 0.8 end)
        ), 0) / 5.0)::numeric, 1)) from findings f where f.repository_id = ${repositories.id} and f.status = 'open')::float`,
        lastScannedAt: sql<string | null>`(select max(s.completed_at) from scans s where s.repository_id = ${repositories.id} and s.status = 'completed')`,
      }).from(repositories)
        .innerJoin(teams, eq(teams.id, repositories.teamId))
        .where(and(...conditions))
        .orderBy(desc(repositories.createdAt));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  // ── get_repository ─────────────────────────────────────────────
  server.tool(
    'get_repository',
    'Get EVERYTHING about a repository: details, findings breakdown, risk score, AND full profile + security audit reports. This is the primary tool for understanding a repo.',
    {
      id: z.number().describe('Repository ID'),
    },
    async ({ id }) => {
      const rows = await db.select({
        ...getTableColumns(repositories),
        teamName: teams.name,
        workspaceId: teams.workspaceId,
        findingsCount: sql<number>`(select count(*) from findings f where f.repository_id = ${repositories.id} and f.status = 'open')::int`,
        riskScore: sql<number>`(select least(10, round((coalesce(sum(
          (case when f.severity = 'Critical' then 10 when f.severity = 'High' then 5 when f.severity = 'Medium' then 2 when f.severity = 'Low' then 0.5 else 0 end)
          * (case when f.tool in ('gitleaks','trufflehog','gitguardian','trivy-secrets') then 1.2 when f.tool = 'beast' then 1.0 else 0.8 end)
        ), 0) / 5.0)::numeric, 1)) from findings f where f.repository_id = ${repositories.id} and f.status = 'open')::float`,
        lastScannedAt: sql<string | null>`(select max(s.completed_at) from scans s where s.repository_id = ${repositories.id} and s.status = 'completed')`,
      }).from(repositories)
        .innerJoin(teams, eq(teams.id, repositories.teamId))
        .where(eq(repositories.id, id));

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not found' }], isError: true };
      }
      if (rows[0].workspaceId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not in this workspace' }], isError: true };
      }

      // Findings breakdown by severity
      const [severityCounts] = await db.select({
        Critical: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Critical')::int`,
        High: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'High')::int`,
        Medium: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Medium')::int`,
        Low: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Low')::int`,
        Info: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Info')::int`,
        total: sql<number>`count(*) filter (where ${findings.status} = 'open')::int`,
        riskAccepted: sql<number>`count(*) filter (where ${findings.status} = 'risk_accepted')::int`,
        falsePositive: sql<number>`count(*) filter (where ${findings.status} = 'false_positive')::int`,
        fixed: sql<number>`count(*) filter (where ${findings.status} = 'fixed')::int`,
      }).from(findings).where(eq(findings.repositoryId, id));

      // Findings breakdown by tool
      const toolCounts = await db.select({
        tool: findings.tool,
        active: sql<number>`count(*) filter (where ${findings.status} = 'open')::int`,
        dismissed: sql<number>`count(*) filter (where ${findings.status} in ('false_positive', 'risk_accepted', 'duplicate'))::int`,
      }).from(findings)
        .where(eq(findings.repositoryId, id))
        .groupBy(findings.tool);

      // Reports (profile + audit) from latest completed scan
      const reportRows = await db.select({
        fileType: scanFiles.fileType,
        content: scanFiles.content,
        createdAt: scanFiles.createdAt,
      }).from(scanFiles)
        .innerJoin(scans, eq(scans.id, scanFiles.scanId))
        .where(and(
          eq(scans.repositoryId, id),
          eq(scans.status, 'completed'),
          inArray(scanFiles.fileType, ['profile', 'audit']),
        ))
        .orderBy(desc(scans.completedAt), desc(scanFiles.createdAt));

      const reports: Record<string, { content: string; updated_at: string }> = {};
      for (const row of reportRows) {
        if (row.fileType && !reports[row.fileType]) {
          reports[row.fileType] = {
            content: row.content || '',
            updated_at: row.createdAt as unknown as string,
          };
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            repository: rows[0],
            findingsBySeverity: severityCounts,
            findingsByTool: toolCounts,
            reports,
          }, null, 2),
        }],
      };
    },
  );

  // ── get_repository_reports ────────────────────────────────────
  server.tool(
    'get_repository_reports',
    'Get repository profile and security audit markdown reports from the latest scan',
    {
      id: z.number().describe('Repository ID'),
    },
    async ({ id }) => {
      // Verify workspace ownership
      const wsRows = await db.select({ wsId: teams.workspaceId })
        .from(repositories)
        .innerJoin(teams, eq(repositories.teamId, teams.id))
        .where(eq(repositories.id, id))
        .limit(1);
      if (wsRows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not found' }], isError: true };
      }
      if (wsRows[0].wsId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not in this workspace' }], isError: true };
      }

      const rows = await db.select({
        fileType: scanFiles.fileType,
        content: scanFiles.content,
        createdAt: scanFiles.createdAt,
      }).from(scanFiles)
        .innerJoin(scans, eq(scans.id, scanFiles.scanId))
        .where(and(
          eq(scans.repositoryId, id),
          eq(scans.status, 'completed'),
          inArray(scanFiles.fileType, ['profile', 'audit']),
        ))
        .orderBy(desc(scans.completedAt), desc(scanFiles.createdAt));

      const reports: Record<string, { content: string; updated_at: string }> = {};
      for (const row of rows) {
        if (row.fileType && !reports[row.fileType]) {
          reports[row.fileType] = {
            content: row.content || '',
            updated_at: row.createdAt as unknown as string,
          };
        }
      }

      if (Object.keys(reports).length === 0) {
        return { content: [{ type: 'text' as const, text: 'No reports available. The repository may not have been scanned yet.' }] };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(reports, null, 2),
        }],
      };
    },
  );

  // ── list_repository_files ──────────────────────────────────────
  server.tool(
    'list_repository_files',
    'List files and directories in a cloned repository. Only available if the repo has been scanned.',
    {
      repository_id: z.number().describe('Repository ID'),
      path: z.string().optional().describe('Relative path within the repo (default: root)'),
    },
    async ({ repository_id, path: userPath }) => {
      // Verify workspace ownership
      const wsRows = await db.select({ wsId: teams.workspaceId })
        .from(repositories)
        .innerJoin(teams, eq(repositories.teamId, teams.id))
        .where(eq(repositories.id, repository_id))
        .limit(1);
      if (wsRows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not found' }], isError: true };
      }
      if (wsRows[0].wsId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not in this workspace' }], isError: true };
      }

      const clonePath = await resolveRepoClonePath(repository_id);
      if (!clonePath) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not found' }], isError: true };
      }

      const relPath = userPath || '.';
      const fullPath = resolveInsideRepo(clonePath, relPath);
      if (!fullPath) {
        return { content: [{ type: 'text' as const, text: 'Error: Path not found inside the repository. The repository may not have been scanned yet.' }], isError: true };
      }

      const stat = fs.statSync(fullPath);
      if (!stat.isDirectory()) {
        return { content: [{ type: 'text' as const, text: 'Error: Path is not a directory. Use read_repository_file to read file contents.' }], isError: true };
      }

      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      const items = entries.map(entry => {
        const entryPath = path.join(fullPath, entry.name);
        const entryStat = fs.lstatSync(entryPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isFile() ? entryStat.size : undefined,
        };
      });

      // Sort: directories first, then alphabetical
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ path: relPath, entries: items }, null, 2),
        }],
      };
    },
  );

  // ── read_repository_file ───────────────────────────────────────
  server.tool(
    'read_repository_file',
    'Read a file from the cloned repository. Max 1MB, text files only.',
    {
      repository_id: z.number().describe('Repository ID'),
      path: z.string().describe('Relative path to the file within the repo'),
    },
    async ({ repository_id, path: userPath }) => {
      // Verify workspace ownership
      const wsRows = await db.select({ wsId: teams.workspaceId })
        .from(repositories)
        .innerJoin(teams, eq(repositories.teamId, teams.id))
        .where(eq(repositories.id, repository_id))
        .limit(1);
      if (wsRows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not found' }], isError: true };
      }
      if (wsRows[0].wsId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not in this workspace' }], isError: true };
      }

      const clonePath = await resolveRepoClonePath(repository_id);
      if (!clonePath) {
        return { content: [{ type: 'text' as const, text: 'Error: Repository not found' }], isError: true };
      }

      const fullPath = resolveInsideRepo(clonePath, userPath);
      if (!fullPath) {
        return { content: [{ type: 'text' as const, text: 'Error: File not found inside the repository' }], isError: true };
      }

      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        return { content: [{ type: 'text' as const, text: 'Error: Path is a directory. Use list_repository_files instead.' }], isError: true };
      }

      const MAX_SIZE = 1024 * 1024; // 1MB
      if (stat.size > MAX_SIZE) {
        return { content: [{ type: 'text' as const, text: `Error: File is too large (${stat.size} bytes). Max 1MB.` }], isError: true };
      }

      // Binary detection: read first 8KB and check for null bytes
      const buf = Buffer.alloc(Math.min(8192, stat.size));
      const fd = fs.openSync(fullPath, 'r');
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      if (buf.includes(0)) {
        return { content: [{ type: 'text' as const, text: 'Error: File appears to be binary' }], isError: true };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      return {
        content: [{ type: 'text' as const, text: content }],
      };
    },
  );
}
