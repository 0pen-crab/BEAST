import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext } from '../pipeline-types.ts';

const {
  mockSshExec, mockSshWriteFile, mockGetClaudeRunnerConfig, mockBuildMirror, mockAddScanFile, mockPreClassifyAll,
  mockEnsureScanModule, mockListScanModules, mockMarkRunning, mockMarkCompleted, mockMarkPending, mockMarkFailed,
} = vi.hoisted(() => ({
  mockSshExec: vi.fn(),
  mockSshWriteFile: vi.fn().mockResolvedValue(undefined),
  mockGetClaudeRunnerConfig: vi.fn().mockReturnValue({
    host: 'claude-runner', port: 22, username: 'scanner', privateKey: Buffer.from('fake-key'),
  }),
  mockBuildMirror: vi.fn(),
  mockAddScanFile: vi.fn().mockResolvedValue(undefined),
  mockPreClassifyAll: vi.fn(),
  mockEnsureScanModule: vi.fn(),
  mockListScanModules: vi.fn().mockResolvedValue([]),
  mockMarkRunning: vi.fn().mockResolvedValue(undefined),
  mockMarkCompleted: vi.fn().mockResolvedValue(undefined),
  mockMarkPending: vi.fn().mockResolvedValue(undefined),
  mockMarkFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ssh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssh.ts')>();
  return {
    ...actual,
    sshExec: mockSshExec,
    sshWriteFile: mockSshWriteFile,
    getClaudeRunnerConfig: mockGetClaudeRunnerConfig,
  };
});

vi.mock('./mirror-builder.ts', () => ({
  buildMirror: mockBuildMirror,
}));

vi.mock('./pre-classifier.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pre-classifier.ts')>();
  return {
    ...actual,
    preClassifyAll: mockPreClassifyAll,
  };
});

vi.mock('../entities.ts', () => ({
  addScanFile: mockAddScanFile,
}));

vi.mock('../scan-modules.ts', () => ({
  ensureScanModule: mockEnsureScanModule,
  listScanModules: mockListScanModules,
  markScanModuleRunning: mockMarkRunning,
  markScanModuleCompleted: mockMarkCompleted,
  markScanModulePending: mockMarkPending,
  markScanModuleFailed: mockMarkFailed,
}));

import { runScanner, runAiResearchStep } from './scanner.ts';
import { ScanPausedError } from '../rate-limit.ts';

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
    workDir: '/workspace/scan-1',
    repoPath: '/workspace/scan-1/repo',
    toolsDir: '/workspace/scan-1/results',
    agentDir: '/workspace/scan-1/agent',
    resultsDir: '/workspace/scan-1/results',
    profilePath: '/workspace/scan-1/repo-profile.md',
    cloneUrl: 'https://github.com/org/repo.git',
    reportLanguage: 'en',
    aiAnalysisEnabled: true,
    aiScanningEnabled: true,
    aiTriageEnabled: true,
    aiModelAnalyzer: 'sonnet',
    aiModelScanner: 'opus',
    aiModelTriage: 'opus',
    scanDepth: 1500,
    ...overrides,
  } as PipelineContext;
}

const CLAUDE_SUCCESS = {
  type: 'result', total_cost_usd: 0.1, duration_ms: 5000, result: 'done',
  modelUsage: {
    'claude-sonnet-4-6': {
      inputTokens: 100, outputTokens: 500,
      cacheReadInputTokens: 1000, cacheCreationInputTokens: 5000,
      costUSD: 0.1,
    },
  },
};

const CLAUDE_OPUS_SUCCESS = {
  type: 'result', total_cost_usd: 0.5, duration_ms: 30000, result: 'done',
  modelUsage: {
    'claude-opus-4-6[1m]': {
      inputTokens: 1000, outputTokens: 2000,
      cacheReadInputTokens: 5000, cacheCreationInputTokens: 50000,
      costUSD: 0.5,
    },
  },
};

// ── runScanner (legacy single-pass) ─────────────────────────────────

describe('runScanner (legacy single-pass)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exports a callable function', () => {
    expect(typeof runScanner).toBe('function');
  });

  it('returns cost/duration/aiUsage on success', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({
        type: 'result', total_cost_usd: 0.12, duration_ms: 30000, result: 'done',
        modelUsage: {
          'claude-opus-4-6[1m]': {
            inputTokens: 14, outputTokens: 8000,
            cacheReadInputTokens: 200000, cacheCreationInputTokens: 25000,
            costUSD: 0.12,
          },
        },
      }),
      stderr: '', code: 0,
    });

    const result = await runScanner(makeCtx());
    expect(result.cost).toBe(0.12);
    expect(result.durationMs).toBe(30000);
    expect(result.aiUsage?.model).toBe('claude-opus-4-6[1m]');
  });

  it('throws on invalid JSON output', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: 'garbage', stderr: '', code: 0 });
    await expect(runScanner(makeCtx())).rejects.toThrow('Scanner failed: No result event found');
  });

  it('throws auth error when not logged in', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' }),
      stderr: '', code: 0,
    });
    await expect(runScanner(makeCtx())).rejects.toThrow('not authenticated');
  });
});

// ── runAiResearchStep (new pipeline) ───────────────────────────────

