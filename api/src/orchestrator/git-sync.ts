import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { repositories } from '../db/schema.ts';
import {
  getSource,
  updateSource,
  createWorkspaceEvent,
  ensureTeam,
} from './entities.ts';
import { getSecret } from '../lib/vault.ts';
import {
  createClient,
  GitHubClient,
  GitLabClient,
  BitBucketClient,
  LocalDirectoryClient,
  type DiscoveredRepo,
  type OrgType,
} from './git-providers.ts';

export async function syncSource(sourceId: number): Promise<{ added: number; updated: number }> {
  const source = await getSource(sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);

  const token = await getSecret('source', sourceId, 'access_token');

  // Fetch repos from provider
  let repos: DiscoveredRepo[];
  if (source.provider === 'local') {
    const client = new LocalDirectoryClient();
    repos = await client.listRepos(source.baseUrl);
  } else {
    const client = createClient(source.provider, source.baseUrl, token ?? undefined, source.credentialUsername ?? undefined);
    const orgType = (source.orgType ?? 'organization') as OrgType;
    repos = await (client as GitHubClient | GitLabClient | BitBucketClient).listRepos(
      source.orgName!,
      orgType,
      token ?? undefined,
    );
  }

  // Ensure "Unassigned" team exists in workspace
  const unassignedTeam = await ensureTeam(source.workspaceId, 'Unassigned');

  // Get existing repos linked to this source
  const existingRows = await db.select({
    id: repositories.id,
    externalId: repositories.externalId,
    name: repositories.name,
    repoUrl: repositories.repoUrl,
    description: repositories.description,
    sizeBytes: repositories.sizeBytes,
    primaryLanguage: repositories.primaryLanguage,
    lastActivityAt: repositories.lastActivityAt,
  })
    .from(repositories)
    .where(eq(repositories.sourceId, sourceId));

  const existingByExtId = new Map(
    existingRows.map((r) => [r.externalId, r]),
  );

  let added = 0;
  let updated = 0;

  for (const repo of repos) {
    const existing = existingByExtId.get(repo.externalId);

    if (!existing) {
      // Skip repos not yet imported — new repos are only added via explicit import (step 4)
      continue;
    } else {
      // Update metadata if changed
      const newLastActivity = repo.lastActivityAt ? new Date(repo.lastActivityAt) : null;
      const existingLastActivity = existing.lastActivityAt ? new Date(existing.lastActivityAt).toISOString() : null;
      const newLastActivityStr = newLastActivity ? newLastActivity.toISOString() : null;

      if (
        existing.name !== repo.name ||
        existing.repoUrl !== repo.url ||
        existing.description !== repo.description ||
        existing.sizeBytes !== (repo.sizeBytes ?? null) ||
        existing.primaryLanguage !== (repo.primaryLanguage ?? null) ||
        existingLastActivity !== newLastActivityStr
      ) {
        await db.update(repositories)
          .set({
            name: repo.name,
            repoUrl: repo.url,
            description: repo.description,
            sizeBytes: repo.sizeBytes ?? null,
            primaryLanguage: repo.primaryLanguage ?? null,
            lastActivityAt: newLastActivity,
            updatedAt: new Date(),
          })
          .where(eq(repositories.id, existing.id));
        updated++;
      }
    }
  }

  // Update last_synced_at
  await updateSource(sourceId, { lastSyncedAt: new Date().toISOString() });

  // Emit sync_completed event
  await createWorkspaceEvent(source.workspaceId, 'sync_completed', {
    source_id: sourceId,
    provider: source.provider,
    org_name: source.orgName,
    repos_added: added,
    repos_updated: updated,
    total_repos: repos.length,
  });

  return { added, updated };
}
