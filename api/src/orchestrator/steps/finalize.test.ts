import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext } from '../pipeline-types.ts';
import { db } from '../../db/index.ts';

// ── Mock entities ──────────────────────────────────────────────────
const mockAddScanFile = vi.fn();

vi.mock('../entities.ts', () => ({
  addScanFile: (...args: unknown[]) => mockAddScanFile(...args),
  createWorkspaceEvent: vi.fn(),
}));

// ── Mock ingestContributors ──────────────────────────────────────
const mockIngestContributors = vi.fn();

vi.mock('../../routes/contributors.ts', () => ({
  ingestContributors: (...args: unknown[]) => mockIngestContributors(...args),
}));

// ── Mock feedback worker ──────────────────────────────────────────
vi.mock('../feedback-worker.ts', () => ({
  queueFeedbackCompilation: vi.fn(),
}));

const mockDb = db as any;

beforeEach(() => {
  mockAddScanFile.mockReset();
  mockIngestContributors.mockReset();
  mockIngestContributors.mockResolvedValue({ contributorIds: {}, newAssessments: 0 });
  // Reset chainable db mock
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
});

// ── Module exports ─────────────────────────────────────────────────

describe('finalize module exports', () => {
  it('exports storeReports as a function', async () => {
    const mod = await import('./finalize.ts');
    expect(typeof mod.storeReports).toBe('function');
  });

  it('exports ingestContributorStats as a function', async () => {
    const mod = await import('./finalize.ts');
    expect(typeof mod.ingestContributorStats).toBe('function');
  });
});

// ── storeReports ───────────────────────────────────────────────────

describe('storeReports', () => {
  it('stores both profile and report when both have content', async () => {
    mockAddScanFile.mockResolvedValue({ id: 1 });

    const { storeReports } = await import('./finalize.ts');
    await storeReports('scan-1', '# Report', '# Profile');

    expect(mockAddScanFile).toHaveBeenCalledTimes(2);

    // Profile call
    expect(mockAddScanFile).toHaveBeenCalledWith({
      scanId: 'scan-1',
      fileName: 'repo-profile.md',
      fileType: 'profile',
      content: '# Profile',
    });

    // Report call
    expect(mockAddScanFile).toHaveBeenCalledWith({
      scanId: 'scan-1',
      fileName: 'final-report.md',
      fileType: 'audit',
      content: '# Report',
    });
  });

  it('skips profile when profileContent is empty', async () => {
    mockAddScanFile.mockResolvedValue({ id: 1 });

    const { storeReports } = await import('./finalize.ts');
    await storeReports('scan-1', '# Report', '');

    expect(mockAddScanFile).toHaveBeenCalledTimes(1);
    expect(mockAddScanFile).toHaveBeenCalledWith(expect.objectContaining({ fileType: 'audit' }));
  });

  it('skips report when reportContent is empty', async () => {
    mockAddScanFile.mockResolvedValue({ id: 1 });

    const { storeReports } = await import('./finalize.ts');
    await storeReports('scan-1', '', '# Profile');

    expect(mockAddScanFile).toHaveBeenCalledTimes(1);
    expect(mockAddScanFile).toHaveBeenCalledWith(expect.objectContaining({ fileType: 'profile' }));
  });

  it('stores nothing when both are empty', async () => {
    const { storeReports } = await import('./finalize.ts');
    await storeReports('scan-1', '', '');

    expect(mockAddScanFile).not.toHaveBeenCalled();
  });
});

// ── ingestContributorStats ──────────────────────────────────────────

describe('ingestContributorStats', () => {
  const makeCtx = (overrides = {}) => ({
    scanId: 'scan-1',
    repoUrl: 'https://example.com/repo',
    repoName: 'test-repo',
    branch: 'main',
    commitHash: 'abc',
    localPath: '',
    teamName: 'team1',
    workspaceName: 'ws1',
    workspaceId: 10,
    workDir: '/tmp',
    repoPath: '/tmp/repo',
    toolsDir: '/tmp/results',
    agentDir: '/tmp',
    resultsDir: '/tmp/results',
    profilePath: '/tmp/profile.md',
    cloneUrl: 'https://example.com/repo.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    ...overrides,
  } as PipelineContext);

  it('returns early when no git-stats result file exists', async () => {
    const { ingestContributorStats } = await import('./finalize.ts');
    await ingestContributorStats(makeCtx(), 'scan-1', 10, [], [], 1);

    expect(mockIngestContributors).not.toHaveBeenCalled();
  });

  it('returns early when stats content is not a valid JSON array', async () => {
    const resultFiles = [
      { key: 'git-stats', content_b64: Buffer.from('not-json').toString('base64') },
    ];

    const { ingestContributorStats } = await import('./finalize.ts');
    await ingestContributorStats(makeCtx(), 'scan-1', 10, resultFiles, [], 1);

    expect(mockIngestContributors).not.toHaveBeenCalled();
  });

  it('returns early when stats content is an empty array', async () => {
    const resultFiles = [
      { key: 'git-stats', content_b64: Buffer.from('[]').toString('base64') },
    ];

    const { ingestContributorStats } = await import('./finalize.ts');
    await ingestContributorStats(makeCtx(), 'scan-1', 10, resultFiles, [], 1);

    expect(mockIngestContributors).not.toHaveBeenCalled();
  });

  it('calls ingestContributors directly when valid stats exist', async () => {
    const stats = [{ email: 'alice@test.com', name: 'Alice', commits: 42, loc_added: 100, loc_removed: 20 }];
    const resultFiles = [
      { key: 'git-stats', content_b64: Buffer.from(JSON.stringify(stats)).toString('base64') },
    ];
    const assessments = [{ email: 'alice@test.com', security: 8, quality: 7, patterns: 6, testing: 5, innovation: 9 }];

    const { ingestContributorStats } = await import('./finalize.ts');
    await ingestContributorStats(makeCtx(), 'scan-1', 10, resultFiles, assessments, 5);

    expect(mockIngestContributors).toHaveBeenCalledTimes(1);
    expect(mockIngestContributors).toHaveBeenCalledWith({
      repoName: 'test-repo',
      repoUrl: 'https://example.com/repo',
      workspaceId: 5,
      executionId: 'scan-1',
      contributors: stats,
      assessments,
    });
  });

  it('handles ingestContributors failure gracefully (logs scan event)', async () => {
    const stats = [{ email: 'bob@test.com', name: 'Bob', commits: 5, loc_added: 10, loc_removed: 2 }];
    const resultFiles = [
      { key: 'git-stats', content_b64: Buffer.from(JSON.stringify(stats)).toString('base64') },
    ];

    mockIngestContributors.mockRejectedValueOnce(new Error('DB connection failed'));

    const { ingestContributorStats } = await import('./finalize.ts');
    // Should not throw
    await ingestContributorStats(makeCtx(), 'scan-1', 10, resultFiles, [], 1);

    expect(mockIngestContributors).toHaveBeenCalledTimes(1);
    // Error is logged via db.insert(scanEvents)
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
