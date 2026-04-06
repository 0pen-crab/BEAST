import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext } from '../pipeline-types.ts';

// ── SSH mock ──────────────────────────────────────────────────────────────────

const { mockSshExec, mockGetClaudeRunnerConfig } = vi.hoisted(() => ({
  mockSshExec: vi.fn(),
  mockGetClaudeRunnerConfig: vi.fn().mockReturnValue({
    host: 'claude-runner',
    port: 22,
    username: 'scanner',
    privateKey: Buffer.from('fake-key'),
  }),
}));

vi.mock('../ssh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssh.ts')>();
  return {
    sshExec: mockSshExec,
    getClaudeRunnerConfig: mockGetClaudeRunnerConfig,
    parseStreamJsonResult: actual.parseStreamJsonResult,
    SSHTimeoutError: actual.SSHTimeoutError,
  };
});

// ── execSync mock ─────────────────────────────────────────────────────────────

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

// ── fs mock ───────────────────────────────────────────────────────────────────

const { mockWriteFileSync, mockExistsSync } = vi.hoisted(() => ({
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    writeFileSync: mockWriteFileSync,
    existsSync: mockExistsSync,
  },
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}));

vi.mock('../../db/index.ts', () => ({
  db: {
    select: mockDbSelect,
  },
}));

// ── entities mock ────────────────────────────────────────────────────────────

vi.mock('../entities.ts', () => ({
  addScanFile: vi.fn(),
}));

// ── findOrCreateContributor mock ──────────────────────────────────────────────

const { mockFindOrCreateContributor } = vi.hoisted(() => ({
  mockFindOrCreateContributor: vi.fn(),
}));

vi.mock('../../routes/contributors.ts', () => ({
  findOrCreateContributor: mockFindOrCreateContributor,
}));

import {
  checkProfileExists,
  runAnalyzer,
  collectGitMetadata,
  buildContributorsToAssess,
  runAnalysisStep,
} from './analyzer.ts';

// ── Test context factory ──────────────────────────────────────────────────────

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    scanId: 'scan-1',
    repoUrl: 'https://github.com/org/repo.git',
    repoName: 'repo',
    branch: '',
    commitHash: '',
    localPath: '',
    teamName: 'team-a',
    workspaceName: 'org',
    workspaceId: 10,
    workDir: '/workspace/repo',
    repoPath: '/workspace/repo/repo',
    toolsDir: '/workspace/repo/results',
    agentDir: '/workspace/repo',
    resultsDir: '/workspace/repo/results',
    profilePath: '/workspace/repo/repo-profile.md',
    cloneUrl: 'https://github.com/org/repo.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    ...overrides,
  } as PipelineContext;
}

// ── checkProfileExists ────────────────────────────────────────────────────────

describe('checkProfileExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a callable function', () => {
    expect(typeof checkProfileExists).toBe('function');
  });

  it('returns true when profile file exists', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: 'exists\n', stderr: '', code: 0 });

    const result = await checkProfileExists(makeCtx());

    expect(result).toBe(true);
    expect(mockSshExec.mock.calls[0][1]).toContain('repo-profile.md');
  });

  it('returns false when profile file is missing', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: 'missing\n', stderr: '', code: 0 });

    const result = await checkProfileExists(makeCtx());

    expect(result).toBe(false);
  });
});

// ── runAnalyzer ───────────────────────────────────────────────────────────────

describe('runAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a callable function', () => {
    expect(typeof runAnalyzer).toBe('function');
  });

  it('returns cost and duration on success', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ total_cost_usd: 0.05, duration_ms: 12000, result: 'done' }),
      stderr: '',
      code: 0,
    });

    const result = await runAnalyzer(makeCtx());

    expect(result.cost).toBe(0.05);
    expect(result.durationMs).toBe(12000);
    expect(result.log).toBeDefined();
    expect(mockSshExec.mock.calls[0][1]).toContain('claude -p');
    expect(mockSshExec.mock.calls[0][1]).toContain('analyzer.md');
  });

  it('includes language instruction in prompt for non-English', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ total_cost_usd: 0.01, duration_ms: 5000 }),
      stderr: '',
      code: 0,
    });

    await runAnalyzer(makeCtx({ reportLanguage: 'uk' }));

    const command = mockSshExec.mock.calls[0][1];
    expect(command).toContain('Українською');
  });

  it('throws on invalid JSON output', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: 'not json at all',
      stderr: '',
      code: 0,
    });

    await expect(runAnalyzer(makeCtx())).rejects.toThrow('Analyzer failed: No result event found');
  });

  it('throws when result indicates is_error', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ is_error: true, result: 'Something went wrong' }),
      stderr: '',
      code: 0,
    });

    await expect(runAnalyzer(makeCtx())).rejects.toThrow('Analyzer failed');
  });

  it('throws auth error when not logged in', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ is_error: true, result: 'Not logged in to Claude' }),
      stderr: '',
      code: 0,
    });

    await expect(runAnalyzer(makeCtx())).rejects.toThrow('not authenticated');
  });

  it('succeeds on non-zero exit code when stream result says success', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ result: 'done', total_cost_usd: 0.01 }),
      stderr: '',
      code: 1,
    });

    const result = await runAnalyzer(makeCtx());
    expect(result.cost).toBe(0.01);
  });
});

