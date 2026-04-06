import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and, desc, asc, sql, inArray, getTableColumns, type SQL } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { teams, repositories, scans, tests, findings, findingNotes, scanFiles, contributors } from '../db/schema.ts';
import type { NewTeam, NewRepository } from '../db/schema.ts';
import { authorize, ForbiddenError } from '../lib/authorize.ts';

/** Mask a secret value, showing only the first 4 and last 2 characters. */
function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return '*'.repeat(value.length);
  return value.slice(0, 4) + '*'.repeat(value.length - 6) + value.slice(-2);
}

export const workspaceDataRoutes: FastifyPluginAsyncZod = async (app) => {
  // ═══════════════════════════════════════════════════════════════
  // TEAMS
  // ═══════════════════════════════════════════════════════════════

  const teamSelectFields = {
    id: teams.id,
    workspaceId: teams.workspaceId,
    name: teams.name,
    description: teams.description,
    createdAt: teams.createdAt,
    repoCount: sql<number>`(select count(*) from repositories r where r.team_id = "teams"."id")::int`,
    contributorCount: sql<number>`(select count(*) from contributors c where c.team_id = "teams"."id")::int`,
    findingsCount: sql<number>`(select count(*) from findings f where f.repository_id in (select r.id from repositories r where r.team_id = "teams"."id") and f.status = 'open')::int`,
    avgRiskScore: sql<number>`(select coalesce(avg(sub.risk), 0) from (select least(10, round((coalesce(sum(
      (case when f2.severity = 'Critical' then 10 when f2.severity = 'High' then 5 when f2.severity = 'Medium' then 2 when f2.severity = 'Low' then 0.5 else 0 end)
    ), 0) / 5.0)::numeric, 1)) as risk from repositories r2 left join findings f2 on f2.repository_id = r2.id and f2.status = 'open' where r2.team_id = "teams"."id" group by r2.id) sub)::float`,
  };

  // GET /api/teams?workspace_id=X
  app.get(
    '/teams',
    {
      schema: {
        querystring: z.object({
          workspace_id: z.coerce.number().positive().optional(),
        }),
      },
    },
    async (request) => {
      const { workspace_id } = request.query;

      if (!workspace_id) {
        if (request.user?.role !== 'super_admin') {
          throw new ForbiddenError('workspace_id is required');
        }
        return db.select(teamSelectFields).from(teams).orderBy(asc(teams.createdAt));
      }

      await authorize(request, workspace_id, 'member');

      return db.select(teamSelectFields).from(teams)
        .where(eq(teams.workspaceId, workspace_id))
        .orderBy(asc(teams.createdAt));
    },
  );

  // GET /api/teams/:id
  app.get(
    '/teams/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const rows = await db.select(teamSelectFields).from(teams).where(eq(teams.id, id));
      if (rows.length === 0)
        return reply.status(404).send({ error: 'Team not found' });

      const team = rows[0];
      await authorize(request, team.workspaceId, 'member');

      return team;
    },
  );

  // POST /api/teams
  app.post(
    '/teams',
    {
      schema: {
        body: z.object({
          workspace_id: z.number(),
          name: z.string().min(1).max(256),
          description: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { workspace_id, name, description } = request.body;

      await authorize(request, workspace_id, 'workspace_admin');

      const [row] = await db.insert(teams).values({
        workspaceId: workspace_id,
        name,
        description: description ?? null,
      }).returning();
      return reply.status(201).send(row);
    },
  );

  // PUT /api/teams/:id
  app.put(
    '/teams/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({
          name: z.string().min(1).max(256).optional(),
          description: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, description } = request.body;

      const existing = await db.select().from(teams).where(eq(teams.id, id));
      if (existing.length === 0)
        return reply.status(404).send({ error: 'Team not found' });

      await authorize(request, existing[0].workspaceId, 'workspace_admin');

      const updates: Partial<NewTeam> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;

      const rows = await db.update(teams)
        .set(updates)
        .where(eq(teams.id, id))
        .returning();
      return rows[0];
    },
  );

  // DELETE /api/teams/:id
  app.delete(
    '/teams/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const existing = await db.select().from(teams).where(eq(teams.id, id));
      if (existing.length === 0)
        return reply.status(404).send({ error: 'Team not found' });

      await authorize(request, existing[0].workspaceId, 'workspace_admin');

      await db.delete(teams).where(eq(teams.id, id));
      return { deleted: true };
    },
  );

  // GET /api/teams/:id/contributors
  app.get(
    '/teams/:id/contributors',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const teamRows = await db.select().from(teams).where(eq(teams.id, id));
      if (teamRows.length === 0)
        return reply.status(404).send({ error: 'Team not found' });
      await authorize(request, teamRows[0].workspaceId, 'member');

      const rows = await db
        .select()
        .from(contributors)
        .where(eq(contributors.teamId, id))
        .orderBy(sql`${contributors.scoreOverall} DESC NULLS LAST`);
      return rows;
    },
  );

  // ═══════════════════════════════════════════════════════════════
  // REPOSITORIES
  // ═══════════════════════════════════════════════════════════════

  // GET /api/repositories?workspace_id=X or ?team_id=X
  app.get(
    '/repositories',
    {
      schema: {
        querystring: z.object({
          workspace_id: z.coerce.number().positive().optional(),
          team_id: z.coerce.number().positive().optional(),
        }),
      },
    },
    async (request) => {
      const { workspace_id, team_id } = request.query;

      if (workspace_id) {
        await authorize(request, workspace_id, 'member');
      } else if (team_id) {
        const teamRows = await db.select({ workspaceId: teams.workspaceId }).from(teams).where(eq(teams.id, team_id)).limit(1);
        if (teamRows.length === 0) throw new ForbiddenError('Team not found');
        await authorize(request, teamRows[0].workspaceId, 'member');
      } else {
        if (request.user?.role !== 'super_admin') {
          throw new ForbiddenError('workspace_id or team_id is required');
        }
      }

      const conditions: SQL[] = [];

      if (team_id) {
        conditions.push(eq(repositories.teamId, team_id));
      }
      if (workspace_id) {
        conditions.push(eq(teams.workspaceId, workspace_id));
      }

      return db.select({
        ...getTableColumns(repositories),
        teamName: teams.name,
        workspaceId: teams.workspaceId,
        findingsCount: sql<number>`(select count(*) from findings f where f.repository_id = ${repositories.id} and f.status = 'open')::int`,
        riskScore: sql<number>`(select least(10, round((coalesce(sum(
          (case when f.severity = 'Critical' then 10 when f.severity = 'High' then 5 when f.severity = 'Medium' then 2 when f.severity = 'Low' then 0.5 else 0 end)
          * (case when f.tool in ('gitleaks','trufflehog','gitguardian','trivy-secrets') then 1.2 when f.tool = 'beast' then 1.0 else 0.8 end)
        ), 0) / 5.0)::numeric, 1)) from findings f where f.repository_id = ${repositories.id} and f.status = 'open')::float`,
        lastScannedAt: sql<string | null>`(select max(s.created_at) from scans s where s.repository_id = ${repositories.id})`,
      }).from(repositories)
        .innerJoin(teams, eq(teams.id, repositories.teamId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(repositories.createdAt));
    },
  );

  // PATCH /api/repositories/bulk — bulk update repos (assign team, change status)
  app.patch(
    '/repositories/bulk',
    {
      schema: {
        body: z.object({
          ids: z.array(z.number()).min(1),
          team_id: z.number().positive().optional(),
          status: z.enum(['pending', 'ignored']).optional(),
        }),
      },
    },
    async (request) => {
      const { ids, team_id, status } = request.body;

      // Fetch first repo to resolve workspace
      const wsRows = await db.select({ wsId: teams.workspaceId })
        .from(repositories)
        .innerJoin(teams, eq(repositories.teamId, teams.id))
        .where(eq(repositories.id, ids[0]))
        .limit(1);
      if (wsRows.length === 0) throw new ForbiddenError('Repository not found');
      await authorize(request, wsRows[0].wsId, 'workspace_admin');

      if (team_id) {
        await db.update(repositories)
          .set({ teamId: team_id, updatedAt: new Date() })
          .where(inArray(repositories.id, ids));
      }

      if (status) {
        await db.update(repositories)
          .set({ status, updatedAt: new Date() })
          .where(inArray(repositories.id, ids));
      }

      return { updated: ids.length };
    },
  );

  // GET /api/repositories/:id
  app.get(
    '/repositories/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const rows = await db.select({
        ...getTableColumns(repositories),
        teamName: teams.name,
        workspaceId: teams.workspaceId,
        findingsCount: sql<number>`(select count(*) from findings f where f.repository_id = ${repositories.id} and f.status = 'open')::int`,
        riskScore: sql<number>`(select least(10, round((coalesce(sum(
          (case when f.severity = 'Critical' then 10 when f.severity = 'High' then 5 when f.severity = 'Medium' then 2 when f.severity = 'Low' then 0.5 else 0 end)
          * (case when f.tool in ('gitleaks','trufflehog','gitguardian','trivy-secrets') then 1.2 when f.tool = 'beast' then 1.0 else 0.8 end)
        ), 0) / 5.0)::numeric, 1)) from findings f where f.repository_id = ${repositories.id} and f.status = 'open')::float`,
        lastScannedAt: sql<string | null>`(select max(s.created_at) from scans s where s.repository_id = ${repositories.id})`,
      }).from(repositories)
        .innerJoin(teams, eq(teams.id, repositories.teamId))
        .where(eq(repositories.id, id));
      if (rows.length === 0)
        return reply.status(404).send({ error: 'Repository not found' });

      await authorize(request, rows[0].workspaceId, 'member');

      return rows[0];
    },
  );

  // PUT /api/repositories/:id
  app.put(
    '/repositories/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({
          name: z.string().min(1).max(256).optional(),
          description: z.string().optional(),
          lifecycle: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, description, lifecycle, tags } = request.body;

      // Resolve workspace via team
      const wsRows = await db.select({ wsId: teams.workspaceId })
        .from(repositories)
        .innerJoin(teams, eq(repositories.teamId, teams.id))
        .where(eq(repositories.id, id))
        .limit(1);
      if (wsRows.length === 0)
        return reply.status(404).send({ error: 'Repository not found' });

      await authorize(request, wsRows[0].wsId, 'workspace_admin');

      const updates: Partial<NewRepository> & { updatedAt: Date } = { updatedAt: new Date() };
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (lifecycle !== undefined) updates.lifecycle = lifecycle;
      if (tags !== undefined) updates.tags = tags;

      const rows = await db.update(repositories)
        .set(updates)
        .where(eq(repositories.id, id))
        .returning();
      if (rows.length === 0)
        return reply.status(404).send({ error: 'Repository not found' });
      return rows[0];
    },
  );

  // GET /api/repositories/:id/reports — profile + audit from latest completed scan
  app.get(
    '/repositories/:id/reports',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Resolve workspace via team
      const wsRows = await db.select({ wsId: teams.workspaceId })
        .from(repositories)
        .innerJoin(teams, eq(repositories.teamId, teams.id))
        .where(eq(repositories.id, id))
        .limit(1);
      if (wsRows.length === 0)
        return reply.status(404).send({ error: 'Repository not found' });

      await authorize(request, wsRows[0].wsId, 'member');

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
        if (!reports[row.fileType!]) {
          reports[row.fileType!] = { content: row.content || '', updated_at: row.createdAt as unknown as string };
        }
      }

      return reports;
    },
  );

  // DELETE /api/repositories/:id
  app.delete(
    '/repositories/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Resolve workspace via team
      const wsRows = await db.select({ wsId: teams.workspaceId })
        .from(repositories)
        .innerJoin(teams, eq(repositories.teamId, teams.id))
        .where(eq(repositories.id, id))
        .limit(1);
      if (wsRows.length === 0)
        return reply.status(404).send({ error: 'Repository not found' });

      await authorize(request, wsRows[0].wsId, 'workspace_admin');

      await db.delete(repositories).where(eq(repositories.id, id));
      return { deleted: true };
    },
  );

  // ═══════════════════════════════════════════════════════════════
  // TESTS
  // ═══════════════════════════════════════════════════════════════

  // GET /api/tests?scan_id=X or ?repository_id=X
  app.get(
    '/tests',
    {
      schema: {
        querystring: z.object({
          scan_id: z.string().optional(),
          repository_id: z.coerce.number().positive().optional(),
        }),
      },
    },
    async (request) => {
      const { scan_id, repository_id } = request.query;

      if (scan_id) {
        // Resolve workspace from scan
        const scanRows = await db.select({ workspaceId: scans.workspaceId }).from(scans).where(eq(scans.id, scan_id)).limit(1);
        if (scanRows.length > 0 && scanRows[0].workspaceId) {
          await authorize(request, scanRows[0].workspaceId, 'member');
        } else if (request.user?.role !== 'super_admin') {
          throw new ForbiddenError('Cannot resolve workspace for scan');
        }

        return db.select().from(tests)
          .where(eq(tests.scanId, scan_id))
          .orderBy(asc(tests.createdAt));
      }

      if (repository_id) {
        // Resolve workspace from repo via team
        const wsRows = await db.select({ wsId: teams.workspaceId })
          .from(repositories)
          .innerJoin(teams, eq(repositories.teamId, teams.id))
          .where(eq(repositories.id, repository_id))
          .limit(1);
        if (wsRows.length > 0) {
          await authorize(request, wsRows[0].wsId, 'member');
        } else if (request.user?.role !== 'super_admin') {
          throw new ForbiddenError('Cannot resolve workspace for repository');
        }

        // Tests for a repository: join through scans
        return db.select({
          ...getTableColumns(tests),
        }).from(tests)
          .innerJoin(scans, eq(scans.id, tests.scanId))
          .where(eq(scans.repositoryId, repository_id))
          .orderBy(desc(tests.createdAt));
      }

      // No filter — only super_admin
      if (request.user?.role !== 'super_admin') {
        throw new ForbiddenError('workspace_id, scan_id, or repository_id is required');
      }

      return db.select().from(tests)
        .orderBy(desc(tests.createdAt))
        .limit(100);
    },
  );

  // GET /api/tests/:id
  app.get(
    '/tests/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const rows = await db.select({
        ...getTableColumns(tests),
        workspaceId: scans.workspaceId,
      }).from(tests)
        .innerJoin(scans, eq(scans.id, tests.scanId))
        .where(eq(tests.id, id));
      if (rows.length === 0)
        return reply.status(404).send({ error: 'Test not found' });

      const test = rows[0];
      if (test.workspaceId) {
        await authorize(request, test.workspaceId, 'member');
      } else if (request.user?.role !== 'super_admin') {
        throw new ForbiddenError('Cannot resolve workspace for test');
      }

      return test;
    },
  );

  // ═══════════════════════════════════════════════════════════════
  // FINDINGS
  // ═══════════════════════════════════════════════════════════════

  // GET /api/findings?workspace_id=X with filters
  app.get(
    '/findings',
    {
      schema: {
        querystring: z.object({
          workspace_id: z.coerce.number().positive().optional(),
          severity: z.string().optional(),
          status: z.string().optional(),
          tool: z.string().optional(),
          repository_id: z.coerce.number().positive().optional(),
          test_id: z.coerce.number().positive().optional(),
          limit: z.coerce.number().min(1).max(500).default(50),
          offset: z.coerce.number().min(0).default(0),
          sort: z.enum(['severity', 'created_at', 'updated_at', 'title', 'tool', 'status', 'cvss_score', 'repository', 'contributor', 'file_path']).default('created_at'),
          dir: z.enum(['asc', 'desc']).default('desc'),
          include_secrets: z.coerce.boolean().default(false),
        }),
      },
    },
    async (request) => {
      const { workspace_id, severity, status, tool, repository_id, test_id, limit, offset, sort, dir, include_secrets } = request.query;

      if (workspace_id) {
        await authorize(request, workspace_id, 'member');
      } else if (request.user?.role !== 'super_admin') {
        throw new ForbiddenError('workspace_id is required');
      }

      const conditions: SQL[] = [];

      // Workspace filter: findings → tests → scans → workspace_id
      if (workspace_id) {
        const workspaceTestIds = db.select({ id: tests.id }).from(tests)
          .innerJoin(scans, eq(tests.scanId, scans.id))
          .where(eq(scans.workspaceId, workspace_id));
        conditions.push(inArray(findings.testId, workspaceTestIds));
      }

      if (severity) {
        const vals = severity.split(',');
        conditions.push(vals.length === 1 ? eq(findings.severity, vals[0]) : inArray(findings.severity, vals));
      }
      if (status) {
        const vals = status.split(',');
        conditions.push(vals.length === 1 ? eq(findings.status, vals[0]) : inArray(findings.status, vals));
      }
      if (tool) {
        const vals = tool.split(',');
        conditions.push(vals.length === 1 ? eq(findings.tool, vals[0]) : inArray(findings.tool, vals));
      }
      if (repository_id) {
        conditions.push(eq(findings.repositoryId, repository_id));
      }
      if (test_id) {
        conditions.push(eq(findings.testId, test_id));
      }

      const whereClause = conditions.length ? and(...conditions) : undefined;

      // Sorting
      const sortColumns: Record<string, any> = {
        severity: findings.severity,
        created_at: findings.createdAt,
        updated_at: findings.updatedAt,
        title: findings.title,
        tool: findings.tool,
        status: findings.status,
        cvss_score: findings.cvssScore,
        repository: sql`(SELECT ${repositories.name} FROM ${repositories} WHERE ${repositories.id} = ${findings.repositoryId})`,
        contributor: sql`(SELECT ${contributors.displayName} FROM ${contributors} WHERE ${contributors.id} = ${findings.contributorId})`,
        file_path: findings.filePath,
      };
      const sortColumn = sortColumns[sort];
      const sortDir = dir === 'asc' ? asc(sortColumn) : desc(sortColumn);

      // Count
      const [countRow] = await db.select({
        count: sql<number>`count(*)`,
      }).from(findings).where(whereClause);

      // Data — include contributor name + repository name + scanId via JOINs
      const rows = await db.select({
        ...getTableColumns(findings),
        contributorName: contributors.displayName,
        repositoryName: repositories.name,
        scanId: scans.id,
      }).from(findings)
        .innerJoin(tests, eq(tests.id, findings.testId))
        .innerJoin(scans, eq(scans.id, tests.scanId))
        .leftJoin(contributors, eq(contributors.id, findings.contributorId))
        .leftJoin(repositories, eq(repositories.id, findings.repositoryId))
        .where(whereClause)
        .orderBy(sortDir)
        .limit(limit)
        .offset(offset);

      return {
        count: Number(countRow.count),
        results: include_secrets ? rows : rows.map(r => ({ ...r, secretValue: maskSecret(r.secretValue) })),
      };
    },
  );

  // GET /api/findings/counts?workspace_id=X
  app.get(
    '/findings/counts',
    {
      schema: {
        querystring: z.object({
          workspace_id: z.coerce.number().positive().optional(),
          repository_id: z.coerce.number().positive().optional(),
          test_id: z.coerce.number().positive().optional(),
        }),
      },
    },
    async (request) => {
      const { workspace_id, repository_id, test_id } = request.query;

      if (workspace_id) {
        await authorize(request, workspace_id, 'member');
      } else if (request.user?.role !== 'super_admin') {
        throw new ForbiddenError('workspace_id is required');
      }

      const conditions: SQL[] = [];

      if (workspace_id) {
        const workspaceTestIds = db.select({ id: tests.id }).from(tests)
          .innerJoin(scans, eq(tests.scanId, scans.id))
          .where(eq(scans.workspaceId, workspace_id));
        conditions.push(inArray(findings.testId, workspaceTestIds));
      }
      if (repository_id) {
        conditions.push(eq(findings.repositoryId, repository_id));
      }
      if (test_id) {
        conditions.push(eq(findings.testId, test_id));
      }

      const whereClause = conditions.length ? and(...conditions) : undefined;

      const [row] = await db.select({
        Critical: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Critical')::int`,
        High: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'High')::int`,
        Medium: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Medium')::int`,
        Low: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Low')::int`,
        Info: sql<number>`count(*) filter (where ${findings.status} = 'open' and ${findings.severity} = 'Info')::int`,
        total: sql<number>`count(*) filter (where ${findings.status} = 'open')::int`,
        riskAccepted: sql<number>`count(*) filter (where ${findings.status} = 'risk_accepted')::int`,
      }).from(findings).where(whereClause);

      return row;
    },
  );

  // GET /api/findings/counts-by-tool?workspace_id=X&repository_ids=1,2,3
  app.get(
    '/findings/counts-by-tool',
    {
      schema: {
        querystring: z.object({
          workspace_id: z.coerce.number().positive().optional(),
          repository_ids: z.string().optional(),
        }),
      },
    },
    async (request) => {
      const { workspace_id, repository_ids } = request.query;

      if (workspace_id) {
        await authorize(request, workspace_id, 'member');
      } else if (request.user?.role !== 'super_admin') {
        throw new ForbiddenError('workspace_id is required');
      }

      const conditions: SQL[] = [];
      if (workspace_id) {
        const workspaceScans = db.select({ id: tests.id })
          .from(tests)
          .innerJoin(scans, eq(scans.id, tests.scanId))
          .where(eq(scans.workspaceId, workspace_id));
        conditions.push(inArray(findings.testId, workspaceScans));
      }
      if (repository_ids) {
        const repoIds = repository_ids.split(',').map(Number).filter((n) => n > 0);
        if (repoIds.length > 0) {
          conditions.push(inArray(findings.repositoryId, repoIds));
        }
      }
      const whereClause = conditions.length ? and(...conditions) : undefined;

      const rows = await db.select({
        tool: findings.tool,
        active: sql<number>`count(*) filter (where ${findings.status} = 'open')::int`,
        dismissed: sql<number>`count(*) filter (where ${findings.status} in ('false_positive', 'risk_accepted', 'duplicate'))::int`,
      }).from(findings).where(whereClause).groupBy(findings.tool).orderBy(asc(findings.tool));

      return rows;
    },
  );

  // GET /api/findings/:id
  app.get(
    '/findings/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Fetch finding and resolve workspace via test → scan, include contributor name
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
      if (rows.length === 0)
        return reply.status(404).send({ error: 'Finding not found' });

      const finding = rows[0];
      if (finding.workspaceId) {
        await authorize(request, finding.workspaceId, 'member');
      } else if (request.user?.role !== 'super_admin') {
        throw new ForbiddenError('Cannot resolve workspace for finding');
      }

      return { ...finding, secretValue: maskSecret(finding.secretValue) };
    },
  );

  // PATCH /api/findings/:id
  app.patch(
    '/findings/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({
          status: z.string().optional(),
          risk_accepted_reason: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { status, risk_accepted_reason } = request.body;

      // Resolve workspace via test → scan
      const wsRows = await db.select({ workspaceId: scans.workspaceId })
        .from(findings)
        .innerJoin(tests, eq(tests.id, findings.testId))
        .innerJoin(scans, eq(scans.id, tests.scanId))
        .where(eq(findings.id, id));
      if (wsRows.length === 0)
        return reply.status(404).send({ error: 'Finding not found' });

      if (wsRows[0].workspaceId) {
        await authorize(request, wsRows[0].workspaceId, 'workspace_admin');
      } else if (request.user?.role !== 'super_admin') {
        throw new ForbiddenError('Cannot resolve workspace for finding');
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (status !== undefined) updates.status = status;
      if (risk_accepted_reason !== undefined) updates.riskAcceptedReason = risk_accepted_reason;

      // Only updatedAt was added — no real fields to update
      if (Object.keys(updates).length === 1) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      const rows = await db.update(findings)
        .set(updates)
        .where(eq(findings.id, id))
        .returning();
      if (rows.length === 0)
        return reply.status(404).send({ error: 'Finding not found' });
      return rows[0];
    },
  );

  // GET /api/findings/:id/notes
  app.get(
    '/findings/:id/notes',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Resolve workspace via finding → test → scan
      const wsRows = await db.select({ workspaceId: scans.workspaceId })
        .from(findings)
        .innerJoin(tests, eq(tests.id, findings.testId))
        .innerJoin(scans, eq(scans.id, tests.scanId))
        .where(eq(findings.id, id));
      if (wsRows.length === 0)
        return reply.status(404).send({ error: 'Finding not found' });

      if (wsRows[0].workspaceId) {
        await authorize(request, wsRows[0].workspaceId, 'member');
      } else if (request.user?.role !== 'super_admin') {
        throw new ForbiddenError('Cannot resolve workspace for finding');
      }

      return db.select().from(findingNotes)
        .where(eq(findingNotes.findingId, id))
        .orderBy(asc(findingNotes.createdAt));
    },
  );

  // POST /api/findings/:id/notes
  app.post(
    '/findings/:id/notes',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({
          content: z.string().optional(),
          entry: z.string().optional(),
          author: z.string().optional(),
          note_type: z.string().optional(),
        }).refine(
          (data) => data.content || data.entry,
          { message: 'Either content or entry is required' },
        ),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;
      const content = body.content || body.entry || '';
      const author = body.author || 'user';
      const noteType = body.note_type || 'comment';

      // Resolve workspace via finding → test → scan
      const wsRows = await db.select({ workspaceId: scans.workspaceId })
        .from(findings)
        .innerJoin(tests, eq(tests.id, findings.testId))
        .innerJoin(scans, eq(scans.id, tests.scanId))
        .where(eq(findings.id, id));
      if (wsRows.length === 0)
        return reply.status(404).send({ error: 'Finding not found' });

      if (wsRows[0].workspaceId) {
        await authorize(request, wsRows[0].workspaceId, 'workspace_admin');
      } else if (request.user?.role !== 'super_admin') {
        throw new ForbiddenError('Cannot resolve workspace for finding');
      }

      const [row] = await db.insert(findingNotes).values({
        findingId: id,
        author,
        noteType,
        content,
      }).returning();
      return reply.status(201).send(row);
    },
  );
};
