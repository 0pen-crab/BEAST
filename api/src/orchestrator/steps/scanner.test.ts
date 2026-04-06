import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext } from '../pipeline-types.ts';

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

vi.mock('../entities.ts', () => ({
  addScanFile: vi.fn(),
}));

import { runScanner, runAiResearchStep } from './scanner.ts';

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

describe('runScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a callable function', () => {
    expect(typeof runScanner).toBe('function');
  });

  it('returns cost and duration on success', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ total_cost_usd: 0.12, duration_ms: 30000, result: 'done' }),
      stderr: '',
      code: 0,
    });

    const result = await runScanner(makeCtx());

    expect(result.cost).toBe(0.12);
    expect(result.durationMs).toBe(30000);
    expect(result.log).toBeDefined();
    expect(mockSshExec.mock.calls[0][1]).toContain('claude -p');
    expect(mockSshExec.mock.calls[0][1]).toContain('scanner.md');
  });

  it('includes commit hash in prompt when provided', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ total_cost_usd: 0.1, duration_ms: 5000 }),
      stderr: '',
      code: 0,
    });

    await runScanner(makeCtx({ commitHash: 'deadbeef' }));

    const command = mockSshExec.mock.calls[0][1];
    expect(command).toContain('deadbeef');
  });

  it('throws on invalid JSON output', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: 'garbage output',
      stderr: '',
      code: 0,
    });

    await expect(runScanner(makeCtx())).rejects.toThrow('Scanner failed: No result event found');
  });

  it('throws when result indicates is_error', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ is_error: true, result: 'Scanner crashed' }),
      stderr: '',
      code: 0,
    });

    await expect(runScanner(makeCtx())).rejects.toThrow('Scanner failed');
  });

  it('throws auth error when not logged in', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ is_error: true, result: 'Not logged in' }),
      stderr: '',
      code: 0,
    });

    await expect(runScanner(makeCtx())).rejects.toThrow('not authenticated');
  });

  it('succeeds on non-zero exit code when stream result says success', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ result: 'done', total_cost_usd: 0.05 }),
      stderr: '',
      code: 137,
    });

    const result = await runScanner(makeCtx());
    expect(result.cost).toBe(0.05);
  });
});

describe('runAiResearchStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when prev.aiAvailable is false', async () => {
    const result = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: false } });

    expect(result).toEqual({ scanCompleted: false, skipped: true, durationMs: 0 });
    expect(mockSshExec).not.toHaveBeenCalled();
  });

  it('calls runScanner when prev.aiAvailable is true and returns AiResearchOutput', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ total_cost_usd: 0.05, duration_ms: 10000 }),
      stderr: '',
      code: 0,
    });

    const result = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } });

    expect(result.scanCompleted).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockSshExec).toHaveBeenCalledOnce();
  });

  it('passes through cost from runScanner result', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ total_cost_usd: 0.42, duration_ms: 20000 }),
      stderr: '',
      code: 0,
    });

    const result = await runAiResearchStep({ ctx: makeCtx(), prev: { aiAvailable: true } });

    expect(result.cost).toBe(0.42);
  });
});