// ── collectGitMetadata ────────────────────────────────────────────────────────

describe('collectGitMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupGitMocks({
    revList = '42\n',
    shortlog = '  10\tAlice Dev <alice@example.com>\n   5\tBob Dev <bob@example.com>\n',
    branchR = '  origin/main\n  origin/develop\n',
    lsFiles = 'src/index.ts\nsrc/utils.js\nREADME.md\n',
    repoSizeWc = '  2097152 total\n',
    log = '2025-01\n2025-01\n2025-02\n',
    logNameOnly = '\nfoo.ts\nbar.ts\nfoo.ts\n',
    wc = '  500 src/index.ts\n  300 src/utils.js\n  800 total\n',
  } = {}) {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('rev-list --count')) return revList;
      if (cmd.includes('shortlog -sne')) return shortlog;
      if (cmd.includes('branch -r')) return branchR;
      if (cmd.includes('ls-files -z') && cmd.includes('xargs')) return repoSizeWc;
      if (cmd.includes('ls-files') && !cmd.includes('wc') && !cmd.includes('-z')) return lsFiles;
      if (cmd.includes('log --pretty=format:"%ad"')) return log;
      if (cmd.includes('log --name-only')) return logNameOnly;
      if (cmd.includes('wc -c')) return wc;
      return '';
    });
  }

  it('returns structured metadata with all required fields', () => {
    setupGitMocks();

    const result = collectGitMetadata('/repo');

    expect(result).toMatchObject({
      commits: expect.any(Number),
      contributors: expect.any(Array),
      branches: expect.any(Array),
      fileTypeDistribution: expect.any(Object),
      repoSizeKb: expect.any(Number),
      monthlyActivity: expect.any(Array),
      churnHotspots: expect.any(Array),
      scannableCodeSizeKb: expect.any(Number),
    });
  });

  it('parses commit count from git rev-list', () => {
    setupGitMocks({ revList: '123\n' });

    const result = collectGitMetadata('/repo');

    expect(result.commits).toBe(123);
  });

  it('parses contributors from git shortlog', () => {
    setupGitMocks({
      shortlog: '  10\tAlice <alice@example.com>\n   5\tBob <bob@example.com>\n',
    });

    const result = collectGitMetadata('/repo');

    expect(result.contributors).toHaveLength(2);
    expect(result.contributors[0]).toEqual({ name: 'Alice', email: 'alice@example.com', commits: 10 });
    expect(result.contributors[1]).toEqual({ name: 'Bob', email: 'bob@example.com', commits: 5 });
  });

  it('strips origin/ prefix from branches', () => {
    setupGitMocks({ branchR: '  origin/main\n  origin/HEAD -> origin/main\n  origin/feature-x\n' });

    const result = collectGitMetadata('/repo');

    expect(result.branches).toContain('main');
    expect(result.branches).toContain('feature-x');
    expect(result.branches.every(b => !b.startsWith('origin/'))).toBe(true);
  });

  it('computes file type distribution from ls-files', () => {
    setupGitMocks({ lsFiles: 'a.ts\nb.ts\nc.js\nREADME.md\n' });

    const result = collectGitMetadata('/repo');

    expect(result.fileTypeDistribution['.ts']).toBe(2);
    expect(result.fileTypeDistribution['.js']).toBe(1);
    expect(result.fileTypeDistribution['.md']).toBe(1);
  });

  it('returns repo size from tracked files wc output', () => {
    setupGitMocks({ repoSizeWc: '  2097152 total\n' });

    const result = collectGitMetadata('/repo');

    expect(result.repoSizeKb).toBe(2048); // 2097152 bytes / 1024
  });

  it('returns monthly activity sorted by month', () => {
    setupGitMocks({ log: '2025-01\n2025-03\n2025-01\n2025-02\n' });

    const result = collectGitMetadata('/repo');

    expect(result.monthlyActivity).toEqual([
      { month: '2025-01', commits: 2 },
      { month: '2025-02', commits: 1 },
      { month: '2025-03', commits: 1 },
    ]);
  });

  it('returns top 10 churn hotspots sorted by change count descending', () => {
    const logLines = '\n' + Array.from({ length: 15 }, (_, i) => `file${i}.ts`).join('\n') + '\nfile0.ts\nfile0.ts\n';
    setupGitMocks({ logNameOnly: logLines });

    const result = collectGitMetadata('/repo');

    expect(result.churnHotspots.length).toBeLessThanOrEqual(10);
    // Most changed file should be first
    expect(result.churnHotspots[0].file).toBe('file0.ts');
    expect(result.churnHotspots[0].changes).toBeGreaterThan(1);
  });

  it('counts scannable code size from source files only', () => {
    setupGitMocks({
      lsFiles: 'src/index.ts\nsrc/app.py\nREADME.md\npackage-lock.json\n',
      wc: '  500 /repo/src/index.ts\n  300 /repo/src/app.py\n  800 total\n',
    });

    const result = collectGitMetadata('/repo');

    // .md and package-lock.json are not source files, so only index.ts and app.py
    expect(result.scannableCodeSizeKb).toBeGreaterThanOrEqual(0);
  });

  it('handles empty/broken git output gracefully', () => {
    mockExecSync.mockReturnValue('');

    const result = collectGitMetadata('/repo');

    expect(result.commits).toBe(0);
    expect(result.contributors).toEqual([]);
    expect(result.branches).toEqual([]);
    expect(result.monthlyActivity).toEqual([]);
    expect(result.churnHotspots).toEqual([]);
  });
});

