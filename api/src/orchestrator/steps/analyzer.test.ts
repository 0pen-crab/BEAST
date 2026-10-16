import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import type { PipelineContext } from '../pipeline-types.ts';

// ── SSH mock ──────────────────────────────────────────────────────────────────

const { mockSshExec, mockSshReadFile, mockGetClaudeRunnerConfig } = vi.hoisted(() => ({
  mockSshExec: vi.fn(),
  mockSshReadFile: vi.fn().mockResolvedValue('# Repository Profile\n\nMocked profile content.'),
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
    sshReadFile: mockSshReadFile,
    sshWriteFile: vi.fn(async () => undefined),
    getClaudeRunnerConfig: mockGetClaudeRunnerConfig,
    parseStreamJsonResult: actual.parseStreamJsonResult,
    extractAiUsage: actual.extractAiUsage,
    SSHTimeoutError: actual.SSHTimeoutError,
  };
});

// ── execFileSync mock ─────────────────────────────────────────────────────────

const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
}));

/** Answer git calls by their arguments after `-C <repo>`, e.g. "shortlog -sne --all". */
function mockGit(answer: (args: string) => string) {
  mockExecFileSync.mockImplementation((_file: string, args: string[]) => answer(args.slice(2).join(' ')));
}

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

const { mockAddScanFile } = vi.hoisted(() => ({
  mockAddScanFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../entities.ts', () => ({
  addScanFile: mockAddScanFile,
}));

// ── findOrCreateContributor mock ──────────────────────────────────────────────

const { mockFindOrCreateContributor } = vi.hoisted(() => ({
  mockFindOrCreateContributor: vi.fn(),
}));

vi.mock('../../routes/contributors.ts', () => ({
  findOrCreateContributor: mockFindOrCreateContributor,
}));

// ── pipeline mock (logScanEvent) ──────────────────────────────────────────────

const { mockLogScanEvent } = vi.hoisted(() => ({
  mockLogScanEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../events.ts', () => ({
  logScanEvent: mockLogScanEvent,
}));

import {
  checkProfileExists,
  checkRemoteFileExists,
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
    scanContextPath: '/workspace/repo/scan-context.md',
    cloneUrl: 'https://github.com/org/repo.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    aiModelAnalyzer: 'sonnet',
    aiModelScanner: 'opus',
    aiModelTriage: 'opus',
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

  it('threads ctx.cancelSignal into the sshExec options', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: 'exists\n', stderr: '', code: 0 });
    const controller = new AbortController();

    await checkProfileExists(makeCtx({ cancelSignal: controller.signal }));

    const options = mockSshExec.mock.calls[0][2] as Record<string, unknown> | undefined;
    expect(options?.signal).toBe(controller.signal);
  });
});

// ── checkRemoteFileExists ─────────────────────────────────────────────────────

