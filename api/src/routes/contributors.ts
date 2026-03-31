import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and, desc, asc, sql, inArray, type SQL } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  contributors,
  contributorRepoStats,
  contributorDailyActivity,
  contributorAssessments,
  findings,
} from '../db/schema.ts';
import { authorize, authorizePublic, ForbiddenError } from '../lib/authorize.ts';
import { queueFeedbackCompilation } from '../orchestrator/feedback-worker.ts';

// ── Find or create contributor by email ──────────────────────────
export async function findOrCreateContributor(
  email: string,
  name: string,
  workspaceId: number,
): Promise<number> {
  const normalizedEmail = email.toLowerCase().trim();

  // Try to find by email (case-insensitive) within the same workspace
  const found = await db
    .select({ id: contributors.id })
    .from(contributors)
    .where(and(
      sql`${contributors.emails} @> ARRAY[${normalizedEmail}]::text[]`,
      eq(contributors.workspaceId, workspaceId),
    ));

  if (found.length > 0) return found[0].id;

  // Create new
  const [created] = await db
    .insert(contributors)
    .values({
      displayName: name,
      emails: [normalizedEmail],
      workspaceId,
    })
    .returning({ id: contributors.id });

  return created.id;
}

// ── Recompute aggregate scores (simple average) ─────────────────
export async function recomputeScores(contributorId: number) {
  // Aggregate repo stats
  const [stats] = await db
    .select({
      repoCount: sql<number>`count(*)::int`,
      totalCommits: sql<number>`coalesce(sum(${contributorRepoStats.commitCount}), 0)::int`,
      totalLocAdded: sql<number>`coalesce(sum(${contributorRepoStats.locAdded}), 0)::bigint`,
      totalLocRemoved: sql<number>`coalesce(sum(${contributorRepoStats.locRemoved}), 0)::bigint`,
      firstSeen: sql<Date | null>`min(${contributorRepoStats.firstCommit})`,
      lastSeen: sql<Date | null>`max(${contributorRepoStats.lastCommit})`,
    })
    .from(contributorRepoStats)
    .where(eq(contributorRepoStats.contributorId, contributorId));

  // Simple average across all assessments
  const [scores] = await db
    .select({
      scoreSecurity: sql<number | null>`avg(${contributorAssessments.scoreSecurity})`,
      scoreQuality: sql<number | null>`avg(${contributorAssessments.scoreQuality})`,
      scorePatterns: sql<number | null>`avg(${contributorAssessments.scorePatterns})`,
      scoreTesting: sql<number | null>`avg(${contributorAssessments.scoreTesting})`,
      scoreInnovation: sql<number | null>`avg(${contributorAssessments.scoreInnovation})`,
    })
    .from(contributorAssessments)
    .where(eq(contributorAssessments.contributorId, contributorId));

  const scoreOverall = scores.scoreSecurity != null
    ? ((scores.scoreSecurity ?? 0) + (scores.scoreQuality ?? 0) + (scores.scorePatterns ?? 0)
       + (scores.scoreTesting ?? 0) + (scores.scoreInnovation ?? 0)) / 5
    : null;

  await db
    .update(contributors)
    .set({
      totalCommits: Number(stats.totalCommits),
      totalLocAdded: Number(stats.totalLocAdded),
      totalLocRemoved: Number(stats.totalLocRemoved),
      repoCount: Number(stats.repoCount),
      firstSeen: stats.firstSeen ? new Date(stats.firstSeen) : null,
      lastSeen: stats.lastSeen ? new Date(stats.lastSeen) : null,
      scoreOverall,
      scoreSecurity: scores.scoreSecurity,
      scoreQuality: scores.scoreQuality,
      scorePatterns: scores.scorePatterns,
      scoreTesting: scores.scoreTesting,
      scoreInnovation: scores.scoreInnovation,
      updatedAt: new Date(),
    })
    .where(eq(contributors.id, contributorId));
}