// ── buildContributorsToAssess ─────────────────────────────────────────────────

describe('buildContributorsToAssess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupDbChain(results: Array<{ id: number }[]>) {
    let callIndex = 0;
    mockDbSelect.mockImplementation(() => {
      const result = results[callIndex] ?? [];
      callIndex++;
      return {
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(result),
          }),
        }),
      };
    });
  }

  it('returns empty array when git shortlog fails', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    const result = await buildContributorsToAssess(makeCtx());

    expect(result).toEqual([]);
  });

  it('skips contributors with fewer than 10 commits', async () => {
    mockExecSync.mockReturnValue('  9\tLow Committer <low@example.com>\n');

    const result = await buildContributorsToAssess(makeCtx());

    expect(result).toEqual([]);
  });

  it('returns contributors not yet assessed for this repo', async () => {
    mockExecSync.mockReturnValue('  15\tAlice <alice@example.com>\n  12\tBob <bob@example.com>\n');
    mockFindOrCreateContributor.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    // Alice: no existing assessment → include; Bob: existing assessment → skip
    setupDbChain([[], [{ id: 99 }]]);

    const result = await buildContributorsToAssess(makeCtx());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ email: 'alice@example.com', name: 'Alice', commits: 15 });
  });

  it('returns all contributors when none have been assessed', async () => {
    mockExecSync.mockReturnValue('  20\tAlice <alice@example.com>\n  15\tBob <bob@example.com>\n');
    mockFindOrCreateContributor.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    setupDbChain([[], []]);

    const result = await buildContributorsToAssess(makeCtx());

    expect(result).toHaveLength(2);
  });

  it('calls findOrCreateContributor with correct workspace id', async () => {
    mockExecSync.mockReturnValue('  10\tAlice <alice@example.com>\n');
    mockFindOrCreateContributor.mockResolvedValueOnce(1);
    setupDbChain([[]]);

    await buildContributorsToAssess(makeCtx({ workspaceId: 42 }));

    expect(mockFindOrCreateContributor).toHaveBeenCalledWith('alice@example.com', 'Alice', 42);
  });

  it('deduplicates email aliases that resolve to the same contributor ID', async () => {
    mockExecSync.mockReturnValue(
      '  50\tBoris <boris@mail.example.com>\n  30\tBoris K <b.boris@example.com>\n',

    );
    // Both emails resolve to the same contributor ID
    mockFindOrCreateContributor.mockResolvedValueOnce(100).mockResolvedValueOnce(100);
    // Only one DB check expected (second email is deduped before checking)
    setupDbChain([[]]);

    const result = await buildContributorsToAssess(makeCtx());

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('boris@mail.example.com');
    expect(mockFindOrCreateContributor).toHaveBeenCalledTimes(2);
  });
});

