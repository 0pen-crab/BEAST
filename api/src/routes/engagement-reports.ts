import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getScanFiles } from '../orchestrator/entities.ts';
import { db } from '../db/index.ts';
import { scanFiles, scans, repositories, teams } from '../db/schema.ts';
import { eq, and, like, desc } from 'drizzle-orm';
import { authorize, ForbiddenError } from '../lib/authorize.ts';

export const engagementReportRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /api/scan-reports/:scanId — get both profile and audit reports for a scan
  app.get('/scan-reports/:scanId', {
    schema: {
      params: z.object({ scanId: z.string().uuid() }),
    },
  }, async (request, reply) => {
    const { scanId } = request.params;

    // Fetch scan to get workspace_id
    const [scan] = await db.select({ workspaceId: scans.workspaceId })
      .from(scans)
      .where(eq(scans.id, scanId));

    if (!scan) {
      return reply.status(404).send({ error: 'Scan not found' });
    }

    if (scan.workspaceId) {
      await authorize(request, scan.workspaceId, 'member');
    } else if (request.user?.role === 'super_admin') {
      request.authorized = true;
    } else {
      throw new ForbiddenError('Scan has no workspace');
    }

    const files = await getScanFiles(scanId);

    const reports: Record<string, { content: string; updatedAt: string }> = {};
    for (const f of files) {
      if (f.fileType === 'profile' || f.fileType === 'audit') {
        reports[f.fileType] = { content: f.content || '', updatedAt: f.createdAt?.toISOString() ?? '' };
      }
    }

    return reply.status(200).send(reports);
  });

  // GET /api/scan-reports/:scanId/:type — get a specific report
  app.get('/scan-reports/:scanId/:type', {
    schema: {
      params: z.object({
        scanId: z.string().uuid(),
        type: z.enum(['profile', 'audit']),
      }),
    },
  }, async (request, reply) => {
    const { scanId, type } = request.params;

    // Fetch scan to get workspace_id
    const [scan] = await db.select({ workspaceId: scans.workspaceId })
      .from(scans)
      .where(eq(scans.id, scanId));

    if (!scan) {
      return reply.status(404).send({ error: 'Scan not found' });
    }

    if (scan.workspaceId) {
      await authorize(request, scan.workspaceId, 'member');
    } else if (request.user?.role === 'super_admin') {
      request.authorized = true;
    } else {
      throw new ForbiddenError('Scan has no workspace');
    }

    const files = await getScanFiles(scanId);
    const file = files.find(f => f.fileType === type);

    if (!file) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    return reply.status(200).send({ content: file.content || '', updatedAt: file.createdAt?.toISOString() ?? '' });
  });

  // GET /api/scan-logs/:scanId — list available AI step logs
  app.get('/scan-logs/:scanId', {
    schema: {
      params: z.object({ scanId: z.string().uuid() }),
    },
  }, async (request, reply) => {
    const { scanId } = request.params;

    const [scan] = await db.select({ workspaceId: scans.workspaceId })
      .from(scans).where(eq(scans.id, scanId));
    if (!scan) return reply.status(404).send({ error: 'Scan not found' });
    if (scan.workspaceId) await authorize(request, scan.workspaceId, 'member');

    const logs = await db.select({
      id: scanFiles.id,
      fileName: scanFiles.fileName,
      fileType: scanFiles.fileType,
      createdAt: scanFiles.createdAt,
    }).from(scanFiles)
      .where(and(eq(scanFiles.scanId, scanId), like(scanFiles.fileType, 'log-%')));

    return reply.status(200).send(logs.map(l => ({
      step: l.fileType?.replace('log-', '') ?? '',
      fileName: l.fileName,
      createdAt: l.createdAt?.toISOString() ?? '',
    })));
  });

  // GET /api/scan-logs/:scanId/:step — get log content for a specific AI step
  app.get('/scan-logs/:scanId/:step', {
    schema: {
      params: z.object({
        scanId: z.string().uuid(),
        step: z.string(),
      }),
    },
  }, async (request, reply) => {
    const { scanId, step } = request.params;

    const [scan] = await db.select({ workspaceId: scans.workspaceId })
      .from(scans).where(eq(scans.id, scanId));
    if (!scan) return reply.status(404).send({ error: 'Scan not found' });
    if (scan.workspaceId) await authorize(request, scan.workspaceId, 'member');

    const [file] = await db.select({ content: scanFiles.content })
      .from(scanFiles)
      .where(and(eq(scanFiles.scanId, scanId), eq(scanFiles.fileType, `log-${step}`)))
      .limit(1);

    if (!file?.content) return reply.status(404).send({ error: 'Log not found' });

    return reply.header('Content-Type', 'text/plain').send(file.content);
  });

  // GET /api/scan-artifacts/:repositoryId — list raw scan artifacts for latest completed scan
  app.get('/scan-artifacts/:repositoryId', {
    schema: {
      params: z.object({ repositoryId: z.coerce.number() }),
    },
  }, async (request, reply) => {
    const { repositoryId } = request.params;

    // Join repo → team to get workspace_id
    const [repo] = await db.select({ workspaceId: teams.workspaceId })
      .from(repositories)
      .innerJoin(teams, eq(repositories.teamId, teams.id))
      .where(eq(repositories.id, repositoryId));

    if (!repo) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    await authorize(request, repo.workspaceId, 'member');

    // Find latest completed scan for this repo
    const [latestScan] = await db.select({ id: scans.id })
      .from(scans)
      .where(and(eq(scans.repositoryId, repositoryId), eq(scans.status, 'completed')))
      .orderBy(desc(scans.completedAt))
      .limit(1);

    if (!latestScan) {
      return reply.status(200).send({ artifacts: [] });
    }

    const files = await db.select({
      id: scanFiles.id,
      fileName: scanFiles.fileName,
      fileType: scanFiles.fileType,
      createdAt: scanFiles.createdAt,
    }).from(scanFiles)
      .where(and(eq(scanFiles.scanId, latestScan.id), like(scanFiles.fileType, 'raw-%')));

    const artifacts = files.map(f => ({
      id: f.id,
      fileName: f.fileName,
      tool: f.fileType?.replace('raw-', '') ?? '',
      createdAt: f.createdAt?.toISOString() ?? '',
    }));

    return reply.status(200).send({ scanId: latestScan.id, artifacts });
  });

  // GET /api/scan-artifacts/:repositoryId/:tool/download — download raw artifact
  app.get('/scan-artifacts/:repositoryId/:tool/download', {
    schema: {
      params: z.object({
        repositoryId: z.coerce.number(),
        tool: z.string(),
      }),
    },
  }, async (request, reply) => {
    const { repositoryId, tool } = request.params;

    // Join repo → team to get workspace_id
    const [repo] = await db.select({ workspaceId: teams.workspaceId })
      .from(repositories)
      .innerJoin(teams, eq(repositories.teamId, teams.id))
      .where(eq(repositories.id, repositoryId));

    if (!repo) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    await authorize(request, repo.workspaceId, 'member');

    const [latestScan] = await db.select({ id: scans.id })
      .from(scans)
      .where(and(eq(scans.repositoryId, repositoryId), eq(scans.status, 'completed')))
      .orderBy(desc(scans.completedAt))
      .limit(1);

    if (!latestScan) {
      return reply.status(404).send({ error: 'No completed scan found' });
    }

    const [file] = await db.select()
      .from(scanFiles)
      .where(and(eq(scanFiles.scanId, latestScan.id), eq(scanFiles.fileType, `raw-${tool}`)))
      .limit(1);

    if (!file || !file.content) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    const contentType = file.fileName.endsWith('.sarif') || file.fileName.endsWith('.json')
      ? 'application/json'
      : 'text/plain';

    return reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(file.content);
  });
};
