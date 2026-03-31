import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { pullRequests, scans, repositories, sources, teams } from '../db/schema.ts';
import {
  getPullRequest,
  listPullRequestsByRepository,
  getSource,
  createWorkspaceEvent,
} from '../orchestrator/entities.ts';
import { getSecret } from '../lib/vault.ts';
import { createScan } from '../orchestrator/db.ts';
import { BitBucketClient } from '../orchestrator/git-providers.ts';
import { authorize } from '../lib/authorize.ts';

export const pullRequestRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /api/pull-requests?repository_id=X — list PRs for a repo with latest scan info
  app.get('/pull-requests', {
    schema: {
      querystring: z.object({
        repository_id: z.coerce.number().positive(),
      }),
    },
  }, async (request, reply) => {
    const { repository_id: repositoryId } = request.query;

    // Resolve workspace from repository
    const [repoRow] = await db.select({ wsId: teams.workspaceId })
      .from(repositories)
      .innerJoin(teams, eq(repositories.teamId, teams.id))
      .where(eq(repositories.id, repositoryId))
      .limit(1);
    if (!repoRow) return reply.status(404).send({ error: 'Repository not found' });
    await authorize(request, repoRow.wsId, 'member');

    const prs = await listPullRequestsByRepository(repositoryId);

    // Enrich each PR with its latest scan info
    const enriched = await Promise.all(
      prs.map(async (pr) => {
        const latestScans = await db
          .select({
            id: scans.id,
            status: scans.status,
            scanType: scans.scanType,
            createdAt: scans.createdAt,
            completedAt: scans.completedAt,
          })
          .from(scans)
          .where(eq(scans.pullRequestId, pr.id))
          .orderBy(desc(scans.createdAt))
          .limit(1);

        return {
          ...pr,
          latest_scan: latestScans[0] ?? null,
          scan_count: await db
            .select({ count: sql<number>`count(*)::int` })
            .from(scans)
            .where(eq(scans.pullRequestId, pr.id))
            .then((rows) => rows[0]?.count ?? 0),
        };
      }),
    );

    return enriched;
  });

  // GET /api/pull-requests/:id — single PR with full scan history
  app.get('/pull-requests/:id', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const pr = await getPullRequest(id);
    if (!pr) {
      return reply.status(404).send({ error: 'Pull request not found' });
    }
    await authorize(request, pr.workspaceId, 'member');

    // Fetch all scans for this PR
    const prScans = await db
      .select()
      .from(scans)
      .where(eq(scans.pullRequestId, pr.id))
      .orderBy(desc(scans.createdAt));

    return {
      ...pr,
      scans: prScans,
    };
  });

  // POST /api/pull-requests/:id/scan — manually trigger a PR scan
  app.post('/pull-requests/:id/scan', {
    schema: {
      params: z.object({ id: z.coerce.number() }),
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const pr = await getPullRequest(id);
    if (!pr) {
      return reply.status(404).send({ error: 'Pull request not found' });
    }
    await authorize(request, pr.workspaceId, 'member');

    // Get the repository
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, pr.repositoryId));
    if (!repo) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    // Get the source
    if (!repo.sourceId) {
      return reply.status(400).send({ error: 'Repository has no source configured' });
    }
    const integration = await getSource(repo.sourceId);
    if (!integration) {
      return reply.status(404).send({ error: 'Source not found' });
    }

    // Get token from vault
    const token = await getSecret('source', integration.id, 'access_token');
    if (!token) {
      return reply.status(400).send({ error: 'No credentials configured for this integration' });
    }

    // Fetch changed files via diff (Bitbucket-specific for now)
    let changedFiles: string[] = [];
    if (integration.provider === 'bitbucket' && integration.orgName) {
      try {
        const bbClient = new BitBucketClient(integration.baseUrl, token, integration.credentialUsername ?? undefined);
        const diff = await bbClient.getPullRequestDiff(
          integration.orgName,
          repo.name,
          pr.externalId,
        );
        // Parse diff to extract changed file paths
        changedFiles = parseDiffFilePaths(diff);
      } catch (err: any) {
        console.warn(`Failed to fetch PR diff: ${err.message}`);
        await createWorkspaceEvent(pr.workspaceId, 'pr_diff_fetch_failed', {
          pull_request_id: pr.id,
          repository_name: repo.name,
          error: err.message,
        });
      }
    }

    // Create a scan linked to this PR
    const scan = await createScan({
      repoUrl: repo.repoUrl ?? undefined,
      repoName: repo.name,
      branch: pr.sourceBranch,
      workspaceId: pr.workspaceId,
      pullRequestId: pr.id,
      scanType: 'pr',
    });

    // DB worker will pick up the scan automatically

    // Update the scan with repository linkage
    await db
      .update(scans)
      .set({ repositoryId: repo.id })
      .where(eq(scans.id, scan.id));

    // Create workspace event
    await createWorkspaceEvent(pr.workspaceId, 'pr_scan_triggered', {
      pull_request_id: pr.id,
      pull_request_title: pr.title,
      repository_name: repo.name,
      scan_id: scan.id,
      changed_files_count: changedFiles.length,
    });

    return reply.status(201).send({
      scan,
      pull_request_id: pr.id,
      changed_files: changedFiles,
    });
  });
};

/**
 * Parse unified diff output to extract changed file paths.
 * Looks for lines like: +++ b/path/to/file.ts
 */
function parseDiffFilePaths(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      files.add(line.slice(6));
    }
  }
  return [...files];
}