describe('checkRemoteFileExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('threads the cancel signal into the sshExec options', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: 'exists\n', stderr: '', code: 0 });
    const controller = new AbortController();

    const result = await checkRemoteFileExists('/workspace/repo/scan-context.md', controller.signal);

    expect(result).toBe(true);
    const options = mockSshExec.mock.calls[0][2] as Record<string, unknown> | undefined;
    expect(options?.signal).toBe(controller.signal);
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

  it('returns cost, duration, and aiUsage on success', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({
        type: 'result', total_cost_usd: 0.05, duration_ms: 12000, result: 'done',
        modelUsage: { 'claude-sonnet-4-6': { inputTokens: 10, outputTokens: 500, cacheReadInputTokens: 1000, cacheCreationInputTokens: 200, costUSD: 0.05 } },
      }),
      stderr: '',
      code: 0,
    });

    const result = await runAnalyzer(makeCtx());

    expect(result.cost).toBe(0.05);
    expect(result.durationMs).toBe(12000);
    expect(result.log).toBeDefined();
    expect(result.aiUsage).toEqual({
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 500,
      cacheReadInputTokens: 1000,
      cacheCreationInputTokens: 200,
      costUSD: 0.05,
    });
    expect(mockSshExec.mock.calls[0][1]).toContain('claude -p');
    expect(mockSshExec.mock.calls[0][1]).toContain('analyzer.md');
  });

  it('includes language instruction in prompt for non-English', async () => {
    const writeMock = (await import('../ssh.ts')).sshWriteFile as ReturnType<typeof vi.fn>;
    writeMock.mockReset();
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ total_cost_usd: 0.01, duration_ms: 5000 }),
      stderr: '',
      code: 0,
    });

    await runAnalyzer(makeCtx({ reportLanguage: 'uk' }));

    // Prompt is written to a tmp file by the ai-trace helper, not embedded
    // in the shell command.
    const promptCall = writeMock.mock.calls.find(c =>
      typeof c[1] === 'string' && (c[1] as string).startsWith('/tmp/claude-prompt-'),
    );
    expect(promptCall).toBeDefined();
    expect(promptCall![2]).toContain('Українською');
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

  it('includes --model flag resolved from ctx.aiModelAnalyzer', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ total_cost_usd: 0.01, duration_ms: 5000 }),
      stderr: '',
      code: 0,
    });

    await runAnalyzer(makeCtx({ aiModelAnalyzer: 'sonnet' }));

    const command = mockSshExec.mock.calls[0][1];
    expect(command).toContain('--model claude-sonnet-5[1m]');
  });

  it('uses opus model when aiModelAnalyzer is set to opus', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ total_cost_usd: 0.01, duration_ms: 5000 }),
      stderr: '',
      code: 0,
    });

    await runAnalyzer(makeCtx({ aiModelAnalyzer: 'opus' }));

    const command = mockSshExec.mock.calls[0][1];
    expect(command).toContain('--model claude-opus-4-6');
  });
});

// ── collectGitMetadata ────────────────────────────────────────────────────────

