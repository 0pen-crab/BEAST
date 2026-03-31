import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { sources, repositories } from '../db/schema.ts';
import { upsertPullRequest, createWorkspaceEvent } from '../orchestrator/entities.ts';
import { createScan } from '../orchestrator/db.ts';
import { BitBucketClient } from '../orchestrator/git-providers.ts';
import { getSecret } from '../lib/vault.ts';

function verifyHmac(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  // Disable default JSON body parsing for raw body access (needed for HMAC verification)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/webhooks/bitbucket', async (request, reply) => {
    const rawBody = request.body as string;
    const eventKey = request.headers['x-event-key'] as string | undefined;
    const signature = request.headers['x-hub-signature'] as string | undefined;

    // Only handle PR events
    if (!eventKey?.startsWith('pullrequest:')) {
      return reply.status(200).send({ status: 'ignored', event: eventKey ?? null });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply.status(400).send({ error: 'Invalid JSON' });
    }

    // Find integration by matching workspace slug from payload
    const repoFullName = payload.repository?.full_name; // "workspace/repo"
    if (!repoFullName) return reply.status(400).send({ error: 'Missing repository info' });

    const [workspaceSlug, repoSlug] = repoFullName.split('/');

    // Find integration by orgName matching workspace slug
    const sourceRows = await db.select().from(sources)
      .where(and(
        eq(sources.provider, 'bitbucket'),
        eq(sources.orgName, workspaceSlug),
      ));

    if (sourceRows.length === 0) {
      return reply.status(404).send({ error: 'No matching source found' });
    }

    const integration = sourceRows[0];

    // Verify HMAC if signature is present
    if (signature) {
      const webhookSecret = await getSecret('source', integration.id, 'webhook_secret');
      if (webhookSecret && !verifyHmac(rawBody, signature, webhookSecret)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }
    }

    // Find matching repository
    const repoRows = await db.select().from(repositories)
      .where(and(
        eq(repositories.sourceId, integration.id),
        eq(repositories.name, repoSlug),
      ));

    if (repoRows.length === 0) {
      return reply.status(200).send({ status: 'ignored', reason: 'repository not tracked' });
    }

    const repo = repoRows[0];
    const pr = payload.pullrequest;

    // Upsert pull request
    const pullRequest = await upsertPullRequest({
      repositoryId: repo.id,
      workspaceId: integration.workspaceId,
      externalId: pr.id,
      title: pr.title ?? '',
      description: pr.description ?? null,
      author: pr.author?.display_name ?? pr.author?.username ?? 'unknown',
      sourceBranch: pr.source?.branch?.name ?? '',
      targetBranch: pr.destination?.branch?.name ?? '',
      status: (pr.state ?? 'OPEN').toLowerCase(),
      prUrl: pr.links?.html?.href ?? '',
    });

    // Only scan on created/updated (not declined/merged)
    if (eventKey === 'pullrequest:created' || eventKey === 'pullrequest:updated') {
      // Get credential for API calls
      const token = await getSecret('source', integration.id, 'access_token');

      // Fetch diff to get changed files
      let changedFiles: string[] = [];
      if (token) {
        try {
          const bbClient = new BitBucketClient(integration.baseUrl, token, integration.credentialUsername ?? undefined);
          const diff = await bbClient.getPullRequestDiff(workspaceSlug, repoSlug, pr.id);
          // Parse diff to extract file paths (lines starting with +++ b/ or --- a/)
          changedFiles = [...new Set(
            diff.split('\n')
              .filter(line => line.startsWith('+++ b/') || line.startsWith('--- a/'))
              .map(line => line.replace(/^(\+\+\+ b\/|--- a\/)/, ''))
              .filter(f => f !== '/dev/null'),
          )];
        } catch (err: any) {
          console.warn('Failed to fetch PR diff:', err.message);
          await createWorkspaceEvent(integration.workspaceId, 'pr_diff_fetch_failed', {
            repository_name: repoSlug,
            pr_id: pr.id,
            error: err.message,
          });
        }
      }

      // Create scan
      const scan = await createScan({
        repoUrl: repo.repoUrl ?? undefined,
        repoName: repo.name,
        branch: pr.source?.branch?.name,
        commitHash: pr.source?.commit?.hash,
        workspaceId: integration.workspaceId,
        repositoryId: repo.id,
        pullRequestId: pullRequest.id,
        scanType: 'pr',
      });

      // DB worker will pick up the scan automatically

      await createWorkspaceEvent(integration.workspaceId, 'pr_scan_triggered', {
        repository_name: repo.name,
        pr_id: pr.id,
        pr_title: pr.title,
        scan_id: scan.id,
      });

      return reply.status(200).send({
        status: 'scan_enqueued',
        scan_id: scan.id,
        pull_request_id: pullRequest.id,
        changed_files: changedFiles.length,
      });
    }

    return reply.status(200).send({ status: 'pr_updated', pull_request_id: pullRequest.id });
  });
};