describe('runAiResearchStep (linguist-based pipeline)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildMirror.mockResolvedValue({
      mirrorPath: '/workspace/scan-1/agent/mirror',
      metadataPath: '/workspace/scan-1/agent/mirror/_metadata.jsonl',
      repoPath: '/workspace/scan-1/repo',
      fileCount: 100,
      durationMs: 5000,
    });
    // Default: no persisted modules (fresh scan)
    mockListScanModules.mockResolvedValue([]);
    // Default: ensureScanModule returns a fresh row with status=pending
    mockEnsureScanModule.mockImplementation(async (input) => ({
      id: input.moduleIndex + 100,
      scanId: input.scanId,
      moduleIndex: input.moduleIndex,
      moduleName: input.moduleName,
      status: 'pending',
      fileCount: input.fileCount,
      outputPath: input.outputPath,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    }));
  });

  it('skips when aiScanningEnabled is false', async () => {
    const r = await runAiResearchStep({ ctx: makeCtx({ aiScanningEnabled: false }), prev: { aiAvailable: true } });
    expect(r).toEqual({ scanCompleted: false, skipped: true, durationMs: 0 });
    expect(mockBuildMirror).not.toHaveBeenCalled();
  });

  it('skips when prev.aiAvailable is false', async () => {
    const r = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: false } });
    expect(r).toEqual({ scanCompleted: false, skipped: true, durationMs: 0 });
    expect(mockBuildMirror).not.toHaveBeenCalled();
  });

  it('runs pipeline: mirror → pre-classify → scout UNCLEAR → sniper → merge', async () => {
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
        { path: 'config/x.cfg', bucket: 'UNCLEAR', size_bytes: 300, line_count: 10, ext: 'cfg', is_binary: false, avg_line_length: 30, mtime: 0, sha256_head_1kb: 'y', linguist_category: null, reason: 'linguist: no-match' },
      ],
      counts: { TRASH: 50, DOCS: 10, INTERESTING: 1, UNCLEAR: 1 },
    });

    // Scout UNCLEAR batch: claude call + read output
    mockSshExec.mockResolvedValueOnce({ stdout: JSON.stringify(CLAUDE_SUCCESS), stderr: '', code: 0 });
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ interesting: ['config/x.cfg'], trash: [] }),
      stderr: '', code: 0,
    });

    // Sniper (one module — small repo)
    mockSshExec.mockResolvedValueOnce({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });

    // Merge
    mockSshExec.mockResolvedValueOnce({ stdout: '/workspace/scan-1/agent/partial-mod.json\n', stderr: '', code: 0 });
    mockSshExec.mockResolvedValueOnce({ stdout: '[]', stderr: '', code: 0 });

    const r = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } });

    expect(r.scanCompleted).toBe(true);
    expect(mockBuildMirror).toHaveBeenCalledOnce();
    expect(mockPreClassifyAll).toHaveBeenCalledOnce();

    // Verify no INTERESTING-verifier calls (we removed that stage)
    const verifierCalls = mockSshExec.mock.calls.filter(c => String(c[1]).includes('scanner-scout-interesting'));
    expect(verifierCalls).toHaveLength(0);

    expect(mockSshWriteFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('code-analysis.sarif'),
      expect.any(String),
    );
  });

  it('skips scout UNCLEAR phase when no UNCLEAR files', async () => {
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
      ],
      counts: { TRASH: 50, DOCS: 0, INTERESTING: 1, UNCLEAR: 0 },
    });

    // No scout calls, just Sniper + Merge
    mockSshExec.mockResolvedValueOnce({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });

    const r = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } });
    expect(r.scanCompleted).toBe(true);

    // No scout calls at all
    const scoutCalls = mockSshExec.mock.calls.filter(c => String(c[1]).includes('scanner-scout'));
    expect(scoutCalls).toHaveLength(0);
  });

  // ── Resume / pause behavior ────────────────────────────────────

  it('marks module pending and rethrows ScanPausedError when Sniper hits rate limit', async () => {
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
      ],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 1, UNCLEAR: 0 },
    });

    // Sniper SSH call returns Claude rate-limit response
    mockSshExec.mockResolvedValueOnce({
      stdout: '{"type":"result","is_error":true,"result":"You\'re out of extra usage","error":"rate_limit","resetsAt":1810000000}',
      stderr: '',
      code: 0,
    });

    await expect(runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } }))
      .rejects.toBeInstanceOf(ScanPausedError);

    // Module was marked running, then pending (not failed, not completed)
    expect(mockMarkRunning).toHaveBeenCalledTimes(1);
    expect(mockMarkPending).toHaveBeenCalledTimes(1);
    expect(mockMarkCompleted).not.toHaveBeenCalled();
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it('marks module failed when Sniper throws non-paused error', async () => {
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
      ],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 1, UNCLEAR: 0 },
    });

    mockSshExec.mockResolvedValueOnce({ stdout: 'garbage', stderr: '', code: 0 });

    await expect(runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } }))
      .rejects.toThrow();

    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkPending).not.toHaveBeenCalled();
    expect(mockMarkCompleted).not.toHaveBeenCalled();
  });

  it('skips already-completed Sniper modules on resume', async () => {
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
      ],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 1, UNCLEAR: 0 },
    });

    // Persisted: this scan already has module 0 completed (resume case)
    mockListScanModules.mockResolvedValueOnce([
      {
        id: 100, scanId: 'scan-1', moduleIndex: 0, moduleName: 'all',
        status: 'completed', fileCount: 1, outputPath: '/p.json',
        error: null, startedAt: new Date(), completedAt: new Date(), createdAt: new Date(),
      } as any,
    ]);

    // No Sniper SSH call expected — only Merge stage
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });

    const r = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } });
    expect(r.scanCompleted).toBe(true);

    // No 'running'/'completed' marks because module was already completed
    expect(mockMarkRunning).not.toHaveBeenCalled();
    expect(mockMarkCompleted).not.toHaveBeenCalled();

    // Sniper Claude call should NOT have happened
    const claudeCalls = mockSshExec.mock.calls.filter(c => String(c[1]).includes('claude '));
    expect(claudeCalls).toHaveLength(0);
  });
});
