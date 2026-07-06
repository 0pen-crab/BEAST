import { describe, it, expect, vi, beforeEach } from 'vitest';

const addScanFileMock = vi.fn();
const dbDeleteMock = vi.fn();

const { mockSshExec, mockSshWriteFile, mockCheckRateLimit } = vi.hoisted(() => ({
  mockSshExec: vi.fn(),
  mockSshWriteFile: vi.fn().mockResolvedValue(undefined),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock('./entities.ts', () => ({
  addScanFile: (data: unknown) => addScanFileMock(data),
}));

vi.mock('../db/index.ts', () => ({
  db: {
    delete: () => ({
      where: (cond: unknown) => dbDeleteMock(cond),
    }),
  },
}));

vi.mock('../db/schema.ts', () => ({
  scanFiles: { scanId: 'scan_id', fileType: 'file_type' },
}));

vi.mock('./ssh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ssh.ts')>();
  return {
    ...actual,
    sshExec: mockSshExec,
    sshWriteFile: mockSshWriteFile,
    getClaudeRunnerConfig: vi.fn().mockReturnValue({
      host: 'claude-runner', port: 22, username: 'scanner', privateKey: Buffer.from('fake'),
    }),
  };
});

vi.mock('./rate-limit.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rate-limit.ts')>();
  return {
    ...actual,
    checkRateLimitAndPause: mockCheckRateLimit,
  };
});

import { persistTrace, clearTraces, runClaudeWithTrace, AI_TRACE_FILE_TYPE } from './ai-trace.ts';
import { SSHTimeoutError } from './ssh.ts';
import { ScanPausedError } from './rate-limit.ts';

describe('persistTrace', () => {
  beforeEach(() => {
    addScanFileMock.mockReset();
    dbDeleteMock.mockReset();
  });

  it('writes prompt + stream-json lines as jsonl content', async () => {
    const stdout = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
      '{"type":"result","is_error":false,"result":"done"}',
    ].join('\n');

    await persistTrace({ scanId: 'scan-1', wave: 'wave1', prompt: 'Verify this', stdout });

    expect(addScanFileMock).toHaveBeenCalledTimes(1);
    const call = addScanFileMock.mock.calls[0][0];
    expect(call).toMatchObject({
      scanId: 'scan-1',
      fileName: 'wave1.jsonl',
      fileType: AI_TRACE_FILE_TYPE,
    });
    const lines = call.content.split('\n');
    expect(JSON.parse(lines[0])).toEqual({ type: 'prompt', content: 'Verify this' });
    expect(JSON.parse(lines[1]).type).toBe('system');
    expect(JSON.parse(lines[3]).type).toBe('result');
  });

  it('appends trace_error line when errorMessage is provided', async () => {
    await persistTrace({
      scanId: 'scan-2',
      wave: 'wave2-injection',
      prompt: 'classify',
      stdout: '',
      errorMessage: 'API 401',
    });
    const call = addScanFileMock.mock.calls[0][0];
    const lines = call.content.split('\n');
    expect(JSON.parse(lines[lines.length - 1])).toEqual({ type: 'trace_error', message: 'API 401' });
  });

  it('strips blank lines from stdout', async () => {
    await persistTrace({
      scanId: 'scan-3',
      wave: 'wave3',
      prompt: 'p',
      stdout: '\n{"type":"result","is_error":false}\n\n',
    });
    const call = addScanFileMock.mock.calls[0][0];
    const lines = call.content.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe('prompt');
    expect(JSON.parse(lines[1]).type).toBe('result');
  });
});

describe('clearTraces', () => {
  beforeEach(() => {
    addScanFileMock.mockReset();
    dbDeleteMock.mockReset();
  });

  it('issues a single delete keyed by scan id and trace file_type', async () => {
    await clearTraces('scan-xyz');
    expect(dbDeleteMock).toHaveBeenCalledTimes(1);
  });
});

// ── runClaudeWithTrace: prompt tmp file cleanup + error propagation ───────────

