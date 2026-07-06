import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { scans, scanSteps, scanModules, repositories } from '../db/schema.ts';
import { createScan, getScan, listScans } from '../orchestrator/db.ts';
import { cleanupFailedScanData } from '../orchestrator/cleanup.ts';
import { authorize, authorizeSuperAdmin, authorizePublic, ForbiddenError } from '../lib/authorize.ts';
import { truncateScanErrorForList, trimStepPayloadForApi } from '../lib/sanitize.ts';
import { resumeWorker } from './worker-status.ts';
import * as fs from 'fs';
import * as path from 'path';

const ARTIFACTS_BASE = process.env.ARTIFACTS_PATH || '/data/scan-artifacts';

/** True when a client-supplied path segment is a single safe name:
 *  no separators, no parent-dir escapes, not empty. */
function isSafePathSegment(segment: string): boolean {
  return segment.length > 0
    && !segment.includes('/')
    && !segment.includes('\\')
    && !segment.includes('..')
    && segment !== '.';
}

/** Resolve `parts` under ARTIFACTS_BASE and ensure the result stays inside it. */
function resolveInsideArtifactsBase(...parts: string[]): string | null {
  const resolved = path.resolve(ARTIFACTS_BASE, ...parts);
  const base = path.resolve(ARTIFACTS_BASE);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

export const scanRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /api/scans/stats — aggregate scan statistics
  app.get('/scans/stats', {
    schema: {
      querystring: z.object({
        workspace_id: z.coerce.number().optional(),
      }),
    },
  }, async (request) => {
    const { workspace_id: workspaceId } = request.query;

    if (workspaceId) {
      await authorize(request, workspaceId, 'member');
    } else {
      authorizeSuperAdmin(request);
    }

    const whereClause = workspaceId ? eq(scans.workspaceId, workspaceId) : undefined;

    const [stats] = await db.select({
      total: sql<number>`COUNT(*)::int`,
      queued: sql<number>`COUNT(*) FILTER (WHERE ${scans.status} = 'queued')::int`,
      running: sql<number>`COUNT(*) FILTER (WHERE ${scans.status} = 'running')::int`,
      paused: sql<number>`COUNT(*) FILTER (WHERE ${scans.status} = 'paused')::int`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${scans.status} = 'completed')::int`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${scans.status} = 'failed')::int`,
      avg_duration_sec: sql<number | null>`ROUND(AVG(EXTRACT(EPOCH FROM (${scans.completedAt} - ${scans.startedAt}))) FILTER (WHERE ${scans.status} = 'completed'))::int`,
      earliest_active: sql<string | null>`MIN(${scans.createdAt}) FILTER (WHERE ${scans.status} = 'running' OR ${scans.status} = 'queued' OR ${scans.status} = 'paused')`,
    }).from(scans).where(whereClause);

    return stats;
  });

  // POST /api/scans — trigger a new scan
  app.post('/scans', {
    schema: {
      body: z.object({
        repositoryId: z.number(),
        branch: z.string().optional(),
        commitHash: z.string().optional(),
        scanType: z.string().optional(),
        changedFiles: z.array(z.string()).optional(),
      }),
    },
  }, async (request, reply) => {
    const body = request.body;

    // Look up repository to get repoUrl, repoName, workspaceId
    const [repo] = await db.select()
      .from(repositories)
      .where(eq(repositories.id, body.repositoryId));

    if (!repo) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    // Get workspaceId from the repo's team
    const teamRow = await db.execute(sql`
      SELECT workspace_id FROM teams WHERE id = ${repo.teamId}
    `);
    const workspaceId = (teamRow[0] as any)?.workspace_id;

    await authorize(request, workspaceId, 'workspace_admin');

    const scanType = body.scanType || 'full';

    // Local paths (from uploads) start with '/' — pass as localPath, not repoUrl
    const isLocalPath = repo.repoUrl?.startsWith('/') ?? false;

    const scan = await createScan({
      repoUrl: isLocalPath ? undefined : (repo.repoUrl || undefined),
      localPath: isLocalPath ? repo.repoUrl! : undefined,
      repoName: repo.name,
      branch: body.branch?.trim() || undefined,
      commitHash: body.commitHash?.trim() || undefined,
      workspaceId,
      repositoryId: body.repositoryId,
      scanType,
    });

    await db.update(repositories)
      .set({ status: 'queued', updatedAt: sql`NOW()` })
      .where(eq(repositories.id, body.repositoryId));

    return reply.status(201).send(scan);
  });

  // GET /api/scans — list scans
  app.get('/scans', {
    schema: {
      querystring: z.object({
        limit: z.coerce.number().min(1).max(500).default(20),
        offset: z.coerce.number().min(0).default(0),
        workspace_id: z.coerce.number().optional(),
        status: z.string().optional(),
        repository_id: z.coerce.number().optional(),
      }),
    },
  }, async (request) => {
    const { limit, offset, workspace_id: workspaceId, status, repository_id: repositoryId } = request.query;

    if (workspaceId) {
      await authorize(request, workspaceId, 'member');
    } else {
      authorizeSuperAdmin(request);
    }

    // List rows never include step input/output (listScans selects scans only),
    // but LEGACY failed scans can carry multi-MB error blobs — truncate at
    // serialization so /scans?limit=10 stays a few KB, not 10.5MB.
    const { count, results } = await listScans(limit, offset, workspaceId, status, repositoryId);
    return {
      count,
      results: results.map((s) => ({ ...s, error: truncateScanErrorForList(s.error) })),
    };
  });

  // GET /api/scans/:id — get single scan with step progress
  app.get('/scans/:id', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const scan = await getScan(id);
    if (!scan) {
      return reply.status(404).send({ error: 'Scan not found' });
    }

    if (!scan.workspaceId) throw new ForbiddenError('Scan has no workspace');
    await authorize(request, scan.workspaceId, 'member');

    // Join scan_steps. Step input/output is trimmed for SERVING only: the
    // import step's staged plan (preparedFindings/resultFiles/… ≈10MB) lives
    // in scan_steps.output as the commit/resume mechanism and must stay in
    // the DB untouched — but serialized inline it made this endpoint 21–30MB.
    const stepRows = await db.select().from(scanSteps)
      .where(eq(scanSteps.scanId, id))
      .orderBy(scanSteps.stepOrder);
    const steps = stepRows.map((s) => ({
      ...s,
      input: trimStepPayloadForApi(s.input),
      output: trimStepPayloadForApi(s.output),
    }));

    // Sniper module progress (only meaningful when scan is paused or running mid-AI-research)
    const moduleRows = await db.select({ status: scanModules.status })
      .from(scanModules)
      .where(eq(scanModules.scanId, id));
    const moduleProgress = {
      total: moduleRows.length,
      completed: moduleRows.filter(m => m.status === 'completed').length,
    };

    return { ...scan, steps, moduleProgress };
  });

  // DELETE /api/scans/:id — remove a queued scan
  app.delete('/scans/:id', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const scan = await getScan(id);
    if (!scan) {
      return reply.status(404).send({ error: 'Scan not found' });
    }

    if (!scan.workspaceId) throw new ForbiddenError('Scan has no workspace');
    await authorize(request, scan.workspaceId, 'workspace_admin');

    if (scan.status !== 'queued') {
      return reply.status(409).send({ error: 'Only queued scans can be removed' });
    }

    // Cascade deletes scan_steps
    await db.delete(scans).where(eq(scans.id, id));

    // Reset repository status if no other active scans remain
    if (scan.repositoryId) {
      const [active] = await db.select({ count: sql<number>`count(*)::int` })
        .from(scans)
        .where(and(
          eq(scans.repositoryId, scan.repositoryId),
          inArray(scans.status, ['queued', 'running']),
        ));
      if (!active || active.count === 0) {
        // Determine status from last completed/failed scan, or 'pending'
        const [lastScan] = await db.select({ status: scans.status })
          .from(scans)
          .where(eq(scans.repositoryId, scan.repositoryId))
          .orderBy(sql`created_at DESC`)
          .limit(1);
        const repoStatus = lastScan?.status === 'completed' ? 'completed'
          : lastScan?.status === 'failed' ? 'failed' : 'pending';
        await db.update(repositories)
          .set({ status: repoStatus, updatedAt: sql`NOW()` })
          .where(eq(repositories.id, scan.repositoryId));
      }
    }

    return { deleted: true };
  });

  // POST /api/scans/:id/cancel — cancel a running scan
  app.post('/scans/:id/cancel', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const scan = await getScan(id);
    if (!scan) {
      return reply.status(404).send({ error: 'Scan not found' });
    }

    if (!scan.workspaceId) throw new ForbiddenError('Scan has no workspace');
    await authorize(request, scan.workspaceId, 'workspace_admin');

    if (scan.status !== 'running' && scan.status !== 'queued' && scan.status !== 'paused') {
      return reply.status(409).send({ error: 'Scan is not active' });
    }

    // Set status to failed — the pipeline checks for cancellation cooperatively
    await db.update(scans)
      .set({
        status: 'failed',
        error: 'Cancelled by user',
        completedAt: sql`NOW()`,
        resumesAt: null,
      })
      .where(eq(scans.id, id));

    if (scan.repositoryId) {
      await db.update(repositories)
        .set({ status: 'failed', updatedAt: sql`NOW()` })
        .where(eq(repositories.id, scan.repositoryId));
    }

    // A paused scan has NO active pipeline: no cancel-poller to abort it and no
    // worker failure path to run afterwards (the worker only cleans scans it was
    // actively running). Remove the partial repo data here, exactly like the
    // worker's failure path would. Running/queued scans keep the existing flow —
    // the pipeline notices the 'failed' status and the worker cleans up.
    if (scan.status === 'paused') {
      await cleanupFailedScanData(id, { repoName: scan.repoName, workspaceId: scan.workspaceId });
    }

    return { cancelled: true };
  });

  // POST /api/scans/:id/resume — manually resume a paused scan
  app.post('/scans/:id/resume', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const scan = await getScan(id);
    if (!scan) {
      return reply.status(404).send({ error: 'Scan not found' });
    }

    if (!scan.workspaceId) throw new ForbiddenError('Scan has no workspace');
    await authorize(request, scan.workspaceId, 'workspace_admin');

    if (scan.status !== 'paused') {
      return reply.status(409).send({ error: 'Only paused scans can be resumed' });
    }

    // Clear resumes_at so the worker poller picks it up on the next tick.
    // Status stays 'paused' until the worker transactionally claims it.
    await db.update(scans)
      .set({ resumesAt: null, error: null })
      .where(eq(scans.id, id));

    // Lift the GLOBAL worker pause too. A rate-limit pause sets an in-memory
    // worker flag (via /worker/pause); pollForWork() bails on isWorkerPaused()
    // before it ever queries for resumable scans. Clearing resumes_at alone
    // leaves the scan stuck — the user's "Resume now" must also unpause the worker.
    resumeWorker();

    return { resumed: true };
  });

  // POST /api/scans/cancel-all — cancel all running and queued scans
  app.post('/scans/cancel-all', {
    schema: {
      body: z.object({
        workspace_id: z.number().optional(),
      }),
    },
  }, async (request) => {
    const { workspace_id: workspaceId } = request.body;

    if (workspaceId) {
      await authorize(request, workspaceId, 'workspace_admin');
    } else {
      authorizeSuperAdmin(request);
    }

    const conditions = [inArray(scans.status, ['queued', 'running'])];
    if (workspaceId) {
      conditions.push(eq(scans.workspaceId, workspaceId));
    }

    const result = await db.update(scans)
      .set({
        status: 'failed',
        error: 'Cancelled by user',
        completedAt: sql`NOW()`,
      })
      .where(and(...conditions))
      .returning({ id: scans.id });

    return { cancelled: result.length };
  });

  // GET /api/scans/:id/steps/:stepName/artifacts — list artifact files
  app.get('/scans/:id/steps/:stepName/artifacts', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
        stepName: z.string(),
      }),
    },
  }, async (request, reply) => {
    const { id, stepName } = request.params;

    const scan = await getScan(id);
    if (!scan) {
      return reply.status(404).send({ error: 'Scan not found' });
    }

    if (!scan.workspaceId) throw new ForbiddenError('Scan has no workspace');
    await authorize(request, scan.workspaceId, 'member');

    if (!isSafePathSegment(stepName)) {
      return reply.status(400).send({ error: 'Invalid step name' });
    }

    const dir = resolveInsideArtifactsBase(id, stepName);
    if (!dir) {
      return reply.status(400).send({ error: 'Invalid step name' });
    }

    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs.readdirSync(dir).map(filename => {
      const stat = fs.statSync(path.join(dir, filename));
      return { filename, sizeBytes: stat.size };
    });

    return files;
  });

  // GET /api/scans/:id/steps/:stepName/artifacts/:filename — download artifact
  app.get('/scans/:id/steps/:stepName/artifacts/:filename', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
        stepName: z.string(),
        filename: z.string(),
      }),
    },
  }, async (request, reply) => {
    const { id, stepName, filename } = request.params;

    const scan = await getScan(id);
    if (!scan) {
      return reply.status(404).send({ error: 'Scan not found' });
    }

    if (!scan.workspaceId) throw new ForbiddenError('Scan has no workspace');
    await authorize(request, scan.workspaceId, 'member');

    if (!isSafePathSegment(stepName) || !isSafePathSegment(filename)) {
      return reply.status(400).send({ error: 'Invalid step name or filename' });
    }

    const filePath = resolveInsideArtifactsBase(id, stepName, filename);
    if (!filePath) {
      return reply.status(400).send({ error: 'Invalid step name or filename' });
    }

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    const stream = fs.createReadStream(filePath);
    return reply.type('application/octet-stream').send(stream);
  });
};
