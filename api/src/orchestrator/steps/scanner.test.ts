import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext } from '../pipeline-types.ts';

const {
  mockSshExec, mockSshWriteFile, mockGetClaudeRunnerConfig, mockBuildMirror, mockAddScanFile, mockPreClassifyAll,
  mockEnsureScanModule, mockListScanModules, mockMarkRunning, mockMarkCompleted, mockMarkPending, mockMarkFailed,
  mockLogScanEvent, mockCheckRemoteFileExists,
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
  mockLogScanEvent: vi.fn().mockResolvedValue(undefined),
  mockCheckRemoteFileExists: vi.fn().mockResolvedValue(true),
}));

vi.mock('../pipeline.ts', () => ({
  logScanEvent: mockLogScanEvent,
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

vi.mock('./analyzer.ts', () => ({
  checkRemoteFileExists: mockCheckRemoteFileExists,
}));

vi.mock('../scan-modules.ts', () => ({
  ensureScanModule: mockEnsureScanModule,
  listScanModules: mockListScanModules,
  markScanModuleRunning: mockMarkRunning,
  markScanModuleCompleted: mockMarkCompleted,
  markScanModulePending: mockMarkPending,
  markScanModuleFailed: mockMarkFailed,
}));

import { runScanner, runAiResearchStep, partialOutputPath } from './scanner.ts';
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
    scanContextPath: '/workspace/scan-1/scan-context.md',
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

// ── partialOutputPath (module-index anti-collision) ────────────────

describe('partialOutputPath', () => {
  it('prefixes the module index so same-safeName modules cannot collide', () => {
    const ctx = makeCtx();
    const a = partialOutputPath(ctx, 0, 'src/API');
    const b = partialOutputPath(ctx, 1, 'src/api');
    expect(a).toBe('/workspace/scan-1/agent/partial-0-src_api.json');
    expect(b).toBe('/workspace/scan-1/agent/partial-1-src_api.json');
    expect(a).not.toBe(b);
  });

  it('long names truncated to 80 chars still get distinct paths per index', () => {
    const ctx = makeCtx();
    const long = 'x'.repeat(200);
    const a = partialOutputPath(ctx, 3, long + '/one');
    const b = partialOutputPath(ctx, 4, long + '/two');
    expect(a).not.toBe(b);
    expect(a).toContain('partial-3-');
    expect(b).toContain('partial-4-');
  });
});

// ── runAiResearchStep (new pipeline) ───────────────────────────────

describe('runAiResearchStep (linguist-based pipeline)', () => {
  // Ordered queue of SSH results for the pipeline stages. runClaudeWithTrace
  // issues out-of-band `rm -f /tmp/claude-prompt-*` cleanup calls after every
  // wave — those are answered directly so they don't consume queue entries.
  const sshQueue: Array<{ stdout: string; stderr: string; code: number }> = [];
  function enqueueSsh(result: { stdout: string; stderr: string; code: number }) {
    sshQueue.push(result);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sshQueue.length = 0;
    mockSshExec.mockImplementation(async (_cfg: unknown, cmd: string) => {
      if (String(cmd).startsWith('rm -f /tmp/claude-prompt-')) {
        return { stdout: '', stderr: '', code: 0 };
      }
      return sshQueue.shift() ?? { stdout: '', stderr: '', code: 0 };
    });
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

  it('skips when aiScanningEnabled is false and logs a warning event', async () => {
    const r = await runAiResearchStep({ ctx: makeCtx({ aiScanningEnabled: false }), prev: { aiAvailable: true } });
    expect(r).toEqual({ scanCompleted: false, skipped: true, skipReason: 'ai-scanning-disabled', durationMs: 0 });
    expect(mockBuildMirror).not.toHaveBeenCalled();
    expect(mockLogScanEvent).toHaveBeenCalledWith(
      'scan-1', 'ai-research', 'warning', expect.stringContaining('disabled'),
      expect.anything(), 'repo', 10,
    );
  });

  it('skips when prev.aiAvailable is false and SCREAMS via an error event', async () => {
    const r = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: false } });
    expect(r).toEqual({ scanCompleted: false, skipped: true, skipReason: 'analysis-failed', durationMs: 0 });
    expect(mockBuildMirror).not.toHaveBeenCalled();
    expect(mockLogScanEvent).toHaveBeenCalledWith(
      'scan-1', 'ai-research', 'error', expect.stringContaining('analysis step failed'),
      expect.anything(), 'repo', 10,
    );
  });

  it('FAILS LOUD when the scan context is missing (no blind scanning)', async () => {
    mockCheckRemoteFileExists.mockResolvedValueOnce(false);
    await expect(
      runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } }),
    ).rejects.toThrow(/scan context missing/i);
    expect(mockBuildMirror).not.toHaveBeenCalled();
    expect(mockLogScanEvent).toHaveBeenCalledWith(
      'scan-1', 'ai-research', 'error', expect.stringContaining('Scan context missing'),
      expect.anything(), 'repo', 10,
    );
  });

  it('runs pipeline: mirror → pre-classify → scout UNCLEAR → sniper → merge', async () => {
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
        { path: 'config/x.cfg', bucket: 'UNCLEAR', size_bytes: 300, line_count: 10, ext: 'cfg', is_binary: false, avg_line_length: 30, mtime: 0, sha256_head_1kb: 'y', linguist_category: null, reason: 'linguist: no-match' },
      ],
      counts: { TRASH: 50, DOCS: 10, INTERESTING: 1, UNCLEAR: 1 },
    });

    // Scout UNCLEAR batch: cache-miss check, then claude call + read output
    enqueueSsh({ stdout: '', stderr: '', code: 0 });
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({
      stdout: JSON.stringify({ interesting: ['config/x.cfg'], trash: [] }),
      stderr: '', code: 0,
    });

    // Sniper (one module — small repo)
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });

    // Merge
    enqueueSsh({ stdout: '/workspace/scan-1/agent/partial-mod.json\n', stderr: '', code: 0 });
    enqueueSsh({ stdout: '[]', stderr: '', code: 0 });

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
      undefined, // ctx.cancelSignal is threaded through (unset in this test ctx)
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
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({ stdout: '', stderr: '', code: 0 });

    const r = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } });
    expect(r.scanCompleted).toBe(true);

    // No scout calls at all
    const scoutCalls = mockSshExec.mock.calls.filter(c => String(c[1]).includes('scanner-scout'));
    expect(scoutCalls).toHaveLength(0);
  });

  it('throws when the pre-classifier yields 0 files but the mirror contains files (silent-corruption guard)', async () => {
    // mirror.fileCount is 100 (default beforeEach mock) but pre-classify sees nothing —
    // e.g. metadata got wiped between stages. Completing "successfully" with 0 modules
    // and 0 AI findings would be silent result corruption.
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 0, UNCLEAR: 0 },
    });

    await expect(runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } }))
      .rejects.toThrow(/0 files|zero/i);
  });

  it('records a warning scan event when a scout batch produces no valid output (fail-safe fallback)', async () => {
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'config/x.cfg', bucket: 'UNCLEAR', size_bytes: 300, line_count: 10, ext: 'cfg', is_binary: false, avg_line_length: 30, mtime: 0, sha256_head_1kb: 'y', linguist_category: null, reason: 'linguist: no-match' },
      ],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 0, UNCLEAR: 1 },
    });

    // Scout: cache miss, claude succeeds, but the output file read yields nothing valid.
    enqueueSsh({ stdout: '', stderr: '', code: 0 });
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({ stdout: 'not-json', stderr: '', code: 0 });

    // Fallback promotes the UNCLEAR file to INTERESTING → one Sniper module + Merge.
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({ stdout: '', stderr: '', code: 0 });

    const r = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } });
    expect(r.scanCompleted).toBe(true);

    // The fail-safe must be visible in the Events tab, not just console.error.
    expect(mockLogScanEvent).toHaveBeenCalledWith(
      'scan-1', 'ai-research', 'warning', expect.stringContaining('INTERESTING'),
      expect.anything(), 'repo', 10,
    );
  });

  it('threads ctx.cancelSignal into remote cat/ls sshExec calls (cancellation must abort remote ops)', async () => {
    const controller = new AbortController();
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
        { path: 'config/x.cfg', bucket: 'UNCLEAR', size_bytes: 300, line_count: 10, ext: 'cfg', is_binary: false, avg_line_length: 30, mtime: 0, sha256_head_1kb: 'y', linguist_category: null, reason: 'linguist: no-match' },
      ],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 1, UNCLEAR: 1 },
    });

    // Scout: cache miss, claude call, output read
    enqueueSsh({ stdout: '', stderr: '', code: 0 });
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({ stdout: JSON.stringify({ interesting: [], trash: ['config/x.cfg'] }), stderr: '', code: 0 });
    // Sniper
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    // Merge: ls + partial read
    enqueueSsh({ stdout: '/workspace/scan-1/agent/partial-0-mod.json\n', stderr: '', code: 0 });
    enqueueSsh({ stdout: '[]', stderr: '', code: 0 });

    const r = await runAiResearchStep({
      ctx: makeCtx({ cancelSignal: controller.signal }),
      prev: { aiAvailable: true },
    });
    expect(r.scanCompleted).toBe(true);

    // Every remote read (cat of scout cache/output/partials, ls of partials)
    // must carry the cancel signal so an abort kills the SSH session.
    const remoteReads = mockSshExec.mock.calls.filter(c =>
      String(c[1]).startsWith('cat ') || String(c[1]).startsWith('ls '));
    expect(remoteReads.length).toBeGreaterThanOrEqual(4);
    for (const call of remoteReads) {
      expect((call[2] as Record<string, unknown> | undefined)?.signal).toBe(controller.signal);
    }
  });

  it('passes ctx.cancelSignal to preClassifyAll', async () => {
    const controller = new AbortController();
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
      ],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 1, UNCLEAR: 0 },
    });
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({ stdout: '', stderr: '', code: 0 });

    await runAiResearchStep({ ctx: makeCtx({ cancelSignal: controller.signal }), prev: { aiAvailable: true } });

    expect(mockPreClassifyAll).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), controller.signal,
    );
  });

  // ── Module name collisions (partial paths / trace names) ────────

  it('gives modules whose names collapse to the same safe name DISTINCT partial paths via the module index', async () => {
    // 'src/API' and 'src/api' both normalize to module name 'src_api' — without
    // the index their partial-*.json paths collide and one silently overwrites
    // the other's findings.
    const filesInDir = (dir: string, n: number) => Array.from({ length: n }, (_, i) => ({
      path: `${dir}/f${i}.ts`, bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts',
      is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x',
      linguist_category: 'programming', reason: 'linguist: programming',
    }));
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [...filesInDir('src/API', 60), ...filesInDir('src/api', 60)],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 120, UNCLEAR: 0 },
    });

    // Two Sniper claude calls + merge ls
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({ stdout: '', stderr: '', code: 0 });

    const r = await runAiResearchStep({ ctx: makeCtx({ scanDepth: 100 }), prev: { aiAvailable: true } });
    expect(r.scanCompleted).toBe(true);

    const outputPaths = mockEnsureScanModule.mock.calls.map(c => (c[0] as { outputPath: string }).outputPath);
    expect(outputPaths).toHaveLength(2);
    expect(new Set(outputPaths).size).toBe(2);
    expect(outputPaths[0]).toContain('partial-0-src_api');
    expect(outputPaths[1]).toContain('partial-1-src_api');

    // Sniper prompts must reference the distinct partial paths (each prompt is
    // written to the runner via sshWriteFile before the claude call).
    const promptWrites = mockSshWriteFile.mock.calls
      .map(c => String(c[2]))
      .filter(s => s.includes('PARTIAL_OUTPUT_PATH:'));
    expect(promptWrites.some(s => s.includes('partial-0-src_api'))).toBe(true);
    expect(promptWrites.some(s => s.includes('partial-1-src_api'))).toBe(true);
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
    enqueueSsh({
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

  it('marks module failed (twice: first pass + retry) and throws when the ONLY module keeps failing', async () => {
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
      ],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 1, UNCLEAR: 0 },
    });

    // First Sniper attempt + end-of-step retry both return garbage
    enqueueSsh({ stdout: 'garbage', stderr: '', code: 0 });
    enqueueSsh({ stdout: 'garbage', stderr: '', code: 0 });

    // All modules failed even after retry → hard step failure (total wipeout)
    await expect(runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } }))
      .rejects.toThrow(/after retries/i);

    // Two attempts: running→failed, then running→failed again on retry
    expect(mockMarkRunning).toHaveBeenCalledTimes(2);
    expect(mockMarkFailed).toHaveBeenCalledTimes(2);
    // The retry attempt's failure detail is prefixed so the module row tells the full story
    expect(String(mockMarkFailed.mock.calls[1][1])).toContain('failed after retry');
    expect(mockMarkPending).not.toHaveBeenCalled();
    expect(mockMarkCompleted).not.toHaveBeenCalled();
  });

  // ── End-of-step retry pass ──────────────────────────────────────

  // Two modules: module 0 fails on the first pass, module 1 succeeds. The
  // failed module must be retried AFTER all other modules finished — and when
  // the retry succeeds, the step output carries no moduleErrors.
  it('retries a failed module at the VERY END and reports no moduleErrors when the retry succeeds', async () => {
    const filesInDir = (dir: string, n: number) => Array.from({ length: n }, (_, i) => ({
      path: `${dir}/f${i}.ts`, bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts',
      is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x',
      linguist_category: 'programming', reason: 'linguist: programming',
    }));
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [...filesInDir('src/alpha', 60), ...filesInDir('src/beta', 60)],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 120, UNCLEAR: 0 },
    });

    // Module 0 Sniper: garbage (fails). Module 1 Sniper: success.
    enqueueSsh({ stdout: 'garbage', stderr: '', code: 0 });
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    // Retry of module 0 (AFTER module 1): success.
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    // Merge: ls
    enqueueSsh({ stdout: '', stderr: '', code: 0 });

    const r = await runAiResearchStep({ ctx: makeCtx({ scanDepth: 100 }), prev: { aiAvailable: true } });
    expect(r.scanCompleted).toBe(true);
    expect(r.moduleErrors).toBeUndefined();

    // Ordering: the retry prompt for module 0 was written AFTER module 1's prompt.
    const sniperPrompts = mockSshWriteFile.mock.calls
      .map(c => String(c[2]))
      .filter(s => s.includes('PARTIAL_OUTPUT_PATH:'));
    expect(sniperPrompts).toHaveLength(3);
    expect(sniperPrompts[0]).toContain('partial-0-');
    expect(sniperPrompts[1]).toContain('partial-1-');
    expect(sniperPrompts[2]).toContain('partial-0-'); // retry runs LAST

    // Module 0: running→failed (pass 1), running→completed (retry). Module 1: running→completed.
    expect(mockMarkRunning).toHaveBeenCalledTimes(3);
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkCompleted).toHaveBeenCalledTimes(2);
  });

  it('collects moduleErrors (failedAfterRetry) and does NOT throw when a module fails after retry but others succeeded', async () => {
    const filesInDir = (dir: string, n: number) => Array.from({ length: n }, (_, i) => ({
      path: `${dir}/f${i}.ts`, bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts',
      is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x',
      linguist_category: 'programming', reason: 'linguist: programming',
    }));
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [...filesInDir('src/alpha', 60), ...filesInDir('src/beta', 60)],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 120, UNCLEAR: 0 },
    });

    // Module 0 fails, module 1 succeeds, module 0 retry fails again.
    enqueueSsh({ stdout: 'garbage', stderr: '', code: 0 });
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({ stdout: 'garbage', stderr: '', code: 0 });
    // Merge: ls
    enqueueSsh({ stdout: '', stderr: '', code: 0 });

    const r = await runAiResearchStep({ ctx: makeCtx({ scanDepth: 100 }), prev: { aiAvailable: true } });

    // Step does NOT throw — merge ran on the successful partials.
    expect(r.scanCompleted).toBe(true);
    expect(r.moduleErrors).toHaveLength(1);
    expect(r.moduleErrors![0]).toMatchObject({
      kind: 'module',
      name: 'src_alpha', // partitioner-normalized module name
      failedAfterRetry: true,
    });
    expect(r.moduleErrors![0].error).toContain('failed after retry');

    // The failed-after-retry module is screamed to the Events tab — error level,
    // same severity class as a security tool failing after retry
    expect(mockLogScanEvent).toHaveBeenCalledWith(
      'scan-1', 'ai-research', 'error', expect.stringContaining('failed after retry'),
      expect.anything(), 'repo', 10,
    );
  });

  it('rethrows ScanPausedError from the retry pass after marking the module pending (resumable)', async () => {
    const filesInDir = (dir: string, n: number) => Array.from({ length: n }, (_, i) => ({
      path: `${dir}/f${i}.ts`, bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts',
      is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x',
      linguist_category: 'programming', reason: 'linguist: programming',
    }));
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [...filesInDir('src/alpha', 60), ...filesInDir('src/beta', 60)],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 120, UNCLEAR: 0 },
    });

    // Module 0 fails, module 1 succeeds, module 0 retry hits the rate limit.
    enqueueSsh({ stdout: 'garbage', stderr: '', code: 0 });
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({
      stdout: '{"type":"result","is_error":true,"result":"You\'re out of extra usage","error":"rate_limit","resetsAt":1810000000}',
      stderr: '', code: 0,
    });

    await expect(runAiResearchStep({ ctx: makeCtx({ scanDepth: 100 }), prev: { aiAvailable: true } }))
      .rejects.toBeInstanceOf(ScanPausedError);

    // Retry attempt parked the module as pending so resume re-runs it
    expect(mockMarkPending).toHaveBeenCalledTimes(1);
  });

  it('reuses cached scout-unclear result on resume (no Claude re-call)', async () => {
    // Setup: classified set has UNCLEAR files (would normally trigger scout)
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
        { path: 'config/x.cfg', bucket: 'UNCLEAR', size_bytes: 300, line_count: 10, ext: 'cfg', is_binary: false, avg_line_length: 30, mtime: 0, sha256_head_1kb: 'y', linguist_category: null, reason: 'linguist: no-match' },
      ],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 1, UNCLEAR: 1 },
    });

    // Pre-existing scout result file from a previous run — cache HIT.
    enqueueSsh({
      stdout: JSON.stringify({ interesting: ['config/x.cfg'], trash: [] }),
      stderr: '', code: 0,
    });

    // No Claude call for scout — go straight to Sniper.
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });

    // Merge
    enqueueSsh({ stdout: '/workspace/scan-1/agent/partial-mod.json\n', stderr: '', code: 0 });
    enqueueSsh({ stdout: '[]', stderr: '', code: 0 });

    const r = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } });
    expect(r.scanCompleted).toBe(true);

    // Scout Claude prompt path should NEVER be invoked because cache served it.
    const scoutClaudeCalls = mockSshExec.mock.calls.filter(c =>
      String(c[1]).includes('scanner-scout-unclear'),
    );
    expect(scoutClaudeCalls).toHaveLength(0);
  });

  it('falls back to Claude when cached scout result is invalid', async () => {
    mockPreClassifyAll.mockResolvedValueOnce({
      files: [
        { path: 'src/main.ts', bucket: 'INTERESTING', size_bytes: 1000, line_count: 50, ext: 'ts', is_binary: false, avg_line_length: 20, mtime: 0, sha256_head_1kb: 'x', linguist_category: 'programming', reason: 'linguist: programming' },
        { path: 'config/x.cfg', bucket: 'UNCLEAR', size_bytes: 300, line_count: 10, ext: 'cfg', is_binary: false, avg_line_length: 30, mtime: 0, sha256_head_1kb: 'y', linguist_category: null, reason: 'linguist: no-match' },
      ],
      counts: { TRASH: 0, DOCS: 0, INTERESTING: 1, UNCLEAR: 1 },
    });

    // Cache check returns empty (file missing) — must fall back to Claude.
    enqueueSsh({ stdout: '', stderr: '', code: 0 });

    // Scout Claude call
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({
      stdout: JSON.stringify({ interesting: ['config/x.cfg'], trash: [] }),
      stderr: '', code: 0,
    });

    // Sniper + Merge
    enqueueSsh({ stdout: JSON.stringify(CLAUDE_OPUS_SUCCESS), stderr: '', code: 0 });
    enqueueSsh({ stdout: '/workspace/scan-1/agent/partial-mod.json\n', stderr: '', code: 0 });
    enqueueSsh({ stdout: '[]', stderr: '', code: 0 });

    const r = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } });
    expect(r.scanCompleted).toBe(true);

    // Scout Claude call SHOULD have happened (cache miss).
    const scoutClaudeCalls = mockSshExec.mock.calls.filter(c =>
      String(c[1]).includes('scanner-scout-unclear'),
    );
    expect(scoutClaudeCalls.length).toBeGreaterThan(0);
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
    enqueueSsh({ stdout: '', stderr: '', code: 0 });

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