// Runs real git against a throwaway repository: the point is what git and
// the parser make of real output, including hostile file names.
describe('collectGitMetadata', () => {
  let realFs: typeof import('fs');
  let realChildProcess: typeof import('child_process');
  let base: string;
  let repo: string;

  function git(...args: string[]) {
    realChildProcess.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  }

  function commitFile(file: string, bytes: number, author: string, fill = 'x') {
    realFs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    realFs.writeFileSync(path.join(repo, file), fill.repeat(bytes));
    git('add', '--', file);
    git('-c', `user.name=${author}`, '-c', `user.email=${author.toLowerCase()}@example.com`, 'commit', '-q', '-m', file);
  }

  beforeAll(async () => {
    realFs = await vi.importActual<typeof import('fs')>('fs');
    realChildProcess = await vi.importActual<typeof import('child_process')>('child_process');
    base = realFs.mkdtempSync(path.join(os.tmpdir(), 'beast-analyzer-'));
    repo = path.join(base, 'repo');
    realFs.mkdirSync(repo);
    git('init', '-q');
    commitFile('src/index.ts', 2048, 'Alice');
    commitFile('src/app.py', 1024, 'Alice');
    commitFile('README.md', 4096, 'Bob');
    commitFile('node_modules/lib/index.js', 8192, 'Bob');
    commitFile('src/index.ts', 2048, 'Alice', 'y');
    // A file name that runs a command if it ever reaches a shell.
    commitFile('src/a$(touch PWNED).ts', 1024, 'Alice');
  });

  afterAll(() => {
    realFs.rmSync(base, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSync.mockImplementation(realChildProcess.execFileSync);
  });

  it('never passes repository file names through a shell', () => {
    collectGitMetadata(repo);

    expect(realFs.existsSync(path.join(repo, 'PWNED'))).toBe(false);
    expect(realFs.existsSync(path.join(repo, 'src', 'PWNED'))).toBe(false);
    expect(realFs.existsSync('PWNED')).toBe(false);
  });

  it('counts commits and contributors', () => {
    const result = collectGitMetadata(repo);

    expect(result.commits).toBe(6);
    expect(result.contributors).toEqual([
      { name: 'Alice', email: 'alice@example.com', commits: 4 },
      { name: 'Bob', email: 'bob@example.com', commits: 2 },
    ]);
  });

  it('computes file type distribution, including unusual file names', () => {
    const result = collectGitMetadata(repo);

    expect(result.fileTypeDistribution).toEqual({ '.ts': 2, '.py': 1, '.md': 1, '.js': 1 });
  });

  it('sums the size of all tracked files', () => {
    const result = collectGitMetadata(repo);

    expect(result.repoSizeKb).toBe(16); // 2048 + 1024 + 4096 + 8192 + 1024 bytes
  });

  it('counts scannable code size from source files outside excluded dirs', () => {
    const result = collectGitMetadata(repo);

    // index.ts + app.py + a$(...).ts; README.md is not source, node_modules is excluded
    expect(result.scannableCodeSizeKb).toBe(4);
  });

  it('returns monthly activity covering every recent commit', () => {
    const result = collectGitMetadata(repo);

    expect(result.monthlyActivity.reduce((sum, m) => sum + m.commits, 0)).toBe(6);
  });

  it('returns churn hotspots with the most changed file first', () => {
    const result = collectGitMetadata(repo);

    expect(result.churnHotspots[0]).toEqual({ file: 'src/index.ts', changes: 2 });
  });

  it('strips origin/ prefix from remote branches and drops HEAD', () => {
    mockGit(args => (args === 'branch -r' ? '  origin/main\n  origin/HEAD -> origin/main\n  origin/feature-x\n' : ''));

    const result = collectGitMetadata('/repo');

    expect(result.branches).toEqual(['main', 'feature-x']);
  });

  it('handles empty/broken git output gracefully', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    const result = collectGitMetadata('/repo');

    expect(result).toEqual({
      commits: 0,
      contributors: [],
      branches: [],
      fileTypeDistribution: {},
      repoSizeKb: 0,
      monthlyActivity: [],
      churnHotspots: [],
      scannableCodeSizeKb: 0,
    });
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
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    const result = await buildContributorsToAssess(makeCtx());

    expect(result).toEqual([]);
  });

  it('skips contributors with fewer than 10 commits', async () => {
    mockExecFileSync.mockReturnValue('  9\tLow Committer <low@example.com>\n');

    const result = await buildContributorsToAssess(makeCtx());

    expect(result).toEqual([]);
  });

  it('returns contributors not yet assessed for this repo', async () => {
    mockExecFileSync.mockReturnValue('  15\tAlice <alice@example.com>\n  12\tBob <bob@example.com>\n');
    mockFindOrCreateContributor.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    // Alice: no existing assessment → include; Bob: existing assessment → skip
    setupDbChain([[], [{ id: 99 }]]);

    const result = await buildContributorsToAssess(makeCtx());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ email: 'alice@example.com', name: 'Alice', commits: 15 });
  });

  it('returns all contributors when none have been assessed', async () => {
    mockExecFileSync.mockReturnValue('  20\tAlice <alice@example.com>\n  15\tBob <bob@example.com>\n');
    mockFindOrCreateContributor.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    setupDbChain([[], []]);

    const result = await buildContributorsToAssess(makeCtx());

    expect(result).toHaveLength(2);
  });

  it('calls findOrCreateContributor with correct workspace id', async () => {
    mockExecFileSync.mockReturnValue('  10\tAlice <alice@example.com>\n');
    mockFindOrCreateContributor.mockResolvedValueOnce(1);
    setupDbChain([[]]);

    await buildContributorsToAssess(makeCtx({ workspaceId: 42 }));

    expect(mockFindOrCreateContributor).toHaveBeenCalledWith('alice@example.com', 'Alice', 42);
  });

  it('deduplicates email aliases that resolve to the same contributor ID', async () => {
    mockExecFileSync.mockReturnValue(
      '  50\tJane <jane@mail.example.com>\n  30\tJane D <j.jane@example.com>\n',

    );
    // Both emails resolve to the same contributor ID
    mockFindOrCreateContributor.mockResolvedValueOnce(100).mockResolvedValueOnce(100);
    // Only one DB check expected (second email is deduped before checking)
    setupDbChain([[]]);

    const result = await buildContributorsToAssess(makeCtx());

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('jane@mail.example.com');
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
    mockGit(args => {
      if (args.startsWith('rev-list --count')) return '10\n';
      if (args.startsWith('shortlog -sne')) return '  10\tAlice <alice@example.com>\n';
      if (args.startsWith('branch -r')) return '  origin/main\n';
      if (args.startsWith('ls-files')) return '1024\tsrc/index.ts\0';
      if (args.startsWith('log --pretty=format:%ad')) return '2025-01\n';
      if (args.startsWith('log --name-only')) return '\nsrc/index.ts\n';
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

    // Default sshExec result: the scan-context fail-loud guard (checkRemoteFileExists)
    // runs `test -s` after the claude call; report the file as present. Per-test
    // mockResolvedValueOnce for the claude call still takes precedence (queued first).
    mockSshExec.mockResolvedValue({ stdout: 'exists\n', stderr: '', code: 0 });
  }

  // The step now issues non-claude SSH calls around the wave (stale-file rm -f
  // before, prompt tmp cleanup after), so claude responses are dispatched by
  // command content instead of call order.
  function mockClaudeResponse(result: { stdout: string; stderr: string; code: number }) {
    mockSshExec.mockImplementation(async (_cfg: unknown, cmd: string) => {
      if (String(cmd).includes('| claude ')) return result;
      return { stdout: 'exists\n', stderr: '', code: 0 };
    });
  }

  it('writes repo-metadata.json to agentDir', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.01, duration_ms: 5000 }),
      stderr: '',
      code: 0,
    });

    await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    const metadataCall = mockWriteFileSync.mock.calls.find(
      (call: unknown[]) => String(call[0]).endsWith('repo-metadata.json'),
    );
    expect(metadataCall).toBeDefined();
    expect(metadataCall![0]).toContain('/workspace/repo/repo-metadata.json');
  });

  it('writes contributors-to-assess.json to agentDir', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.01, duration_ms: 5000 }),
      stderr: '',
      code: 0,
    });

    await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    const assessCall = mockWriteFileSync.mock.calls.find(
      (call: unknown[]) => String(call[0]).endsWith('contributors-to-assess.json'),
    );
    expect(assessCall).toBeDefined();
  });

  it('returns profileGenerated=true when analyzer runs and the profile is verified present', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.02, duration_ms: 8000 }),
      stderr: '',
      code: 0,
    });
    mockSshReadFile.mockResolvedValueOnce('# Repository Profile\n\nContent.');

    const result = await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    expect(result.profileGenerated).toBe(true);
    expect(result.aiAvailable).toBe(true);
  });

  it('returns profileGenerated=false when the analyzer succeeded but the profile is empty', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.02, duration_ms: 8000 }),
      stderr: '',
      code: 0,
    });
    mockSshReadFile.mockResolvedValueOnce('   \n');

    const result = await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    expect(result.aiAvailable).toBe(true);
    expect(result.profileGenerated).toBe(false);
  });

  it('REJECTS when the analyzer throws and AI analysis is enabled', async () => {
    // The analyzer was supposed to run and didn't — the step must fail the scan
    // (previously it swallowed the error into aiAvailable=false).
    setupHappyPath();
    mockExistsSync.mockReturnValue(false);
    mockClaudeResponse({
      stdout: JSON.stringify({ is_error: true, result: 'Claude crashed' }),
      stderr: '',
      code: 0,
    });

    await expect(runAnalysisStep({ ctx: makeCtx(), prev: {} })).rejects.toThrow('Analyzer failed');

    // The post-run profile/scan-context checks are never reached
    expect(mockSshReadFile).not.toHaveBeenCalled();
    const profileSave = mockAddScanFile.mock.calls.find(
      ([arg]: any[]) => arg?.fileType === 'profile',
    );
    expect(profileSave).toBeUndefined();
  });

  it('removes stale scan-context and repo-profile on claude-runner BEFORE invoking the analyzer', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.02, duration_ms: 8000 }),
      stderr: '',
      code: 0,
    });
    mockSshReadFile.mockResolvedValueOnce('# Profile');

    await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    const calls = mockSshExec.mock.calls.map(c => String(c[1]));
    const rmIdx = calls.findIndex(c =>
      c.includes('rm -f') && c.includes('/workspace/repo/scan-context.md') && c.includes('/workspace/repo/repo-profile.md'),
    );
    const claudeIdx = calls.findIndex(c => c.includes('| claude '));
    expect(rmIdx).toBeGreaterThanOrEqual(0);
    expect(claudeIdx).toBeGreaterThan(rmIdx);
  });

  it('threads ctx.cancelSignal into the stale-file rm -f and the scan-context existence check', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.02, duration_ms: 8000 }),
      stderr: '',
      code: 0,
    });
    mockSshReadFile.mockResolvedValueOnce('# Profile');
    const controller = new AbortController();

    await runAnalysisStep({ ctx: makeCtx({ cancelSignal: controller.signal }), prev: {} });

    const rmCall = mockSshExec.mock.calls.find(c =>
      String(c[1]).includes('rm -f') && String(c[1]).includes('scan-context.md'));
    expect(rmCall).toBeDefined();
    expect((rmCall![2] as Record<string, unknown> | undefined)?.signal).toBe(controller.signal);

    const existsCall = mockSshExec.mock.calls.find(c => String(c[1]).startsWith('test -s'));
    expect(existsCall).toBeDefined();
    expect((existsCall![2] as Record<string, unknown> | undefined)?.signal).toBe(controller.signal);
  });

  it('does not remove remote files when AI analysis is disabled', async () => {
    setupHappyPath();

    await runAnalysisStep({ ctx: makeCtx({ aiAnalysisEnabled: false }), prev: {} });

    const rmCalls = mockSshExec.mock.calls.filter(c => String(c[1]).includes('rm -f'));
    expect(rmCalls).toHaveLength(0);
  });

  it('SCREAMS when analyzer throws: logs an error event, persists analysis-error.log, and rethrows', async () => {
    setupHappyPath();
    mockExistsSync.mockReturnValue(false);
    mockClaudeResponse({
      stdout: JSON.stringify({ is_error: true, result: 'Claude crashed' }),
      stderr: '',
      code: 0,
    });

    await expect(runAnalysisStep({ ctx: makeCtx(), prev: {} })).rejects.toThrow('Analyzer failed');

    expect(mockLogScanEvent).toHaveBeenCalledWith(
      'scan-1', 'analysis', 'error', expect.stringContaining('Analyzer failed'),
      expect.anything(), expect.anything(), expect.anything(),
    );
    expect(mockAddScanFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'analysis-error.log' }),
    );
  });

  it('always calls runAnalyzer regardless of profile existence', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.01, duration_ms: 5000 }),
      stderr: '',
      code: 0,
    });

    await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    expect(mockSshExec).toHaveBeenCalled();
  });

  it('returns metadataPath pointing to agentDir/repo-metadata.json', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.01, duration_ms: 5000 }),
      stderr: '',
      code: 0,
    });

    const result = await runAnalysisStep({ ctx: makeCtx({ agentDir: '/workspace/agent' }), prev: {} });

    expect(result.metadataPath).toBe('/workspace/agent/repo-metadata.json');
  });

  it('persists repository profile content as scan_file with type=profile', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.02, duration_ms: 8000 }),
      stderr: '',
      code: 0,
    });
    mockSshReadFile.mockResolvedValueOnce('# Repo Profile\n\nReal profile content here.');

    await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    const profileSave = mockAddScanFile.mock.calls.find(
      ([arg]: any[]) => arg?.fileType === 'profile',
    );
    expect(profileSave).toBeDefined();
    expect(profileSave![0]).toEqual(expect.objectContaining({
      scanId: 'scan-1',
      fileName: 'repository-profile.md',
      fileType: 'profile',
      content: '# Repo Profile\n\nReal profile content here.',
    }));
  });

  it('threads ctx.cancelSignal into the profile sshReadFile (SFTP must abort on cancel too)', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.02, duration_ms: 8000 }),
      stderr: '',
      code: 0,
    });
    mockSshReadFile.mockResolvedValueOnce('# Repo Profile');
    const controller = new AbortController();

    await runAnalysisStep({ ctx: makeCtx({ cancelSignal: controller.signal }), prev: {} });

    const profileRead = mockSshReadFile.mock.calls.find(c => c[1] === '/workspace/src-1/repo/repo-profile.md' || String(c[1]).includes('repo-profile.md'));
    expect(profileRead).toBeDefined();
    expect(profileRead![2]).toBe(controller.signal);
  });

  it('does not persist profile when sshReadFile returns empty', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.02, duration_ms: 8000 }),
      stderr: '',
      code: 0,
    });
    mockSshReadFile.mockResolvedValueOnce('   \n');

    await runAnalysisStep({ ctx: makeCtx(), prev: {} });

    const profileSave = mockAddScanFile.mock.calls.find(
      ([arg]: any[]) => arg?.fileType === 'profile',
    );
    expect(profileSave).toBeUndefined();
  });

  it('does not throw when sshReadFile fails', async () => {
    setupHappyPath();
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.02, duration_ms: 8000 }),
      stderr: '',
      code: 0,
    });
    mockSshReadFile.mockRejectedValueOnce(new Error('SSH read failed'));

    // Pipeline should still succeed even if profile persist fails
    await expect(runAnalysisStep({ ctx: makeCtx(), prev: {} })).resolves.toBeDefined();
  });

  it('FAILS LOUD when the analyzer did not write the scan context', async () => {
    setupHappyPath();
    // Claude call succeeds; but the scan-context file is absent -> the guard must throw.
    mockSshExec.mockImplementation(async (_cfg: unknown, cmd: string) => {
      if (cmd.includes('scan-context.md')) return { stdout: 'missing\n', stderr: '', code: 0 };
      return { stdout: JSON.stringify({ total_cost_usd: 0.02, duration_ms: 8000 }), stderr: '', code: 0 };
    });

    await expect(runAnalysisStep({ ctx: makeCtx(), prev: {} })).rejects.toThrow(/scan context/i);
    expect(mockLogScanEvent).toHaveBeenCalledWith(
      'scan-1', 'analysis', 'error', expect.stringContaining('scan context'),
      expect.anything(), expect.anything(), expect.anything(),
    );
  });

  it('returns contributorsAssessed count matching unassessed contributors', async () => {
    setupHappyPath();
    // Override execSync so shortlog in buildContributorsToAssess returns 2 contributors with enough commits
    mockGit(args => {
      if (args.startsWith('rev-list --count')) return '10\n';
      if (args.startsWith('shortlog -sne')) return '  20\tAlice <alice@example.com>\n  15\tBob <bob@example.com>\n';
      if (args.startsWith('branch -r')) return '  origin/main\n';
      if (args.startsWith('ls-files')) return '1024\tsrc/index.ts\0';
      if (args.startsWith('log --pretty=format:%ad')) return '2025-01\n';
      if (args.startsWith('log --name-only')) return '\nsrc/index.ts\n';
      return '';
    });
    mockClaudeResponse({
      stdout: JSON.stringify({ total_cost_usd: 0.01, duration_ms: 5000 }),
      stderr: '',
      code: 0,
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
