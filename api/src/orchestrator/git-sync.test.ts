import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/index.ts';

const mockDb = db as any;

// ── Entity mocks ────────────────────────────────────────────────────

const mockGetSource = vi.fn();
const mockUpdateSource = vi.fn();
const mockCreateWorkspaceEvent = vi.fn();
const mockEnsureTeam = vi.fn();

vi.mock('./entities.ts', () => ({
  getSource: (...args: unknown[]) => mockGetSource(...args),
  updateSource: (...args: unknown[]) => mockUpdateSource(...args),
  createWorkspaceEvent: (...args: unknown[]) => mockCreateWorkspaceEvent(...args),
  ensureTeam: (...args: unknown[]) => mockEnsureTeam(...args),
}));

// ── Vault mock ──────────────────────────────────────────────────────

const mockGetSecret = vi.fn();

vi.mock('../lib/vault.ts', () => ({
  getSecret: (...args: unknown[]) => mockGetSecret(...args),
}));

// ── Git provider mocks ──────────────────────────────────────────────

const mockLocalListRepos = vi.fn().mockResolvedValue([]);
const mockRemoteListRepos = vi.fn().mockResolvedValue([]);
const mockCreateClient = vi.fn().mockReturnValue({ listRepos: mockRemoteListRepos });

vi.mock('./git-providers.ts', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
  GitHubClient: vi.fn(),
  GitLabClient: vi.fn(),
  BitBucketClient: vi.fn(),
  LocalDirectoryClient: class {
    listRepos = mockLocalListRepos;
  },
}));

// ── DB mock reset ───────────────────────────────────────────────────

function resetMockDb() {
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMockDb();
  mockLocalListRepos.mockResolvedValue([]);
  mockRemoteListRepos.mockResolvedValue([]);
  mockCreateClient.mockReturnValue({ listRepos: mockRemoteListRepos });
});

// ── Helpers ─────────────────────────────────────────────────────────

function makeIntegration(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    workspaceId: 10,
    provider: 'local',
    baseUrl: '/repos',
    orgName: null,
    orgType: null,
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'ext-1',
    name: 'repo-1',
    url: 'https://example.com/repo-1',
    description: 'A repo',
    defaultBranch: 'main',
    sizeBytes: null as number | null,
    primaryLanguage: null as string | null,
    lastActivityAt: null as string | null,
    ...overrides,
  };
}

/** Set up the standard entity mocks for a local provider sync */
function setupLocalSync(
  integration = makeIntegration(),
  token: string | null = null,
  existingRows: unknown[] = [],
) {
  mockGetSource.mockResolvedValue(integration);
  mockGetSecret.mockResolvedValue(token);
  mockEnsureTeam.mockResolvedValue({ id: 5, name: 'Unassigned' });
  // db.select().from().where() returns existing repos
  mockDb.where.mockResolvedValueOnce(existingRows);
}