describe('runClaudeWithTrace', () => {
  const CLAUDE_OK = JSON.stringify({ type: 'result', is_error: false, result: 'done', total_cost_usd: 0.1 });

  const baseOpts = {
    scanId: 'scan-1',
    wave: 'wave1',
    prompt: 'do the thing',
    claudeArgs: '-p --output-format stream-json',
    inactivityTimeoutMs: 1000,
    maxTimeoutMs: 2000,
  };

  beforeEach(() => {
    addScanFileMock.mockReset();
    dbDeleteMock.mockReset();
    mockSshExec.mockReset();
    mockSshWriteFile.mockReset().mockResolvedValue(undefined);
    mockCheckRateLimit.mockReset();
  });

  it('does NOT append rm -f to the claude command (early-resolve SIGHUPs the shell before it runs)', async () => {
    mockSshExec.mockResolvedValue({ stdout: CLAUDE_OK, stderr: '', code: 0 });

    await runClaudeWithTrace(baseOpts);

    const claudeCall = mockSshExec.mock.calls.find(c => String(c[1]).includes('| claude '));
    expect(claudeCall).toBeDefined();
    expect(String(claudeCall![1])).not.toContain('rm -f');
  });

  it('deletes the prompt tmp file via a separate sshExec call on success', async () => {
    mockSshExec.mockResolvedValue({ stdout: CLAUDE_OK, stderr: '', code: 0 });

    await runClaudeWithTrace(baseOpts);

    const promptPath = mockSshWriteFile.mock.calls[0][1] as string;
    expect(promptPath).toMatch(/^\/tmp\/claude-prompt-/);
    const rmCall = mockSshExec.mock.calls.find(c => String(c[1]) === `rm -f ${promptPath}`);
    expect(rmCall).toBeDefined();
  });

  it('threads cancelSignal into the prompt sshWriteFile (SFTP must abort on cancel too)', async () => {
    mockSshExec.mockResolvedValue({ stdout: CLAUDE_OK, stderr: '', code: 0 });
    const controller = new AbortController();

    await runClaudeWithTrace({ ...baseOpts, cancelSignal: controller.signal });

    expect(mockSshWriteFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^\/tmp\/claude-prompt-/),
      baseOpts.prompt,
      controller.signal,
    );
  });

  it('cleans up the prompt tmp file and persists the trace error when the wave throws', async () => {
    mockSshExec.mockImplementation(async (_cfg: unknown, cmd: string) => {
      if (String(cmd).includes('| claude ')) throw new Error('ssh connection reset');
      return { stdout: '', stderr: '', code: 0 };
    });

    await expect(runClaudeWithTrace(baseOpts)).rejects.toThrow('ssh connection reset');

    const promptPath = mockSshWriteFile.mock.calls[0][1] as string;
    const rmCall = mockSshExec.mock.calls.find(c => String(c[1]) === `rm -f ${promptPath}`);
    expect(rmCall).toBeDefined();

    expect(addScanFileMock).toHaveBeenCalledTimes(1);
    const trace = addScanFileMock.mock.calls[0][0];
    expect(trace.content).toContain('trace_error');
    expect(trace.content).toContain('ssh connection reset');
  });

  it('swallows cleanup failures with a console.warn and still returns the result', async () => {
    mockSshExec.mockImplementation(async (_cfg: unknown, cmd: string) => {
      if (String(cmd).startsWith('rm -f ')) throw new Error('rm failed');
      return { stdout: CLAUDE_OK, stderr: '', code: 0 };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await runClaudeWithTrace(baseOpts);

    expect(r.parsed.result).toBe('done');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('persists errorMessage and cleans up even when the rate-limit check throws ScanPausedError', async () => {
    const timeoutErr = new SSHTimeoutError('SSH inactivity timeout after 1000ms', '{"type":"partial"}', '');
    mockSshExec.mockImplementation(async (_cfg: unknown, cmd: string) => {
      if (String(cmd).includes('| claude ')) throw timeoutErr;
      return { stdout: '', stderr: '', code: 0 };
    });
    mockCheckRateLimit.mockImplementation(() => {
      throw new ScanPausedError('Claude rate limit reached', '2026-07-02T20:00:00Z');
    });

    await expect(runClaudeWithTrace(baseOpts)).rejects.toBeInstanceOf(ScanPausedError);

    // Trace persisted WITH the original error message — not silently dropped.
    expect(addScanFileMock).toHaveBeenCalledTimes(1);
    const trace = addScanFileMock.mock.calls[0][0];
    expect(trace.content).toContain('trace_error');
    expect(trace.content).toContain('SSH inactivity timeout');
    // Partial stdout captured from the timeout error made it into the trace.
    expect(trace.content).toContain('"type":"partial"');

    // Cleanup still ran despite the ScanPausedError rethrow.
    const promptPath = mockSshWriteFile.mock.calls[0][1] as string;
    const rmCall = mockSshExec.mock.calls.find(c => String(c[1]) === `rm -f ${promptPath}`);
    expect(rmCall).toBeDefined();
  });
});