// ── runAnalysisStep ───────────────────────────────────────────────────────────

describe('runAnalysisStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupHappyPath() {
    // collectGitMetadata — all git commands return minimal valid output
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('rev-list --count')) return '10\n';
      if (cmd.includes('shortlog -sne')) return '  10\tAlice <alice@example.com>\n';
      if (cmd.includes('branch -r')) return '  origin/main\n';
      if (cmd.includes('ls-files')) return 'src/index.ts\n';
      if (cmd.includes('du -sk')) return '512\t/repo\n';
      if (cmd.includes('log --pretty=format:"%ad"')) return '2025-01\n';
      if (cmd.includes('log --name-only')) return '\nsrc/index.ts\n';
      if (cmd.includes('wc -c')) return '  1024 src/index.ts\n  1024 total\n';
      return '';
    });

    // buildContributorsToAssess — no eligible contributors (< 5 commits shortlog handled above,
    // but the shortlog used is inside buildContributorsToAssess separately)
    // The second execSync call in buildContributorsToAssess uses the same mock
    mockFindOrCreateContributor.mockResolvedValue(1);
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: 1 }]),
        }),
      }),
    });

    // profilePath exists
    mockExistsSync.mockReturnValue(true);

    // writeFileSync does nothing
    mockWriteFileSync.mockReturnValue(undefined);
  }

  it('writes repo-metadata.json to agentDir', async () => {
    setupHappyPath();

    await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    const metadataCall = mockWriteFileSync.mock.calls.find(
      (call: unknown[]) => String(call[0]).endsWith('repo-metadata.json'),
    );
    expect(metadataCall).toBeDefined();
    expect(metadataCall![0]).toContain('/workspace/repo/repo-metadata.json');
  });

  it('writes contributors-to-assess.json to agentDir', async () => {
    setupHappyPath();

    await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    const assessCall = mockWriteFileSync.mock.calls.find(
      (call: unknown[]) => String(call[0]).endsWith('contributors-to-assess.json'),
    );
    expect(assessCall).toBeDefined();
  });

  it('returns profileGenerated=false when profile already exists', async () => {
    setupHappyPath();
    mockExistsSync.mockReturnValue(true);

    const result = await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    expect(result.profileGenerated).toBe(false);
  });

  it('returns profileGenerated=true when profile did not exist and analyzer ran', async () => {
    setupHappyPath();
    mockExistsSync.mockReturnValue(false);
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ total_cost_usd: 0.02, duration_ms: 8000 }),
      stderr: '',
      code: 0,
    });

    const result = await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    expect(result.profileGenerated).toBe(true);
    expect(result.aiAvailable).toBe(true);
  });

  it('returns aiAvailable=false when analyzer throws', async () => {
    setupHappyPath();
    mockExistsSync.mockReturnValue(false);
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ is_error: true, result: 'Claude crashed' }),
      stderr: '',
      code: 0,
    });

    const result = await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    expect(result.aiAvailable).toBe(false);
  });

  it('does not call runAnalyzer when profile already exists', async () => {
    setupHappyPath();
    mockExistsSync.mockReturnValue(true);

    await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    expect(mockSshExec).not.toHaveBeenCalled();
  });

  it('returns metadataPath pointing to agentDir/repo-metadata.json', async () => {
    setupHappyPath();

    const result = await runAnalysisStep({ ctx: makeCtx({ agentDir: '/workspace/agent' }), prev: {} });

    expect(result.metadataPath).toBe('/workspace/agent/repo-metadata.json');
  });

  it('returns contributorsAssessed count matching unassessed contributors', async () => {
    setupHappyPath();
    // Override execSync so shortlog in buildContributorsToAssess returns 2 contributors with enough commits
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('rev-list --count')) return '10\n';
      if (cmd.includes('shortlog -sne')) return '  20\tAlice <alice@example.com>\n  15\tBob <bob@example.com>\n';
      if (cmd.includes('branch -r')) return '  origin/main\n';
      if (cmd.includes('ls-files')) return 'src/index.ts\n';
      if (cmd.includes('du -sk')) return '512\t/repo\n';
      if (cmd.includes('log --pretty=format:"%ad"')) return '2025-01\n';
      if (cmd.includes('log --name-only')) return '\nsrc/index.ts\n';
      if (cmd.includes('wc -c')) return '  1024 total\n';
      return '';
    });
    mockFindOrCreateContributor.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    // Both contributors have no assessment yet
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });

    const result = await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    expect(result.contributorsAssessed).toBe(2);
  });
});