// ── Ingest contributor stats directly (called from pipeline) ──────
export interface IngestContributor {
  email: string;
  name: string;
  commits: number;
  loc_added: number;
  loc_removed: number;
  first_commit?: string | null;
  last_commit?: string | null;
  file_types?: Record<string, number>;
  daily_activity?: Record<string, number>;
}

export interface IngestAssessment {
  email: string;
  security: number;
  quality: number;
  patterns: number;
  testing: number;
  innovation: number;
  notes?: string;
  feedback?: string;
}

export interface IngestResult {
  contributorIds: Record<string, number>;
  newAssessments: number;
}

function toDateOrNull(val: string | null | undefined): Date | null {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d;
}

export async function ingestContributors(params: {
  repoName: string;
  repoUrl?: string;
  workspaceId: number;
  executionId?: string;
  contributors: IngestContributor[];
  assessments?: IngestAssessment[];
}): Promise<IngestResult> {
  const contributorIds: Record<string, number> = {};
  let newAssessments = 0;

  for (const c of params.contributors) {
    const contribId = await findOrCreateContributor(c.email, c.name, params.workspaceId);
    contributorIds[c.email] = contribId;

    await db
      .insert(contributorRepoStats)
      .values({
        contributorId: contribId,
        repoName: params.repoName,
        repoUrl: params.repoUrl || null,
        workspaceId: params.workspaceId || null,
        commitCount: c.commits,
        locAdded: c.loc_added,
        locRemoved: c.loc_removed,
        firstCommit: toDateOrNull(c.first_commit),
        lastCommit: toDateOrNull(c.last_commit),
        fileTypes: c.file_types || {},
      })
      .onConflictDoUpdate({
        target: [contributorRepoStats.contributorId, contributorRepoStats.repoName],
        set: {
          repoUrl: sql`excluded.repo_url`,
          workspaceId: sql`coalesce(excluded.workspace_id, ${contributorRepoStats.workspaceId})`,
          commitCount: sql`excluded.commit_count`,
          locAdded: sql`excluded.loc_added`,
          locRemoved: sql`excluded.loc_removed`,
          firstCommit: sql`excluded.first_commit`,
          lastCommit: sql`excluded.last_commit`,
          fileTypes: sql`excluded.file_types`,
          updatedAt: new Date(),
        },
      });

    if (c.daily_activity) {
      for (const [date, count] of Object.entries(c.daily_activity)) {
        await db
          .insert(contributorDailyActivity)
          .values({
            contributorId: contribId,
            repoName: params.repoName,
            activityDate: date,
            commitCount: count,
          })
          .onConflictDoUpdate({
            target: [contributorDailyActivity.contributorId, contributorDailyActivity.repoName, contributorDailyActivity.activityDate],
            set: {
              commitCount: sql`excluded.commit_count`,
            },
          });
      }
    }
  }

  // Build commit count lookup for minimum threshold check
  const commitsByEmail = new Map<string, number>();
  for (const c of params.contributors) {
    commitsByEmail.set(c.email.toLowerCase(), c.commits);
  }

  if (params.assessments) {
    for (const a of params.assessments) {
      // Resolve assessment email → contributor ID (may differ from git stats primary email)
      let contribId = contributorIds[a.email];
      if (!contribId) {
        // Try resolving through findOrCreateContributor (handles merged email aliases)
        contribId = await findOrCreateContributor(a.email, a.email.split('@')[0], params.workspaceId);
        // Verify this contributor has git stats in this scan
        const hasStats = Object.values(contributorIds).includes(contribId);
        if (!hasStats) continue;
      }

      // Skip assessment if contributor has fewer than 10 commits in this repo
      // Check all known emails for this contributor
      let commits = commitsByEmail.get(a.email.toLowerCase()) ?? 0;
      if (commits < 10) {
        // Try other emails that map to same contributor
        for (const [email, id] of Object.entries(contributorIds)) {
          if (id === contribId) {
            commits = Math.max(commits, commitsByEmail.get(email.toLowerCase()) ?? 0);
          }
        }
      }
      if (commits < 10) continue;

      // Check if assessment already exists for this contributor+repo
      const existing = await db
        .select({ id: contributorAssessments.id, assessedAt: contributorAssessments.assessedAt })
        .from(contributorAssessments)
        .where(and(
          eq(contributorAssessments.contributorId, contribId),
          eq(contributorAssessments.repoName, params.repoName),
        ))
        .orderBy(desc(contributorAssessments.assessedAt))
        .limit(1);

      // Only insert/update if no existing assessment or 6+ months have passed
      const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
      const lastAssessedAt = existing.length > 0 ? new Date(existing[0].assessedAt).getTime() : 0;
      const elapsed = Date.now() - lastAssessedAt;

      if (existing.length === 0) {
        // First assessment for this contributor+repo
        await db.insert(contributorAssessments).values({
          contributorId: contribId,
          repoName: params.repoName,
          executionId: params.executionId || null,
          scoreSecurity: a.security,
          scoreQuality: a.quality,
          scorePatterns: a.patterns,
          scoreTesting: a.testing,
          scoreInnovation: a.innovation,
          notes: a.notes || null,
          feedback: a.feedback || null,
        }).returning({ id: contributorAssessments.id });
        newAssessments++;
        continue;
      }

      if (elapsed < SIX_MONTHS_MS) {
        // Too soon — skip this assessment
        continue;
      }

      // 6+ months passed — update existing assessment
      await db.update(contributorAssessments)
        .set({
          scoreSecurity: a.security,
          scoreQuality: a.quality,
          scorePatterns: a.patterns,
          scoreTesting: a.testing,
          scoreInnovation: a.innovation,
          notes: a.notes || null,
          feedback: a.feedback || null,
          executionId: params.executionId || null,
          assessedAt: new Date(),
        })
        .where(eq(contributorAssessments.id, existing[0].id));
      newAssessments++;
    }
  }

  for (const contribId of new Set(Object.values(contributorIds))) {
    await recomputeScores(contribId);
  }

  return { contributorIds, newAssessments };
}

