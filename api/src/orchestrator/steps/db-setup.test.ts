import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/index.ts';

const mockDb = db as any;

// ── Mock entity functions ──────────────────────────────────────────
const mockEnsureWorkspace = vi.fn();
const mockEnsureTeam = vi.fn();
const mockEnsureRepository = vi.fn();

vi.mock('../entities.ts', () => ({
  ensureWorkspace: (...args: unknown[]) => mockEnsureWorkspace(...args),
  ensureTeam: (...args: unknown[]) => mockEnsureTeam(...args),
  ensureRepository: (...args: unknown[]) => mockEnsureRepository(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureWorkspace.mockReset();
  mockEnsureTeam.mockReset();
  mockEnsureRepository.mockReset();
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
  // Reset thenable — by default mock is not thenable
  mockDb.then = undefined;
});

/** Make the chainable db mock resolve to `value` when awaited */
function mockDbResolves(value: unknown) {
  mockDb.then = (resolve: (v: unknown) => void) => resolve(value);
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    scanId: 'scan-1',
    repoUrl: 'https://example.com/repo1',
    repoName: 'repo1',
    branch: 'main',
    commitHash: 'abc',
    localPath: '',
    teamName: 'team1',
    workspaceName: 'ws1',
    workspaceId: 0,
    workDir: '/tmp',
    repoPath: '/tmp/repo',
    resultsDir: '/tmp/results',
    profilePath: '/tmp/profile.md',
    cloneUrl: 'https://example.com/repo1.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    ...overrides,
  } as any;
}

// ── Module exports ─────────────────────────────────────────────────

describe('db-setup module exports', () => {
  it('exports setupDatabase as a function', async () => {
    const mod = await import('./db-setup.ts');
    expect(typeof mod.setupDatabase).toBe('function');
  });

  it('exports BeastIds interface (no runtime check, but setupDatabase returns it)', async () => {
    const mod = await import('./db-setup.ts');
    expect(mod.setupDatabase).toBeDefined();
  });
});

// ── setupDatabase — new path (workspaceId > 0) ────────────────────

describe('setupDatabase (new path: workspaceId > 0)', () => {
  it('looks up repo by name and returns IDs directly', async () => {
    mockDbResolves([{ id: 20, teamId: 10 }]);

    const { setupDatabase } = await import('./db-setup.ts');
    const result = await setupDatabase(makeCtx({ workspaceId: 42 }));

    expect(result).toEqual({ workspaceId: 42, teamId: 10, repositoryId: 20 });
    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.from).toHaveBeenCalled();
    expect(mockDb.where).toHaveBeenCalled();
    // Should NOT call legacy entity functions
    expect(mockEnsureWorkspace).not.toHaveBeenCalled();
    expect(mockEnsureTeam).not.toHaveBeenCalled();
    expect(mockEnsureRepository).not.toHaveBeenCalled();
  });

  it('falls back to legacy path when repo is not found in DB', async () => {
    // First where() call: select query — resolve to [] (no repo found)
    // Second where() call: update query — return mockDb (chainable, non-thenable)
    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) {
        // select().from().where() — must resolve to empty array
        return Promise.resolve([]);
      }
      // update().set().where() — just return mockDb (not awaited)
      return mockDb;
    });

    mockEnsureWorkspace.mockResolvedValue({ id: 5, name: 'ws1' });
    mockEnsureTeam.mockResolvedValue({ id: 13, name: 'default' });
    mockEnsureRepository.mockResolvedValue({ id: 23, name: 'repo1' });

    const { setupDatabase } = await import('./db-setup.ts');
    const result = await setupDatabase(makeCtx({ workspaceId: 7 }));

    expect(result).toEqual({ workspaceId: 5, teamId: 13, repositoryId: 23 });
    expect(mockEnsureWorkspace).toHaveBeenCalledWith('ws1');
    expect(mockEnsureTeam).toHaveBeenCalledWith(5, 'default');
    expect(mockEnsureRepository).toHaveBeenCalledWith(13, 'repo1', 'https://example.com/repo1');
  });
});

// ── setupDatabase — legacy path (workspaceId = 0) ─────────────────

describe('setupDatabase (legacy path: workspaceId = 0)', () => {
  it('calls ensureWorkspace, ensureTeam, ensureRepository and returns IDs', async () => {
    mockEnsureWorkspace.mockResolvedValue({ id: 42, name: 'ws1' });
    mockEnsureTeam.mockResolvedValue({ id: 10, name: 'default' });
    mockEnsureRepository.mockResolvedValue({ id: 20, name: 'repo1' });

    const { setupDatabase } = await import('./db-setup.ts');
    const result = await setupDatabase(makeCtx({ workspaceId: 0 }));

    expect(result).toEqual({ workspaceId: 42, teamId: 10, repositoryId: 20 });
    expect(mockEnsureWorkspace).toHaveBeenCalledWith('ws1');
    expect(mockEnsureTeam).toHaveBeenCalledWith(42, 'default');
    expect(mockEnsureRepository).toHaveBeenCalledWith(10, 'repo1', 'https://example.com/repo1');
  });

  it('links scan to repository and workspace via Drizzle update', async () => {
    mockEnsureWorkspace.mockResolvedValue({ id: 5, name: 'ws' });
    mockEnsureTeam.mockResolvedValue({ id: 13, name: 'team' });
    mockEnsureRepository.mockResolvedValue({ id: 23, name: 'repo4' });

    const { setupDatabase } = await import('./db-setup.ts');
    await setupDatabase(makeCtx({ scanId: 'scan-4', workspaceId: 0, teamName: 'team', workspaceName: 'ws' }));

    // Should call db.update for linking scan
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 23, workspaceId: 5 }),
    );
  });

  it('passes undefined repoUrl when ctx.repoUrl is empty', async () => {
    mockEnsureWorkspace.mockResolvedValue({ id: 1, name: 'ws' });
    mockEnsureTeam.mockResolvedValue({ id: 14, name: 'default' });
    mockEnsureRepository.mockResolvedValue({ id: 24, name: 'repo5' });

    const { setupDatabase } = await import('./db-setup.ts');
    await setupDatabase(makeCtx({ repoUrl: '', repoName: 'repo5', teamName: '', workspaceId: 0 }));

    // Empty string is falsy, so repoUrl || undefined → undefined
    expect(mockEnsureRepository).toHaveBeenCalledWith(14, 'repo5', undefined);
  });

  it('always uses "default" as team name', async () => {
    mockEnsureWorkspace.mockResolvedValue({ id: 1, name: 'ws' });
    mockEnsureTeam.mockResolvedValue({ id: 12, name: 'default' });
    mockEnsureRepository.mockResolvedValue({ id: 22, name: 'repo3' });

    const { setupDatabase } = await import('./db-setup.ts');
    await setupDatabase(makeCtx({ teamName: 'anything', workspaceName: 'ws', workspaceId: 0 }));

    expect(mockEnsureTeam).toHaveBeenCalledWith(1, 'default');
  });
});
