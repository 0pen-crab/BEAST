import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { eq, and, ne, gt, lt, desc, asc, sql, inArray, getTableColumns, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { findings, findingNotes, tests, scans, repositories, contributors } from '../../db/schema.ts';

export function registerFindingTools(server: McpServer, workspaceId: number): void {
  // ── list_findings ──────────────────────────────────────────────
  server.tool(
    'list_findings',
    'List security findings with filters. Returns ALL fields including repo name, contributor, duplicate count.',
    {
      repository_id: z.number().optional().describe('Filter by repository ID'),
      severity: z.string().optional().describe('Filter by severity: Critical,High,Medium,Low,Info (comma-separated)'),
      status: z.string().optional().describe('Filter by status: open,false_positive,fixed,risk_accepted,duplicate (comma-separated)'),
      tool: z.string().optional().describe('Filter by tool: beast,gitleaks,trufflehog,trivy,semgrep,etc (comma-separated)'),
      search: z.string().optional().describe('Search in title or file path (ILIKE)'),
      committed_after: z.string().optional().describe('Only findings INTRODUCED after this date (ISO 8601, e.g. 2026-01-13). Uses the blamed commit date, not the scan date.'),
      committed_before: z.string().optional().describe('Only findings INTRODUCED before this date (ISO 8601). Uses the blamed commit date, not the scan date.'),
      limit: z.number().optional().describe('Max results (default 50, max 500)'),
      offset: z.number().optional().describe('Offset for pagination'),
    },
    async ({ repository_id, severity, status, tool, search, committed_after, committed_before, limit: rawLimit, offset: rawOffset }) => {
      const limit = Math.min(Math.max(Number(rawLimit) || 50, 1), 500);
      const offset = Math.max(Number(rawOffset) || 0, 0);

      const conditions: SQL[] = [];

      // Workspace filter via tests → scans chain
      const workspaceTestIds = db.select({ id: tests.id }).from(tests)
        .innerJoin(scans, eq(tests.scanId, scans.id))
        .where(eq(scans.workspaceId, workspaceId));
      conditions.push(inArray(findings.testId, workspaceTestIds));

      if (severity) {
        const vals = severity.split(',').map(s => s.trim());
        conditions.push(vals.length === 1 ? eq(findings.severity, vals[0]) : inArray(findings.severity, vals));
      }
      if (status) {
        const vals = status.split(',').map(s => s.trim());
        conditions.push(vals.length === 1 ? eq(findings.status, vals[0]) : inArray(findings.status, vals));
      }
      if (tool) {
        const vals = tool.split(',').map(s => s.trim());
        conditions.push(vals.length === 1 ? eq(findings.tool, vals[0]) : inArray(findings.tool, vals));
      }
      if (repository_id) {
        conditions.push(eq(findings.repositoryId, repository_id));
      }
      if (search) {
        const pattern = `%${search}%`;
        conditions.push(sql`(${findings.title} ILIKE ${pattern} OR ${findings.filePath} ILIKE ${pattern})`);
      }
      // Commit-date window. A finding with no blame date is NOT a match either
      // way — "unknown when" must never be reported as "introduced after X".
      for (const [raw, op] of [[committed_after, 'after'], [committed_before, 'before']] as const) {
        if (!raw) continue;
        const bound = new Date(raw);
        if (Number.isNaN(bound.getTime())) {
          return {
            content: [{ type: 'text' as const, text: `Error: committed_${op} is not a valid date: '${raw}'` }],
            isError: true,
          };
        }
        conditions.push(op === 'after' ? gt(findings.commitDate, bound) : lt(findings.commitDate, bound));
      }

      const whereClause = and(...conditions);

      const [countRow] = await db.select({
        count: sql<number>`count(*)::int`,
      }).from(findings).where(whereClause);

      // Default sort: open first, highest severity, newest
      const severityRank = sql`CASE LOWER(${findings.severity})
        WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3
        WHEN 'low' THEN 2 WHEN 'info' THEN 1 ELSE 0 END`;

      const rows = await db.select({
        ...getTableColumns(findings),
        contributorName: contributors.displayName,
        repositoryName: repositories.name,
        scanId: scans.id,
        duplicateCount: sql<number>`(SELECT COUNT(*) FROM findings f2 WHERE f2.duplicate_of = ${findings.id} AND f2.tool <> ${findings.tool})::int`,
      }).from(findings)
        .innerJoin(tests, eq(tests.id, findings.testId))
        .innerJoin(scans, eq(scans.id, tests.scanId))
        .leftJoin(contributors, eq(contributors.id, findings.contributorId))
        .leftJoin(repositories, eq(repositories.id, findings.repositoryId))
        .where(whereClause)
        .orderBy(
          sql`(${findings.status} = 'open') DESC`,
          desc(severityRank),
          desc(findings.createdAt),
        )
        .limit(limit)
        .offset(offset);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: countRow.count, results: rows }, null, 2),
        }],
      };
    },
  );

  // ── get_finding ────────────────────────────────────────────────
  server.tool(
    'get_finding',
    'Get full finding details including notes, duplicate chain, and code snippet',
    {
      id: z.number().describe('Finding ID'),
    },
    async ({ id }) => {
      const rows = await db.select({
        ...getTableColumns(findings),
        workspaceId: scans.workspaceId,
        contributorName: contributors.displayName,
        repositoryName: repositories.name,
        scanId: scans.id,
      }).from(findings)
        .innerJoin(tests, eq(tests.id, findings.testId))
        .innerJoin(scans, eq(scans.id, tests.scanId))
        .leftJoin(contributors, eq(contributors.id, findings.contributorId))
        .leftJoin(repositories, eq(repositories.id, findings.repositoryId))
        .where(eq(findings.id, id));

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Error: Finding not found' }], isError: true };
      }

      const finding = rows[0];
      if (finding.workspaceId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Finding not in this workspace' }], isError: true };
      }

      // Notes
      const notes = await db.select().from(findingNotes)
        .where(eq(findingNotes.findingId, id))
        .orderBy(asc(findingNotes.createdAt));

      // Duplicate-of finding details (if this is a duplicate)
      let duplicateOfFinding: any = null;
      if (finding.duplicateOf) {
        const [survivor] = await db.select({
          id: findings.id,
          title: findings.title,
          tool: findings.tool,
          filePath: findings.filePath,
          line: findings.line,
          severity: findings.severity,
        }).from(findings).where(eq(findings.id, finding.duplicateOf));
        if (survivor) duplicateOfFinding = survivor;
      }

      // Cross-tool duplicates pointing to this finding
      const duplicates = await db.select({
        id: findings.id,
        tool: findings.tool,
        title: findings.title,
        severity: findings.severity,
        filePath: findings.filePath,
        line: findings.line,
        status: findings.status,
      }).from(findings)
        .where(and(eq(findings.duplicateOf, id), ne(findings.tool, finding.tool)))
        .orderBy(asc(findings.id));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ finding, notes, duplicateOfFinding, duplicates }, null, 2),
        }],
      };
    },
  );

  // ── get_findings_summary ──────────────────────────────────────
  server.tool(
    'get_findings_summary',
    'Get finding counts broken down by severity and by tool for the workspace or a specific repository',
    {
      repository_id: z.number().optional().describe('Optional: filter by repository ID'),
    },
    async ({ repository_id }) => {
      const conditions: SQL[] = [];

      const workspaceTestIds = db.select({ id: tests.id }).from(tests)
        .innerJoin(scans, eq(tests.scanId, scans.id))
        .where(eq(scans.workspaceId, workspaceId));
      conditions.push(inArray(findings.testId, workspaceTestIds));

      if (repository_id) {
        conditions.push(eq(findings.repositoryId, repository_id));
      }

      const whereClause = and(...conditions);

      const [bySeverity] = await db.select({
        Critical: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Critical')::int`,
        High: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'High')::int`,
        Medium: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Medium')::int`,
        Low: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Low')::int`,
        Info: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Info')::int`,
        total: sql<number>`count(*) filter (where ${findings.status} = 'open')::int`,
        riskAccepted: sql<number>`count(*) filter (where ${findings.status} = 'risk_accepted')::int`,
        falsePositive: sql<number>`count(*) filter (where ${findings.status} = 'false_positive')::int`,
        fixed: sql<number>`count(*) filter (where ${findings.status} = 'fixed')::int`,
      }).from(findings).where(whereClause);

      const byTool = await db.select({
        tool: findings.tool,
        active: sql<number>`count(*) filter (where ${findings.status} = 'open')::int`,
        dismissed: sql<number>`count(*) filter (where ${findings.status} in ('false_positive', 'risk_accepted', 'duplicate'))::int`,
      }).from(findings)
        .where(whereClause)
        .groupBy(findings.tool)
        .orderBy(asc(findings.tool));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ bySeverity, byTool }, null, 2),
        }],
      };
    },
  );

  // ── update_finding_status ──────────────────────────────────────
  server.tool(
    'update_finding_status',
    'Change a finding status (triage). Validates the finding belongs to this workspace.',
    {
      id: z.number().describe('Finding ID'),
      status: z.enum(['open', 'false_positive', 'risk_accepted']).describe('New status'),
      reason: z.string().optional().describe('Reason for status change (recommended for risk_accepted)'),
    },
    async ({ id, status, reason }) => {
      // Resolve workspace
      const wsRows = await db.select({ workspaceId: scans.workspaceId })
        .from(findings)
        .innerJoin(tests, eq(tests.id, findings.testId))
        .innerJoin(scans, eq(scans.id, tests.scanId))
        .where(eq(findings.id, id));

      if (wsRows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Error: Finding not found' }], isError: true };
      }
      if (wsRows[0].workspaceId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Finding not in this workspace' }], isError: true };
      }

      const updates: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };
      if (reason) updates.riskAcceptedReason = reason;

      const [updated] = await db.update(findings)
        .set(updates)
        .where(eq(findings.id, id))
        .returning();

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(updated, null, 2),
        }],
      };
    },
  );

  // ── add_finding_note ──────────────────────────────────────────
  server.tool(
    'add_finding_note',
    'Add a note/comment to a finding',
    {
      id: z.number().describe('Finding ID'),
      content: z.string().describe('Note content'),
    },
    async ({ id, content }) => {
      // Resolve workspace
      const wsRows = await db.select({ workspaceId: scans.workspaceId })
        .from(findings)
        .innerJoin(tests, eq(tests.id, findings.testId))
        .innerJoin(scans, eq(scans.id, tests.scanId))
        .where(eq(findings.id, id));

      if (wsRows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Error: Finding not found' }], isError: true };
      }
      if (wsRows[0].workspaceId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Finding not in this workspace' }], isError: true };
      }

      const [note] = await db.insert(findingNotes).values({
        findingId: id,
        author: 'mcp',
        noteType: 'comment',
        content,
      }).returning();

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(note, null, 2),
        }],
      };
    },
  );
}
