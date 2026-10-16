import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { eq, and, desc, asc, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  contributors,
  contributorRepoStats,
  contributorDailyActivity,
  contributorAssessments,
} from '../../db/schema.ts';

export function registerContributorTools(server: McpServer, workspaceId: number): void {
  // ── list_contributors ──────────────────────────────────────────
  server.tool(
    'list_contributors',
    'List contributors in the workspace with scores, commits, and activity stats',
    {
      search: z.string().optional().describe('Search by name or email (ILIKE)'),
      sort: z.enum(['score_overall', 'score_security', 'score_quality', 'total_commits', 'last_seen', 'display_name', 'repo_count']).optional().describe('Sort field'),
      dir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
      limit: z.number().optional().describe('Max results (default 50, max 200)'),
    },
    async ({ search, sort, dir, limit: rawLimit }) => {
      const limit = Math.min(Math.max(Number(rawLimit) || 50, 1), 200);
      const sortField = sort || 'score_overall';
      const sortDir = dir || 'desc';

      const allowedSorts: Record<string, any> = {
        score_overall: contributors.scoreOverall,
        score_security: contributors.scoreSecurity,
        score_quality: contributors.scoreQuality,
        total_commits: contributors.totalCommits,
        last_seen: contributors.lastSeen,
        display_name: contributors.displayName,
        repo_count: contributors.repoCount,
      };
      const sortCol = allowedSorts[sortField] || contributors.scoreOverall;

      const conditions: SQL[] = [
        sql`${contributors.id} IN (SELECT contributor_id FROM contributor_repo_stats WHERE workspace_id = ${workspaceId})`,
      ];

      if (search) {
        const pattern = `%${search}%`;
        conditions.push(
          sql`(${contributors.displayName} ILIKE ${pattern} OR EXISTS (SELECT 1 FROM unnest(${contributors.emails}) e WHERE e ILIKE ${pattern}))`,
        );
      }

      const whereClause = and(...conditions);

      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(contributors)
        .where(whereClause);

      const orderExpr = sortDir === 'asc' ? asc(sortCol) : desc(sortCol);

      const results = await db
        .select()
        .from(contributors)
        .where(whereClause)
        .orderBy(sql`${orderExpr} NULLS LAST`)
        .limit(limit);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: countResult.count, results }, null, 2),
        }],
      };
    },
  );

  // ── get_contributor ────────────────────────────────────────────
  server.tool(
    'get_contributor',
    'Get full contributor profile: details, per-repo stats, daily activity, and AI assessments',
    {
      id: z.number().describe('Contributor ID'),
    },
    async ({ id }) => {
      // Contributor record
      const [contributor] = await db
        .select()
        .from(contributors)
        .where(eq(contributors.id, id));

      if (!contributor) {
        return { content: [{ type: 'text' as const, text: 'Error: Contributor not found' }], isError: true };
      }

      // Verify workspace access
      const hasAccess = await db
        .select({ id: contributorRepoStats.id })
        .from(contributorRepoStats)
        .where(and(
          eq(contributorRepoStats.contributorId, id),
          eq(contributorRepoStats.workspaceId, workspaceId),
        ))
        .limit(1);

      if (hasAccess.length === 0 && contributor.workspaceId !== workspaceId) {
        return { content: [{ type: 'text' as const, text: 'Error: Contributor not in this workspace' }], isError: true };
      }

      // Repo stats with total commits per repo
      const repoTotals = db
        .select({
          repoName: contributorRepoStats.repoName,
          totalCommits: sql<number>`coalesce(sum(${contributorRepoStats.commitCount}), 0)::int`.as('total_commits'),
        })
        .from(contributorRepoStats)
        .groupBy(contributorRepoStats.repoName)
        .as('repo_totals');

      const repos = await db
        .select({
          id: contributorRepoStats.id,
          repoName: contributorRepoStats.repoName,
          repoUrl: contributorRepoStats.repoUrl,
          commitCount: contributorRepoStats.commitCount,
          locAdded: contributorRepoStats.locAdded,
          locRemoved: contributorRepoStats.locRemoved,
          firstCommit: contributorRepoStats.firstCommit,
          lastCommit: contributorRepoStats.lastCommit,
          fileTypes: contributorRepoStats.fileTypes,
          repoTotalCommits: repoTotals.totalCommits,
        })
        .from(contributorRepoStats)
        .leftJoin(repoTotals, eq(contributorRepoStats.repoName, repoTotals.repoName))
        .where(eq(contributorRepoStats.contributorId, id))
        .orderBy(sql`${contributorRepoStats.lastCommit} DESC NULLS LAST`);

      // Daily activity (last 52 weeks)
      const activity = await db
        .select({
          activityDate: contributorDailyActivity.activityDate,
          commitCount: sql<number>`sum(${contributorDailyActivity.commitCount})::int`,
        })
        .from(contributorDailyActivity)
        .where(
          and(
            eq(contributorDailyActivity.contributorId, id),
            sql`${contributorDailyActivity.activityDate} >= CURRENT_DATE - 364`,
          ),
        )
        .groupBy(contributorDailyActivity.activityDate)
        .orderBy(asc(contributorDailyActivity.activityDate));

      // Assessments
      const assessments = await db
        .select()
        .from(contributorAssessments)
        .where(eq(contributorAssessments.contributorId, id))
        .orderBy(desc(contributorAssessments.assessedAt));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ contributor, repos, activity, assessments }, null, 2),
        }],
      };
    },
  );
}