export const contributorRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── POST /api/contributors/ingest ────────────────────────────────
  app.post('/contributors/ingest', {
    schema: {
      body: z.object({
        repo_name: z.string().min(1),
        repo_url: z.string().optional(),
        workspace_id: z.number(),
        execution_id: z.string().optional(),
        contributors: z.array(z.object({
          email: z.string().email(),
          name: z.string().min(1),
          commits: z.number().int().min(0),
          loc_added: z.number().int().min(0),
          loc_removed: z.number().int().min(0),
          first_commit: z.string().nullish(),
          last_commit: z.string().nullish(),
          file_types: z.record(z.string(), z.number()).optional(),
          daily_activity: z.record(z.string(), z.number()).optional(),
        })).min(1),
        assessments: z.array(z.object({
          email: z.string().email(),
          security: z.number(),
          quality: z.number(),
          patterns: z.number(),
          testing: z.number(),
          innovation: z.number(),
          notes: z.string().optional(),
          feedback: z.string().optional(),
        })).optional(),
      }),
    },
  }, async (request, reply) => {
    authorizePublic(request);

    const body = request.body;

    const result = await ingestContributors({
      repoName: body.repo_name,
      repoUrl: body.repo_url,
      workspaceId: body.workspace_id,
      executionId: body.execution_id,
      contributors: body.contributors,
      assessments: body.assessments,
    });

    return reply.status(201).send({
      ingested: Object.keys(result.contributorIds).length,
      contributor_ids: result.contributorIds,
      new_assessments: result.newAssessments,
    });
  });

  // ── GET /api/contributors ────────────────────────────────────────
  app.get('/contributors', {
    schema: {
      querystring: z.object({
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
        sort: z.string().default('score_overall'),
        dir: z.enum(['asc', 'desc']).default('desc'),
        search: z.string().optional(),
        workspace_id: z.coerce.number().optional(),
      }),
    },
  }, async (request) => {
    const { limit, offset, sort: sortField, dir: sortDir, search, workspace_id } = request.query;

    if (workspace_id) {
      await authorize(request, workspace_id, 'member');
    } else if (request.user?.role === 'super_admin') {
      request.authorized = true;
    } else {
      throw new ForbiddenError('workspace_id is required');
    }

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

    const conditions: SQL[] = [];

    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        sql`(${contributors.displayName} ILIKE ${pattern} OR EXISTS (SELECT 1 FROM unnest(${contributors.emails}) e WHERE e ILIKE ${pattern}))`,
      );
    }
    if (workspace_id) {
      conditions.push(
        sql`${contributors.id} IN (SELECT contributor_id FROM contributor_repo_stats WHERE workspace_id = ${workspace_id})`,
      );
    }

    const whereClause = conditions.length > 0
      ? and(...conditions)
      : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributors)
      .where(whereClause);

    const orderExpr = sortDir === 'asc'
      ? asc(sortCol)
      : desc(sortCol);

    const results = await db
      .select()
      .from(contributors)
      .where(whereClause)
      .orderBy(sql`${orderExpr} NULLS LAST`)
      .limit(limit)
      .offset(offset);

    return {
      count: countResult.count,
      results,
    };
  });

  // ── GET /api/contributors/:id ────────────────────────────────────
  app.get('/contributors/:id', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const rows = await db
      .select()
      .from(contributors)
      .where(eq(contributors.id, id));

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Contributor not found' });
    }
    const contributor = rows[0];
    if (contributor.workspaceId) {
      await authorize(request, contributor.workspaceId, 'member');
    } else if (request.user?.role === 'super_admin') {
      request.authorized = true;
    } else {
      throw new ForbiddenError('Contributor has no workspace');
    }
    return contributor;
  });

  // ── GET /api/contributors/:id/activity ───────────────────────────
  app.get('/contributors/:id/activity', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
      querystring: z.object({
        weeks: z.coerce.number().min(1).max(104).default(52),
      }),
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { weeks } = request.query;

    // Fetch contributor to authorize by workspace
    const [contributor] = await db
      .select({ workspaceId: contributors.workspaceId })
      .from(contributors)
      .where(eq(contributors.id, id));

    if (!contributor) {
      return reply.status(404).send({ error: 'Contributor not found' });
    }

    if (contributor.workspaceId) {
      await authorize(request, contributor.workspaceId, 'member');
    } else if (request.user?.role === 'super_admin') {
      request.authorized = true;
    } else {
      throw new ForbiddenError('Contributor has no workspace');
    }

    return db
      .select({
        activityDate: contributorDailyActivity.activityDate,
        commitCount: sql<number>`sum(${contributorDailyActivity.commitCount})::int`,
      })
      .from(contributorDailyActivity)
      .where(
        and(
          eq(contributorDailyActivity.contributorId, id),
          sql`${contributorDailyActivity.activityDate} >= CURRENT_DATE - (${weeks} * 7)::INTEGER`,
        ),
      )
      .groupBy(contributorDailyActivity.activityDate)
      .orderBy(asc(contributorDailyActivity.activityDate));
  });

  // ── GET /api/contributors/:id/repos ──────────────────────────────
  app.get('/contributors/:id/repos', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
    },
  }, async (request, reply) => {
    const { id } = request.params;

    // Fetch contributor to authorize by workspace
    const [contributor] = await db
      .select({ workspaceId: contributors.workspaceId })
      .from(contributors)
      .where(eq(contributors.id, id));

    if (!contributor) {
      return reply.status(404).send({ error: 'Contributor not found' });
    }

    if (contributor.workspaceId) {
      await authorize(request, contributor.workspaceId, 'member');
    } else if (request.user?.role === 'super_admin') {
      request.authorized = true;
    } else {
      throw new ForbiddenError('Contributor has no workspace');
    }

    // Include total commits per repo (sum across all contributors)
    const repoTotals = db
      .select({
        repoName: contributorRepoStats.repoName,
        totalCommits: sql<number>`coalesce(sum(${contributorRepoStats.commitCount}), 0)::int`.as('total_commits'),
      })
      .from(contributorRepoStats)
      .groupBy(contributorRepoStats.repoName)
      .as('repo_totals');

    return db
      .select({
        id: contributorRepoStats.id,
        contributorId: contributorRepoStats.contributorId,
        repoName: contributorRepoStats.repoName,
        repoUrl: contributorRepoStats.repoUrl,
        commitCount: contributorRepoStats.commitCount,
        locAdded: contributorRepoStats.locAdded,
        locRemoved: contributorRepoStats.locRemoved,
        firstCommit: contributorRepoStats.firstCommit,
        lastCommit: contributorRepoStats.lastCommit,
        fileTypes: contributorRepoStats.fileTypes,
        updatedAt: contributorRepoStats.updatedAt,
        repoTotalCommits: repoTotals.totalCommits,
      })
      .from(contributorRepoStats)
      .leftJoin(repoTotals, eq(contributorRepoStats.repoName, repoTotals.repoName))
      .where(eq(contributorRepoStats.contributorId, id))
      .orderBy(sql`${contributorRepoStats.lastCommit} DESC NULLS LAST`);
  });

  // ── GET /api/contributors/:id/assessments ────────────────────────
  app.get('/contributors/:id/assessments', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
    },
  }, async (request, reply) => {
    const { id } = request.params;

    // Fetch contributor to authorize by workspace
    const [contributor] = await db
      .select({ workspaceId: contributors.workspaceId })
      .from(contributors)
      .where(eq(contributors.id, id));

    if (!contributor) {
      return reply.status(404).send({ error: 'Contributor not found' });
    }

    if (contributor.workspaceId) {
      await authorize(request, contributor.workspaceId, 'member');
    } else if (request.user?.role === 'super_admin') {
      request.authorized = true;
    } else {
      throw new ForbiddenError('Contributor has no workspace');
    }

    return db
      .select()
      .from(contributorAssessments)
      .where(eq(contributorAssessments.contributorId, id))
      .orderBy(desc(contributorAssessments.assessedAt));
  });

  // ── PATCH /api/contributors/bulk ──────────────────────────────────
  app.patch('/contributors/bulk', {
    schema: {
      body: z.object({
        ids: z.array(z.number()).min(1),
        team_id: z.number().positive().nullable(),
      }),
    },
  }, async (request) => {
    const { ids, team_id } = request.body;

    // Resolve workspace from first contributor
    const [first] = await db.select({ wsId: contributors.workspaceId })
      .from(contributors)
      .where(eq(contributors.id, ids[0]))
      .limit(1);
    if (!first) throw new ForbiddenError('Contributor not found');
    await authorize(request, first.wsId, 'workspace_admin');

    await db.update(contributors)
      .set({ teamId: team_id, updatedAt: new Date() })
      .where(inArray(contributors.id, ids));

    return { updated: ids.length };
  });

  // ── POST /api/contributors/:id/recompile-feedback ────────────────
  app.post('/contributors/:id/recompile-feedback', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
    },
  }, async (request, reply) => {
    const { id } = request.params;
    if (request.user?.role !== 'super_admin') throw new ForbiddenError('Admin only');
    // Import and call compileFeedback directly (runs on API container)
    const { compileFeedback } = await import('../orchestrator/feedback-worker.ts');
    await compileFeedback(id);
    return { compiled: true, contributorId: id };
  });

  // ── POST /api/contributors/merge ─────────────────────────────────
  app.post('/contributors/merge', {
    schema: {
      body: z.object({
        source_id: z.number(),
        target_id: z.number(),
      }),
    },
  }, async (request, reply) => {
    const { source_id, target_id } = request.body;

    // Fetch both contributors
    const sourceRows = await db.select().from(contributors).where(eq(contributors.id, source_id));
    const targetRows = await db.select().from(contributors).where(eq(contributors.id, target_id));

    if (sourceRows.length === 0 || targetRows.length === 0) {
      return reply.status(404).send({ error: 'Contributor not found' });
    }

    const source = sourceRows[0];
    const target = targetRows[0];

    // Cross-workspace guard
    if (source.workspaceId !== target.workspaceId) {
      return reply.status(400).send({ error: 'Contributors must be in the same workspace' });
    }

    // Authorize: must be workspace admin
    await authorize(request, source.workspaceId, 'workspace_admin');

    // Execute entire merge in a transaction
    await db.transaction(async (tx) => {
      // Merge emails
      const allEmails = [...new Set([...target.emails, ...source.emails])];
      await tx
        .update(contributors)
        .set({ emails: allEmails })
        .where(eq(contributors.id, target_id));

      // Reassign repo stats — for conflicts (same repo), keep target's version
      const sourceRepos = await tx
        .select({ repoName: contributorRepoStats.repoName })
        .from(contributorRepoStats)
        .where(eq(contributorRepoStats.contributorId, source_id));

      const targetRepos = await tx
        .select({ repoName: contributorRepoStats.repoName })
        .from(contributorRepoStats)
        .where(eq(contributorRepoStats.contributorId, target_id));

      const targetRepoNames = new Set(targetRepos.map((r) => r.repoName));

      for (const sr of sourceRepos) {
        if (targetRepoNames.has(sr.repoName)) {
          await tx
            .delete(contributorRepoStats)
            .where(
              and(
                eq(contributorRepoStats.contributorId, source_id),
                eq(contributorRepoStats.repoName, sr.repoName),
              ),
            );
        }
      }

      // Move remaining source repo stats to target
      await tx
        .update(contributorRepoStats)
        .set({ contributorId: target_id })
        .where(eq(contributorRepoStats.contributorId, source_id));

      // Reassign daily activity — upsert to handle same repo+date overlaps
      const sourceActivity = await tx
        .select({
          repoName: contributorDailyActivity.repoName,
          activityDate: contributorDailyActivity.activityDate,
          commitCount: contributorDailyActivity.commitCount,
        })
        .from(contributorDailyActivity)
        .where(eq(contributorDailyActivity.contributorId, source_id));

      for (const sa of sourceActivity) {
        await tx
          .insert(contributorDailyActivity)
          .values({
            contributorId: target_id,
            repoName: sa.repoName,
            activityDate: sa.activityDate,
            commitCount: sa.commitCount,
          })
          .onConflictDoUpdate({
            target: [contributorDailyActivity.contributorId, contributorDailyActivity.repoName, contributorDailyActivity.activityDate],
            set: {
              commitCount: sql`${contributorDailyActivity.commitCount} + excluded.commit_count`,
            },
          });
      }

      await tx
        .delete(contributorDailyActivity)
        .where(eq(contributorDailyActivity.contributorId, source_id));

      // Reassign findings
      await tx
        .update(findings)
        .set({ contributorId: target_id })
        .where(eq(findings.contributorId, source_id));

      // Reassign assessments — keep all, no unique constraint
      await tx
        .update(contributorAssessments)
        .set({ contributorId: target_id })
        .where(eq(contributorAssessments.contributorId, source_id));

      // Delete source
      await tx.delete(contributors).where(eq(contributors.id, source_id));
    });

    // Recompute scores and recompile feedback from all merged assessments
    await recomputeScores(target_id);
    queueFeedbackCompilation(target_id);

    const [merged] = await db.select().from(contributors).where(eq(contributors.id, target_id));
    return merged;
  });
};