async function getSyncFn() {
  const { syncSource } = await import('./git-sync.ts');
  return syncSource;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('syncSource', () => {
  // ── Export ──────────────────────────────────────────────────────

  it('exports syncSource as a function', async () => {
    const mod = await import('./git-sync.ts');
    expect(typeof mod.syncSource).toBe('function');
  });

  // ── Integration not found ──────────────────────────────────────

  it('throws when integration not found', async () => {
    mockGetSource.mockResolvedValue(null);

    const syncSource = await getSyncFn();
    await expect(syncSource(999)).rejects.toThrow('Source 999 not found');
  });

  // ── Sync skips repos not yet imported ───────────────────────────

  it('skips new (unimported) repos and returns { added: 0, updated: 0 }', async () => {
    setupLocalSync();
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({ externalId: 'ext-1', name: 'repo-1' }),
      makeRepo({ externalId: 'ext-2', name: 'repo-2', url: 'https://example.com/repo-2' }),
    ]);

    const syncSource = await getSyncFn();
    const result = await syncSource(1);

    expect(result).toEqual({ added: 0, updated: 0 });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('does not emit repository_added events during sync', async () => {
    setupLocalSync();
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({ externalId: 'ext-1', name: 'repo-1' }),
      makeRepo({ externalId: 'ext-2', name: 'repo-2' }),
    ]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    const repoAddedCalls = mockCreateWorkspaceEvent.mock.calls.filter(
      (c: unknown[]) => c[1] === 'repository_added',
    );
    expect(repoAddedCalls).toHaveLength(0);
  });

  // ── Update path: metadata changed ─────────────────────────────

  it('updates repos with changed metadata and returns updated count', async () => {
    const existingRows = [
      { id: 100, externalId: 'ext-1', name: 'old-name', repoUrl: 'https://old.url', description: 'old desc',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
    ];
    setupLocalSync(makeIntegration(), null, existingRows);
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({ externalId: 'ext-1', name: 'new-name', url: 'https://new.url', description: 'new desc' }),
    ]);

    const syncSource = await getSyncFn();
    const result = await syncSource(1);

    expect(result).toEqual({ added: 0, updated: 1 });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({
      name: 'new-name',
      repoUrl: 'https://new.url',
      description: 'new desc',
    }));
  });

  it('updates metadata fields on existing repos during sync', async () => {
    const existingRows = [
      { id: 100, externalId: 'ext-1', name: 'repo-1', repoUrl: 'https://example.com/repo-1', description: 'A repo',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
    ];
    setupLocalSync(makeIntegration(), null, existingRows);
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({
        externalId: 'ext-1', name: 'repo-1', url: 'https://example.com/repo-1', description: 'A repo',
        sizeBytes: 2048000, primaryLanguage: 'TypeScript', lastActivityAt: '2026-03-01T12:00:00Z',
      }),
    ]);

    const syncSource = await getSyncFn();
    const result = await syncSource(1);

    expect(result).toEqual({ added: 0, updated: 1 });
    expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({
      sizeBytes: 2048000,
      primaryLanguage: 'TypeScript',
      lastActivityAt: new Date('2026-03-01T12:00:00Z'),
    }));
  });

  it('updates when only the name changes', async () => {
    const existingRows = [
      { id: 100, externalId: 'ext-1', name: 'old-name', repoUrl: 'https://example.com/repo-1', description: 'A repo',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
    ];
    setupLocalSync(makeIntegration(), null, existingRows);
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({ externalId: 'ext-1', name: 'renamed-repo', url: 'https://example.com/repo-1', description: 'A repo' }),
    ]);

    const syncSource = await getSyncFn();
    const result = await syncSource(1);

    expect(result).toEqual({ added: 0, updated: 1 });
  });

  it('updates when only the URL changes', async () => {
    const existingRows = [
      { id: 100, externalId: 'ext-1', name: 'repo-1', repoUrl: 'https://old.example.com/repo-1', description: 'A repo',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
    ];
    setupLocalSync(makeIntegration(), null, existingRows);
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({ externalId: 'ext-1', name: 'repo-1', url: 'https://new.example.com/repo-1', description: 'A repo' }),
    ]);

    const syncSource = await getSyncFn();
    const result = await syncSource(1);

    expect(result).toEqual({ added: 0, updated: 1 });
  });

  it('updates when only the description changes', async () => {
    const existingRows = [
      { id: 100, externalId: 'ext-1', name: 'repo-1', repoUrl: 'https://example.com/repo-1', description: 'old desc',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
    ];
    setupLocalSync(makeIntegration(), null, existingRows);
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({ externalId: 'ext-1', name: 'repo-1', url: 'https://example.com/repo-1', description: 'new desc' }),
    ]);

    const syncSource = await getSyncFn();
    const result = await syncSource(1);

    expect(result).toEqual({ added: 0, updated: 1 });
  });

  // ── No-op path: metadata unchanged ─────────────────────────────

  it('does not update repos when metadata is unchanged', async () => {
    const existingRows = [
      { id: 100, externalId: 'ext-1', name: 'repo-1', repoUrl: 'https://example.com/repo-1', description: 'A repo',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
    ];
    setupLocalSync(makeIntegration(), null, existingRows);
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({ externalId: 'ext-1', name: 'repo-1', url: 'https://example.com/repo-1', description: 'A repo' }),
    ]);

    const syncSource = await getSyncFn();
    const result = await syncSource(1);

    expect(result).toEqual({ added: 0, updated: 0 });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns { added: 0, updated: 0 } when provider returns empty list', async () => {
    setupLocalSync();
    mockLocalListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    const result = await syncSource(1);

    expect(result).toEqual({ added: 0, updated: 0 });
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  // ── Mixed: some new, some updated, some unchanged ──────────────

  it('handles a mix of new, updated, and unchanged repos (skips new)', async () => {
    const existingRows = [
      { id: 100, externalId: 'ext-1', name: 'repo-1', repoUrl: 'https://example.com/repo-1', description: 'desc-1',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
      { id: 101, externalId: 'ext-2', name: 'repo-2', repoUrl: 'https://example.com/repo-2', description: 'desc-2',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
    ];
    setupLocalSync(makeIntegration(), null, existingRows);
    mockLocalListRepos.mockResolvedValueOnce([
      // unchanged
      makeRepo({ externalId: 'ext-1', name: 'repo-1', url: 'https://example.com/repo-1', description: 'desc-1' }),
      // updated name
      makeRepo({ externalId: 'ext-2', name: 'repo-2-renamed', url: 'https://example.com/repo-2', description: 'desc-2' }),
      // new — skipped by sync (not yet imported)
      makeRepo({ externalId: 'ext-3', name: 'repo-3', url: 'https://example.com/repo-3', description: 'desc-3' }),
    ]);

    const syncSource = await getSyncFn();
    const result = await syncSource(1);

    expect(result).toEqual({ added: 0, updated: 1 });
  });

  // ── Error propagation ─────────────────────────────────────────

  it('propagates error when provider client throws', async () => {
    setupLocalSync();
    mockLocalListRepos.mockRejectedValueOnce(new Error('Disk read error'));

    const syncSource = await getSyncFn();
    await expect(syncSource(1)).rejects.toThrow('Disk read error');
  });

  it('propagates error when ensureTeam throws', async () => {
    mockGetSource.mockResolvedValue(makeIntegration());
    mockGetSecret.mockResolvedValue(null);
    mockEnsureTeam.mockRejectedValue(new Error('DB connection lost'));
    mockLocalListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await expect(syncSource(1)).rejects.toThrow('DB connection lost');
  });

  it('propagates error when db.update throws', async () => {
    const existingRows = [
      { id: 100, externalId: 'ext-1', name: 'old-name', repoUrl: 'https://old.url', description: 'old desc',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
    ];
    setupLocalSync(makeIntegration(), null, existingRows);
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({ externalId: 'ext-1', name: 'new-name', url: 'https://new.url', description: 'new desc' }),
    ]);
    // Make the update chain throw
    mockDb.set.mockImplementationOnce(() => { throw new Error('unique constraint'); });

    const syncSource = await getSyncFn();
    await expect(syncSource(1)).rejects.toThrow('unique constraint');
  });

  // ── Local provider path ────────────────────────────────────────

  it('uses LocalDirectoryClient for local provider', async () => {
    setupLocalSync(makeIntegration({ provider: 'local', baseUrl: '/my/repos' }));
    mockLocalListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    // LocalDirectoryClient.listRepos is called with the baseUrl
    expect(mockLocalListRepos).toHaveBeenCalledWith('/my/repos');
    // createClient should NOT be called for local provider
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  // ── Remote provider paths (GitHub, GitLab, Bitbucket) ──────────

  it('uses createClient for GitHub provider', async () => {
    setupLocalSync(makeIntegration({
      provider: 'github',
      baseUrl: 'https://api.github.com',
      orgName: 'my-org',
      orgType: 'organization',
    }), 'ghp_token123');
    mockRemoteListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    expect(mockGetSecret).toHaveBeenCalledWith('source', 1, 'access_token');
    expect(mockCreateClient).toHaveBeenCalledWith('github', 'https://api.github.com', 'ghp_token123', undefined);
    expect(mockRemoteListRepos).toHaveBeenCalledWith('my-org', 'organization', 'ghp_token123');
  });

  it('uses createClient for GitLab provider', async () => {
    setupLocalSync(makeIntegration({
      provider: 'gitlab',
      baseUrl: 'https://gitlab.com',
      orgName: 'my-group',
      orgType: 'group',
    }), 'glpat_token456');
    mockRemoteListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    expect(mockCreateClient).toHaveBeenCalledWith('gitlab', 'https://gitlab.com', 'glpat_token456', undefined);
    expect(mockRemoteListRepos).toHaveBeenCalledWith('my-group', 'group', 'glpat_token456');
  });

  it('creates Bitbucket client with email from source.credentialUsername', async () => {
    setupLocalSync(makeIntegration({
      provider: 'bitbucket',
      baseUrl: 'https://api.bitbucket.org/2.0',
      orgName: 'my-workspace',
      orgType: 'workspace',
      credentialUsername: 'user@bitbucket.org',
    }), 'bb_token789');
    mockRemoteListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    // source.credentialUsername is passed as email parameter to createClient
    expect(mockCreateClient).toHaveBeenCalledWith(
      'bitbucket',
      'https://api.bitbucket.org/2.0',
      'bb_token789',
      'user@bitbucket.org',
    );
    expect(mockRemoteListRepos).toHaveBeenCalledWith('my-workspace', 'workspace', 'bb_token789');
  });

  it('defaults orgType to "organization" when integration.orgType is null', async () => {
    setupLocalSync(makeIntegration({
      provider: 'github',
      baseUrl: 'https://api.github.com',
      orgName: 'my-org',
      orgType: null,
    }), 'token');
    mockRemoteListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    expect(mockRemoteListRepos).toHaveBeenCalledWith('my-org', 'organization', 'token');
  });

  it('passes undefined as email when source.credentialUsername is null', async () => {
    setupLocalSync(makeIntegration({
      provider: 'bitbucket',
      baseUrl: 'https://api.bitbucket.org/2.0',
      orgName: 'ws',
      orgType: 'workspace',
      credentialUsername: null,
    }), 'token');
    mockRemoteListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    expect(mockCreateClient).toHaveBeenCalledWith(
      'bitbucket',
      'https://api.bitbucket.org/2.0',
      'token',
      undefined,
    );
  });

  it('passes undefined as token when no credential exists for remote provider', async () => {
    setupLocalSync(makeIntegration({
      provider: 'github',
      baseUrl: 'https://api.github.com',
      orgName: 'public-org',
      orgType: 'organization',
    }), null);
    mockRemoteListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    expect(mockCreateClient).toHaveBeenCalledWith('github', 'https://api.github.com', undefined, undefined);
    expect(mockRemoteListRepos).toHaveBeenCalledWith('public-org', 'organization', undefined);
  });

  // ── lastSyncedAt ──────────────────────────────────────────────

  it('updates lastSyncedAt on the integration after sync', async () => {
    setupLocalSync(makeIntegration({ id: 42 }));
    mockLocalListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await syncSource(42);

    expect(mockUpdateSource).toHaveBeenCalledTimes(1);
    expect(mockUpdateSource).toHaveBeenCalledWith(42, expect.objectContaining({
      lastSyncedAt: expect.any(String),
    }));
  });

  it('lastSyncedAt is a valid ISO date string', async () => {
    setupLocalSync();
    mockLocalListRepos.mockResolvedValueOnce([]);

    const before = new Date();
    const syncSource = await getSyncFn();
    await syncSource(1);
    const after = new Date();

    const callArgs = mockUpdateSource.mock.calls[0];
    const syncedAt = new Date(callArgs[1].lastSyncedAt);
    expect(syncedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(syncedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  // ── Workspace event: sync_completed ───────────────────────────

  it('emits sync_completed event with correct payload', async () => {
    const integration = makeIntegration({ id: 7, workspaceId: 20, orgName: 'acme' });
    setupLocalSync(integration);
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({ externalId: 'ext-1' }),
      makeRepo({ externalId: 'ext-2' }),
    ]);

    const syncSource = await getSyncFn();
    await syncSource(7);

    const syncCompletedCalls = mockCreateWorkspaceEvent.mock.calls.filter(
      (c: unknown[]) => c[1] === 'sync_completed',
    );
    expect(syncCompletedCalls).toHaveLength(1);
    expect(syncCompletedCalls[0]).toEqual([
      20,
      'sync_completed',
      {
        source_id: 7,
        provider: 'local',
        org_name: 'acme',
        repos_added: 0,
        repos_updated: 0,
        total_repos: 2,
      },
    ]);
  });

  it('sync_completed event includes accurate counts for mixed operations', async () => {
    const existingRows = [
      { id: 100, externalId: 'ext-1', name: 'unchanged', repoUrl: 'https://u.com', description: 'd',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
      { id: 101, externalId: 'ext-2', name: 'old-name', repoUrl: 'https://o.com', description: 'd',
        sizeBytes: null, primaryLanguage: null, lastActivityAt: null },
    ];
    setupLocalSync(makeIntegration({ id: 5, workspaceId: 15 }), null, existingRows);
    mockLocalListRepos.mockResolvedValueOnce([
      makeRepo({ externalId: 'ext-1', name: 'unchanged', url: 'https://u.com', description: 'd' }),
      makeRepo({ externalId: 'ext-2', name: 'new-name', url: 'https://o.com', description: 'd' }),
      makeRepo({ externalId: 'ext-3', name: 'brand-new', url: 'https://n.com', description: 'd' }),
    ]);

    const syncSource = await getSyncFn();
    await syncSource(5);

    const syncCompletedCalls = mockCreateWorkspaceEvent.mock.calls.filter(
      (c: unknown[]) => c[1] === 'sync_completed',
    );
    expect(syncCompletedCalls[0][2]).toEqual(expect.objectContaining({
      repos_added: 0,
      repos_updated: 1,
      total_repos: 3,
    }));
  });

  it('sync_completed event is emitted even when there are no repos', async () => {
    setupLocalSync();
    mockLocalListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    const syncCompletedCalls = mockCreateWorkspaceEvent.mock.calls.filter(
      (c: unknown[]) => c[1] === 'sync_completed',
    );
    expect(syncCompletedCalls).toHaveLength(1);
    expect(syncCompletedCalls[0][2]).toEqual(expect.objectContaining({
      repos_added: 0,
      repos_updated: 0,
      total_repos: 0,
    }));
  });

  // ── ensureTeam ────────────────────────────────────────────────

  it('ensures "Unassigned" team exists in the workspace', async () => {
    setupLocalSync(makeIntegration({ workspaceId: 42 }));
    mockLocalListRepos.mockResolvedValueOnce([]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    expect(mockEnsureTeam).toHaveBeenCalledWith(42, 'Unassigned');
  });

  it('calls ensureTeam even when no repos need updating', async () => {
    mockGetSource.mockResolvedValue(makeIntegration());
    mockGetSecret.mockResolvedValue(null);
    mockEnsureTeam.mockResolvedValue({ id: 77, name: 'Unassigned' });
    mockDb.where.mockResolvedValueOnce([]);
    mockLocalListRepos.mockResolvedValueOnce([makeRepo()]);

    const syncSource = await getSyncFn();
    await syncSource(1);

    expect(mockEnsureTeam).toHaveBeenCalledWith(10, 'Unassigned');
  });
});
