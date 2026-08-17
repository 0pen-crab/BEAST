import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { repositories, sources as sourcesTable } from '../db/schema.ts';
import {
  createSource,
  getSource,
  listSources,
  updateSource,
  deleteSource,
  createWorkspaceEvent,
  ensureTeam,
} from '../orchestrator/entities.ts';
import { setSecret, getSecret } from '../lib/vault.ts';
import {
  parseGitUrl,
  createClient,
  BitBucketClient,
  GitHubClient,
  GitLabClient,
  LocalDirectoryClient,
  type DiscoveredRepo,
  type OrgType,
} from '../orchestrator/git-providers.ts';
import { authorize } from '../lib/authorize.ts';

export const sourceRoutes: FastifyPluginAsyncZod = async (app) => {

  // POST /api/sources — connect source, discover repos, do NOT import
  app.post(
    '/sources',
    {
      schema: {
        body: z.object({
          workspace_id: z.number(),
          provider: z.string().optional(),
          base_url: z.string().optional(),
          org_name: z.string().optional(),
          url: z.string().optional(),
          access_token: z.string().optional(),
          username: z.string().optional(),
        }).refine(
          (data) => data.url || (data.provider && (data.org_name || data.base_url)),
          { message: 'Provide either url (public) or provider + (org_name or base_url) (private)' },
        ),
      },
    },
    async (request, reply) => {
      const body = request.body;
      await authorize(request, body.workspace_id, 'workspace_admin');

      let provider: string;
      let baseUrl: string;
      let orgName: string;

      let repoSlug: string | undefined;

      if (body.url) {
        const parsed = parseGitUrl(body.url);
        if (!parsed) return reply.status(400).send({ error: 'Could not detect git provider from URL' });
        provider = parsed.provider;
        baseUrl = parsed.baseUrl;
        orgName = parsed.orgName;
        repoSlug = parsed.repoSlug;
      } else if (body.provider && (body.org_name || body.base_url)) {
        provider = body.provider;
        orgName = body.org_name ?? '';
        if (provider === 'local') {
          baseUrl = body.base_url ?? body.org_name ?? '';
          orgName = '';
        } else {
          baseUrl = body.base_url ?? getDefaultBaseUrl(provider);
        }
        // Server-wide listing (no org_name) is only supported for GitLab + token
        if (!orgName && provider !== 'gitlab') {
          return reply.status(400).send({
            error: `${provider} requires an organization/user name in the URL. Listing all token-accessible repos is only supported for GitLab.`,
          });
        }
      } else {
        return reply.status(400).send({ error: 'Provide either url (public) or provider + (org_name or base_url) (private)' });
      }

      // Resolve effective token: explicit > user-level PAT
      let effectiveToken = body.access_token ?? null;
      if (!effectiveToken && request.user) {
        effectiveToken = await getSecret('user', request.user.id, `${provider}_pat`);
      }

      // Detect org type (skip for single-repo URLs and server-wide listings without org_name)
      let orgType: string | null = null;
      if (provider !== 'local' && !repoSlug && orgName) {
        try {
          const client = createClient(provider, baseUrl, effectiveToken ?? undefined, body.username);
          orgType = await (client as any).detectOrgType(orgName);
        } catch (err: any) {
          if (err.message === 'RATE_LIMITED') {
            return reply.status(429).send({ error: 'RATE_LIMITED', provider });
          }
          throw err;
        }
      }

      // Bitbucket-specific: validate token and detect scopes
      let detectedScopes: string[] = [];
      let bbClient: BitBucketClient | undefined;
      if (provider === 'bitbucket' && body.access_token) {
        if (!body.username) {
          return reply.status(400).send({ error: 'Bitbucket API tokens require your Atlassian account email (username field)' });
        }
        bbClient = new BitBucketClient(baseUrl, body.access_token, body.username);
        const validation = await bbClient.validateToken(orgName);
        if (!validation.valid) {
          // Don't blame the token for what may be a network/cert problem — say what
          // actually failed so the user fixes the right thing.
          const messages: Record<string, string> = {
            invalid_token: 'Invalid Bitbucket API token. Ensure the email and token are correct.',
            forbidden: 'The token is valid but lacks access to this workspace (check its scopes/permissions).',
            not_found: `Bitbucket workspace "${orgName}" was not found. Check the organization name.`,
            network: 'Could not reach Bitbucket — a network or TLS/certificate error occurred. The token may be fine; check connectivity, proxy, or certificate.',
            http_error: 'Bitbucket returned an unexpected error while validating the token.',
          };
          const reason = validation.reason ?? 'invalid_token';
          return reply.status(reason === 'network' ? 502 : 400).send({
            error: messages[reason] ?? messages.invalid_token,
            reason,
            detail: validation.detail,
          });
        }
        detectedScopes = await bbClient.detectScopes(orgName);
        if (!detectedScopes.some(s => s.includes('repository'))) {
          return reply.status(400).send({
            error: 'Token must have at least repository:read scope',
            detected_scopes: detectedScopes,
          });
        }
      }

      // Check for existing source with same provider+org
      const existing = await db.select().from(sourcesTable)
        .where(and(
          eq(sourcesTable.workspaceId, body.workspace_id),
          eq(sourcesTable.provider, provider),
          eq(sourcesTable.orgName, orgName || ''),
        ))
        .limit(1);

      let source: typeof existing[0];
      let createdSource = false;
      if (existing.length > 0) {
        if (!repoSlug) {
          // Org-level duplicate — reject
          return reply.status(409).send({ error: `Source "${orgName || provider}" is already connected` });
        }
        // Single-repo from an existing source — reuse it
        source = existing[0];
      } else {
        // Create new source record
        source = await createSource({
          workspaceId: body.workspace_id,
          provider,
          baseUrl,
          orgName: orgName || undefined,
          orgType: orgType ?? undefined,
        });
        createdSource = true;
      }

      // Create credential if token provided
      if (body.access_token) {
        await setSecret({
          name: `${provider} token for ${orgName}`,
          value: body.access_token,
          workspaceId: body.workspace_id,
          ownerType: 'source',
          ownerId: source.id,
          label: 'access_token',
        });
        await updateSource(source.id, {
          credentialType: 'pat',
          credentialUsername: body.username || null,
        });
      }

      // Store detected scopes
      if (detectedScopes.length > 0) {
        await updateSource(source.id, { detectedScopes });
      }

      // Discover repos (but do NOT import them into DB)
      let discoveredRepos: DiscoveredRepo[] = [];
      let discoveryError: string | undefined;
      try {
        const client = createClient(provider, baseUrl, effectiveToken ?? undefined, body.username);
        if (repoSlug) {
          // Single-repo: skip detectOrgType, use getRepo
          const singleRepo = await (client as any).getRepo(orgName, repoSlug, effectiveToken ?? undefined);
          discoveredRepos = [singleRepo];
        } else if (provider === 'local') {
          discoveredRepos = await (client as LocalDirectoryClient).listRepos(baseUrl);
        } else if (!orgName && provider === 'gitlab') {
          // Server-wide listing for self-hosted GitLab: all repos accessible to the token
          discoveredRepos = await (client as GitLabClient).listAccessibleRepos();
        } else {
          discoveredRepos = await (client as GitHubClient | GitLabClient | BitBucketClient).listRepos(
            orgName, (orgType ?? 'organization') as OrgType, effectiveToken ?? undefined,
          );
        }
      } catch (err: any) {
        if (err.message === 'RATE_LIMITED') {
          if (createdSource) await deleteSource(source.id);
          return reply.status(429).send({ error: 'RATE_LIMITED', provider });
        }
        console.error('Repo discovery failed:', err.message);
        discoveryError = err.message;
      }

      // Single-repo: discovery failure is fatal — no repos can be auto-imported.
      // Roll back the orphan source and return the error.
      if (repoSlug && discoveryError) {
        if (createdSource) await deleteSource(source.id);
        return reply.status(422).send({
          error: `Could not fetch repository: ${discoveryError}`,
          code: 'DISCOVERY_FAILED',
          provider,
        });
      }

      // Auto-import single repos inline (avoids a separate import call that hits rate limits)
      let autoImported = false;
      if (repoSlug && discoveredRepos.length > 0) {
        const team = await ensureTeam(body.workspace_id, 'Unassigned');
        for (const repo of discoveredRepos) {
          await db.insert(repositories).values({
            teamId: team.id,
            name: repo.name,
            repoUrl: repo.url,
            externalId: repo.externalId,
            sourceId: source.id,
            sizeBytes: repo.sizeBytes ?? null,
            primaryLanguage: repo.primaryLanguage ?? null,
            lastActivityAt: repo.lastActivityAt ? new Date(repo.lastActivityAt) : null,
            status: 'pending',
          }).onConflictDoUpdate({
            target: [repositories.teamId, repositories.name, repositories.sourceId],
            set: { repoUrl: repo.url },
          });
        }
        autoImported = true;
      }

      const capabilities = {
        repos: true,
      };

      return reply.status(201).send({
        source,
        auto_imported: autoImported,
        discovered_repos: discoveredRepos.map(r => ({
          slug: r.name,
          fullName: r.name,
          cloneUrl: r.url,
          description: r.description,
          externalId: r.externalId,
          imported: autoImported,
          sizeBytes: r.sizeBytes ?? null,
          primaryLanguage: r.primaryLanguage ?? null,
          lastActivityAt: r.lastActivityAt ?? null,
        })),
        capabilities,
        ...(discoveryError ? { discovery_error: discoveryError } : {}),
      });
    },
  );

  // GET /api/sources?workspace_id=X
  app.get(
    '/sources',
    {
      schema: {
        querystring: z.object({
          workspace_id: z.coerce.number().positive(),
        }),
      },
    },
    async (request) => {
      const { workspace_id } = request.query;
      await authorize(request, workspace_id, 'member');
      return listSources(workspace_id);
    },
  );

  // GET /api/sources/:id
  app.get(
    '/sources/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const source = await getSource(id);
      if (!source) return reply.status(404).send({ error: 'Not found' });
      await authorize(request, source.workspaceId, 'member');
      return source;
    },
  );

  // GET /api/sources/:id/repos — discoverable repos with imported flag
  app.get(
    '/sources/:id/repos',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const source = await getSource(id);
      if (!source) return reply.status(404).send({ error: 'Source not found' });
      await authorize(request, source.workspaceId, 'member');

      // Single-repo sources (orgName set, no orgType) and local uploads: repos are already in DB
      const isSingleRepoOrLocal = source.provider === 'local'
        || (!!source.orgName && !source.orgType);
      if (isSingleRepoOrLocal) {
        const imported = await db.select({
          name: repositories.name,
          sizeBytes: repositories.sizeBytes,
          repoUrl: repositories.repoUrl,
          primaryLanguage: repositories.primaryLanguage,
        })
          .from(repositories)
          .where(eq(repositories.sourceId, source.id));
        return imported.map((r) => ({
          slug: r.name,
          name: r.name,
          url: r.repoUrl ?? '',
          sizeBytes: r.sizeBytes ?? 0,
          primaryLanguage: r.primaryLanguage ?? null,
          imported: true,
        }));
      }

      // Resolve token: source-level > user-level PAT
      let token = await getSecret('source', source.id, 'access_token');
      if (!token && request.user) {
        token = await getSecret('user', request.user.id, `${source.provider}_pat`);
      }
      const client = createClient(source.provider, source.baseUrl, token ?? undefined, source.credentialUsername ?? undefined);

      let allRepos: DiscoveredRepo[];
      if (source.provider === 'local') {
        allRepos = await (client as LocalDirectoryClient).listRepos(source.baseUrl);
      } else if (source.provider === 'gitlab' && !source.orgName) {
        // Server-wide listing for GitLab without a specific group/user
        allRepos = await (client as GitLabClient).listAccessibleRepos();
      } else {
        const ot = (source.orgType ?? 'organization') as OrgType;
        allRepos = await (client as GitHubClient | GitLabClient | BitBucketClient).listRepos(
          source.orgName ?? '', ot, token ?? undefined,
        );
      }

      // Check which are already imported
      const existing = await db.select({ externalId: repositories.externalId })
        .from(repositories)
        .where(eq(repositories.sourceId, source.id));
      const importedIds = new Set(existing.map(r => r.externalId));

      return allRepos.map(r => ({
        slug: r.name,
        fullName: r.name,
        cloneUrl: r.url,
        description: r.description,
        externalId: r.externalId,
        imported: importedIds.has(r.externalId),
        sizeBytes: r.sizeBytes ?? null,
        primaryLanguage: r.primaryLanguage ?? null,
        lastActivityAt: r.lastActivityAt ?? null,
      }));
    },
  );

  // POST /api/sources/:id/import — selective repo import
  app.post(
    '/sources/:id/import',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({
          repos: z.array(z.string()).optional(),
          all: z.boolean().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;

      const source = await getSource(id);
      if (!source) return reply.status(404).send({ error: 'Source not found' });
      await authorize(request, source.workspaceId, 'workspace_admin');

      // Resolve token: source-level > user-level PAT
      let token = await getSecret('source', source.id, 'access_token');
      if (!token && request.user) {
        token = await getSecret('user', request.user.id, `${source.provider}_pat`);
      }
      const client = createClient(source.provider, source.baseUrl, token ?? undefined, source.credentialUsername ?? undefined);

      let allRepos: DiscoveredRepo[];
      try {
        if (source.provider === 'local') {
          allRepos = await (client as LocalDirectoryClient).listRepos(source.baseUrl);
        } else if (source.provider === 'gitlab' && !source.orgName) {
          // Server-wide listing for GitLab without a specific group/user
          allRepos = await (client as GitLabClient).listAccessibleRepos();
        } else {
          const ot = (source.orgType ?? 'organization') as OrgType;
          allRepos = await (client as GitHubClient | GitLabClient | BitBucketClient).listRepos(
            source.orgName ?? '', ot, token ?? undefined,
          );
        }
      } catch (err: any) {
        if (err.message === 'RATE_LIMITED') {
          return reply.status(429).send({ error: 'RATE_LIMITED', provider: source.provider });
        }
        throw err;
      }
      console.log(`[sources/import] source=${id} provider=${source.provider} orgName="${source.orgName ?? ''}" listed=${allRepos.length} requested=${body.all ? 'all' : (body.repos?.length ?? 0)}`);

      const toImport = body.all
        ? allRepos
        : allRepos.filter(r => body.repos?.includes(r.name));
      console.log(`[sources/import] toImport=${toImport.length}`);

      const team = await ensureTeam(source.workspaceId, 'Unassigned');

      // Get existing repos for this source
      const existing = await db.select({ externalId: repositories.externalId })
        .from(repositories)
        .where(eq(repositories.sourceId, source.id));
      const existingIds = new Set(existing.map(r => r.externalId));

      let imported = 0;
      let skipped = 0;
      for (const repo of toImport) {
        if (existingIds.has(repo.externalId)) continue;
        const result = await db.insert(repositories).values({
          teamId: team.id,
          name: repo.name,
          repoUrl: repo.url,
          description: repo.description,
          status: 'pending',
          externalId: repo.externalId,
          sourceId: source.id,
          sizeBytes: repo.sizeBytes ?? null,
          primaryLanguage: repo.primaryLanguage ?? null,
          lastActivityAt: repo.lastActivityAt ? new Date(repo.lastActivityAt) : null,
        }).onConflictDoNothing({ target: [repositories.teamId, repositories.name, repositories.sourceId] })
          .returning({ id: repositories.id });
        if (result.length === 0) {
          skipped++;
          continue;
        }
        await createWorkspaceEvent(source.workspaceId, 'repository_added', {
          repo_name: repo.name,
          source_id: source.id,
        });
        imported++;
      }

      await updateSource(source.id, { lastSyncedAt: new Date().toISOString() });

      return reply.send({ imported, skipped, total_available: allRepos.length });
    },
  );

  // PUT /api/sources/:id
  app.put(
    '/sources/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
        body: z.object({
          sync_interval_minutes: z.number().optional(),
          access_token: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;

      const source = await getSource(id);
      if (!source) return reply.status(404).send({ error: 'Not found' });
      await authorize(request, source.workspaceId, 'workspace_admin');

      if (body.sync_interval_minutes !== undefined) {
        await updateSource(id, { syncIntervalMinutes: body.sync_interval_minutes });
      }

      if (body.access_token) {
        await setSecret({
          name: `${source.provider} token`,
          value: body.access_token,
          workspaceId: source.workspaceId,
          ownerType: 'source',
          ownerId: id,
          label: 'access_token',
        });
      }

      const updated = await getSource(id);
      if (!updated) return reply.status(404).send({ error: 'Not found' });
      return updated;
    },
  );

  // DELETE /api/sources/:id
  app.delete(
    '/sources/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const source = await getSource(id);
      if (!source) return reply.status(404).send({ error: 'Not found' });
      await authorize(request, source.workspaceId, 'workspace_admin');

      await db.delete(repositories).where(eq(repositories.sourceId, id));
      await deleteSource(id);
      return reply.status(204).send();
    },
  );

  // POST /api/sources/:id/sync — manual re-sync
  app.post(
    '/sources/:id/sync',
    {
      schema: {
        params: z.object({ id: z.coerce.number() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const source = await getSource(id);
      if (!source) return reply.status(404).send({ error: 'Not found' });
      await authorize(request, source.workspaceId, 'workspace_admin');

      try {
        const { syncSource } = await import('../orchestrator/git-sync.ts');
        const result = await syncSource(id);
        return result;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  // POST /api/repos/add-url — create repo from a public URL
  app.post(
    '/repos/add-url',
    {
      schema: {
        body: z.object({
          url: z.string().min(1),
          workspace_id: z.number(),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body;
      await authorize(request, body.workspace_id, 'workspace_admin');

      // Extract repo name from URL
      const urlParts = body.url.replace(/\.git$/, '').split('/');
      const name = urlParts[urlParts.length - 1] || 'unknown';

      const team = await ensureTeam(body.workspace_id, 'Unassigned');
      const [repo] = await db.insert(repositories).values({
        teamId: team.id,
        name,
        repoUrl: body.url,
        status: 'pending',
      }).returning();

      await createWorkspaceEvent(body.workspace_id, 'repository_added', {
        repo_name: name,
        url: body.url,
      });

      return reply.status(201).send(repo);
    },
  );

  // POST /api/repos/upload — multipart archive upload (.zip, .tar, .tar.gz)
  app.post('/repos/upload', {}, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const workspaceId = (data.fields.workspace_id as any)?.value
      ?? (request.query as Record<string, unknown>).workspace_id;
    if (!workspaceId) return reply.status(400).send({ error: 'workspace_id required' });

    const wsId = Number(workspaceId);
    await authorize(request, wsId, 'workspace_admin');

    const { randomUUID } = await import('crypto');
    const { mkdirSync, createWriteStream, readdirSync, statSync, existsSync, rmSync } = await import('fs');
    const { join, relative, basename } = await import('path');
    const { execFileSync } = await import('child_process');
    const { pipeline } = await import('stream/promises');

    // The client controls data.filename — strip any path components before it
    // touches the filesystem, and validate the extension against an allowlist.
    const safeFilename = basename(data.filename);
    const lowerName = safeFilename.toLowerCase();
    let archiveType: 'zip' | 'tar' | 'tar.gz';
    if (lowerName.endsWith('.zip')) archiveType = 'zip';
    else if (lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz')) archiveType = 'tar.gz';
    else if (lowerName.endsWith('.tar')) archiveType = 'tar';
    else return reply.status(400).send({ error: 'Unsupported archive format. Use .zip, .tar, or .tar.gz' });

    const uploadId = randomUUID();
    const uploadDir = join(process.env.UPLOADS_PATH || '/workspace/uploads', uploadId);
    mkdirSync(uploadDir, { recursive: true });

    // Stream archive file to disk (avoids loading entire file into memory)
    const archivePath = join(uploadDir, safeFilename);
    await pipeline(data.file, createWriteStream(archivePath));

    // Extract with execFileSync + argv array — NO shell, so quotes/metacharacters
    // in the (client-controlled) filename cannot inject commands.
    const extractDir = join(uploadDir, 'extracted');
    mkdirSync(extractDir, { recursive: true });
    if (archiveType === 'zip') {
      execFileSync('unzip', ['-q', archivePath, '-d', extractDir]);
    } else if (archiveType === 'tar.gz') {
      execFileSync('tar', ['-xzf', archivePath, '-C', extractDir]);
    } else {
      execFileSync('tar', ['-xf', archivePath, '-C', extractDir]);
    }

    // macOS Finder injects __MACOSX/ alongside the real tree when zipping. Remove
    // it before walking — otherwise the scanner picks AppleDouble metadata as a
    // "repo" and produces 0 findings on the actual code.
    const macosxDir = join(extractDir, '__MACOSX');
    if (existsSync(macosxDir)) {
      rmSync(macosxDir, { recursive: true, force: true });
    }

    // Recursive walk: find all directories containing .git
    function findGitRepos(dir: string): string[] {
      const repos: string[] = [];
      const entries = readdirSync(dir);
      if (entries.includes('.git')) {
        repos.push(dir);
        return repos; // Don't recurse into nested .git repos
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory() && entry !== 'node_modules' && entry !== '.git') {
          repos.push(...findGitRepos(fullPath));
        }
      }
      return repos;
    }

    const gitRepoPaths = findGitRepos(extractDir);

    // If no .git dirs found, treat each top-level folder as a repo; if only one entry, treat the whole thing as one repo
    let repoPaths: { name: string; path: string }[];
    if (gitRepoPaths.length > 0) {
      repoPaths = gitRepoPaths.map((p) => {
        const rel = relative(extractDir, p);
        const name = basename(p).replace(/-(main|master|develop|dev)$/, '');
        return { name, path: p };
      });
    } else {
      const topEntries = readdirSync(extractDir).filter(
        (e) => statSync(join(extractDir, e)).isDirectory(),
      );
      if (topEntries.length > 1) {
        repoPaths = topEntries.map((e) => ({
          name: e.replace(/-(main|master|develop|dev)$/, ''),
          path: join(extractDir, e),
        }));
      } else {
        const name = topEntries.length === 1
          ? topEntries[0].replace(/-(main|master|develop|dev)$/, '')
          : safeFilename.replace(/\.zip$/i, '').replace(/-(main|master|develop|dev)$/, '');
        const path = topEntries.length === 1 ? join(extractDir, topEntries[0]) : extractDir;
        repoPaths = [{ name, path }];
      }
    }

    const folderName = safeFilename.replace(/\.zip$/i, '');

    // Create a single source for the upload
    const [source] = await db.insert(sourcesTable).values({
      workspaceId: wsId,
      provider: 'local',
      baseUrl: 'local://',
      orgName: `Uploaded "${folderName}"`,
    }).returning();

    const team = await ensureTeam(wsId, 'Unassigned');
    const createdRepos = [];

    for (const repo of repoPaths) {
      const [created] = await db.insert(repositories).values({
        teamId: team.id,
        name: repo.name,
        repoUrl: repo.path,
        status: 'pending',
        sourceId: source.id,
      }).onConflictDoUpdate({
        target: [repositories.teamId, repositories.name, repositories.sourceId],
        set: { status: 'pending' },
      }).returning();
      createdRepos.push(created);

      await createWorkspaceEvent(wsId, 'repository_added', {
        repo_name: repo.name,
        upload_id: uploadId,
        local_path: repo.path,
      });
    }

    return reply.status(201).send({
      source,
      repositories: createdRepos,
      count: createdRepos.length,
    });
  });
};

function getDefaultBaseUrl(provider: string): string {
  switch (provider) {
    case 'github': return 'https://api.github.com';
    case 'gitlab': return 'https://gitlab.com';
    case 'bitbucket': return 'https://api.bitbucket.org/2.0';
    default: return '';
  }
}
