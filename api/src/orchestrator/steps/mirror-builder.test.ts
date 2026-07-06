import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext } from '../pipeline-types.ts';

const { mockSshExec, mockGetClaudeRunnerConfig } = vi.hoisted(() => ({
  mockSshExec: vi.fn(),
  mockGetClaudeRunnerConfig: vi.fn().mockReturnValue({
    host: 'claude-runner', port: 22, username: 'scanner', privateKey: Buffer.from('fake'),
  }),
}));

vi.mock('../ssh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssh.ts')>();
  return {
    ...actual,
    sshExec: mockSshExec,
    getClaudeRunnerConfig: mockGetClaudeRunnerConfig,
  };
});

import { buildMirror } from './mirror-builder.ts';

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    scanId: 'scan-1',
    workDir: '/workspace/scan-1',
    repoPath: '/workspace/scan-1/repo',
    agentDir: '/workspace/scan-1',
    toolsDir: '/workspace/scan-1/results',
    resultsDir: '/workspace/scan-1/results',
    profilePath: '/workspace/scan-1/repo-profile.md',
    scanContextPath: '/workspace/scan-1/scan-context.md',
    // stubs
    repoUrl: '', repoName: '', branch: '', commitHash: '', localPath: '',
    teamName: '', workspaceName: '', workspaceId: 1, cloneUrl: '', reportLanguage: 'en',
    aiAnalysisEnabled: true, aiScanningEnabled: true, aiTriageEnabled: true,
    aiModelAnalyzer: 'sonnet', aiModelScanner: 'opus', aiModelTriage: 'opus',
    ...overrides,
  } as PipelineContext;
}

describe('buildMirror', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns mirror/metadata/repo paths (under agentDir) and file count', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '137\n', stderr: '', code: 0 });

    const info = await buildMirror(makeCtx());

    // Mirror lives under agentDir, which is scanner-writable
    expect(info.mirrorPath).toBe('/workspace/scan-1/mirror');
    expect(info.metadataPath).toBe('/workspace/scan-1/mirror/_metadata.jsonl');
    expect(info.repoPath).toBe('/workspace/scan-1/repo');
    expect(info.fileCount).toBe(137);
    expect(info.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('invokes python3 with repo and mirror paths', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '10\n', stderr: '', code: 0 });

    await buildMirror(makeCtx());

    const command = mockSshExec.mock.calls[0][1] as string;
    expect(command).toContain('python3');
    expect(command).toContain('/workspace/scan-1/repo');
    expect(command).toContain('/workspace/scan-1/mirror');
    expect(command).toContain('_metadata.jsonl');
    expect(command).toContain('MIDDLE');
    expect(command).toContain('sha256');
    expect(command).toContain('avg_line_length');
    expect(command).toContain('2 * 1024 * 1024'); // 2MB hard cap expression
    expect(command).toContain('[SKIPPED');
  });

  it('script excludes common non-source directories', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '0\n', stderr: '', code: 0 });

    await buildMirror(makeCtx());
    const command = mockSshExec.mock.calls[0][1] as string;

    for (const dir of ['node_modules', 'vendor', 'dist', 'build', '.git', '.venv', '__pycache__']) {
      expect(command).toContain(dir);
    }
  });

  it('threads ctx.cancelSignal into the sshExec options (cancellation must abort the remote build)', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '5\n', stderr: '', code: 0 });
    const controller = new AbortController();

    await buildMirror(makeCtx({ cancelSignal: controller.signal }));

    const options = mockSshExec.mock.calls[0][2] as Record<string, unknown>;
    expect(options.signal).toBe(controller.signal);
  });

  it('parses zero file count gracefully', async () => {
    mockSshExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });

    const info = await buildMirror(makeCtx());
    expect(info.fileCount).toBe(0);
  });

  it('throws with stderr tail when the mirror script exits non-zero (dead python3 must not yield fileCount=0)', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'bash: python3: command not found',
      code: 127,
    });

    const err = await buildMirror(makeCtx()).then(
      () => { throw new Error('expected buildMirror to throw'); },
      (e: unknown) => e as Error,
    );
    expect(err.message).toContain('exit 127');
    expect(err.message).toContain('python3: command not found');
  });
});
