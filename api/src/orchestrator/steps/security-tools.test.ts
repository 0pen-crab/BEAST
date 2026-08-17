import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineContext } from '../pipeline-types.ts';

const { mockSshExec, mockGetSecurityToolsConfig } = vi.hoisted(() => ({
  mockSshExec: vi.fn(),
  mockGetSecurityToolsConfig: vi.fn().mockReturnValue({
    host: 'security-tools',
    port: 22,
    username: 'scanner',
    privateKey: Buffer.from('fake-key'),
  }),
}));

vi.mock('../ssh.ts', () => ({
  sshExec: mockSshExec,
  getSecurityToolsConfig: mockGetSecurityToolsConfig,
}));

// ── fs mock ──────────────────────────────────────────────────────────
const mockWriteFileSync = vi.fn();
const mockChownSync = vi.fn();
vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  chownSync: (...args: unknown[]) => mockChownSync(...args),
}));

// ── Vault mock ──────────────────────────────────────────────────────
const mockGetSecret = vi.fn();
vi.mock('../../lib/vault.ts', () => ({
  getSecret: (...args: unknown[]) => mockGetSecret(...args),
}));

// ── Entity mock ─────────────────────────────────────────────────────
const mockGetWorkspaceTools = vi.fn();
vi.mock('../entities.ts', () => ({
  getWorkspaceTools: (...args: unknown[]) => mockGetWorkspaceTools(...args),
}));

// ── Pipeline mock (logScanEvent) ────────────────────────────────────
const mockLogScanEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../events.ts', () => ({
  logScanEvent: (...args: unknown[]) => mockLogScanEvent(...args),
}));

import { runSecurityTools, runSecToolsStep } from './security-tools.ts';
import type { SecurityToolsResult, ToolWarning } from './security-tools.ts';
import type { StepInput, ScanStepError } from '../pipeline-types.ts';

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

function makeStepInput(overrides: Partial<PipelineContext> = {}): StepInput {
  return { ctx: makeCtx(overrides), prev: {} };
}

/** All sshExec calls that ran run-scans.sh (skips env-file cleanup calls). */
function scanPassCalls(): any[][] {
  return mockSshExec.mock.calls.filter(c => String(c[1]).includes('run-scans.sh'));
}

describe('runSecurityTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecret.mockResolvedValue(null);
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitleaks', enabled: true },
      { toolKey: 'trufflehog', enabled: true },
    ]);
  });

  it('exports a callable function', () => {
    expect(typeof runSecurityTools).toBe('function');
  });

  it('returns summary and empty warnings on clean run (no retry pass)', async () => {
    const toolsOutput = {
      tools: {
        gitleaks: { status: 'success', findings: 0, exit_code: 0 },
        trufflehog: { status: 'success', findings: 2, exit_code: 0 },
      },
    };
    mockSshExec.mockResolvedValueOnce({
      stdout: `Running scans...\n${JSON.stringify(toolsOutput)}`,
      stderr: '',
      code: 0,
    });

    const result: SecurityToolsResult = await runSecurityTools(makeCtx());

    expect(result.summary).toEqual(toolsOutput.tools);
    expect(result.warnings).toHaveLength(0);
    expect(result.retriedTools).toEqual([]);
    // No second run-scans.sh pass when nothing failed
    expect(scanPassCalls()).toHaveLength(1);
  });

  // ── Retry pass ──────────────────────────────────────────────

  it('retries ONLY the failed tools in a second run-scans.sh pass', async () => {
    mockSshExec
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          tools: {
            gitleaks: { status: 'success', exit_code: 0 },
            trufflehog: { status: 'failed', exit_code: 1, error: 'network timeout' },
          },
        }),
        stderr: '', code: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          tools: {
            gitleaks: { status: 'skipped' },
            trufflehog: { status: 'success', exit_code: 0 },
          },
        }),
        stderr: '', code: 0,
      });

    const result = await runSecurityTools(makeCtx());

    const passes = scanPassCalls();
    expect(passes).toHaveLength(2);
    // Second pass carries ONLY the failed tool key
    expect(String(passes[1][1])).toContain('"trufflehog"');
    expect(String(passes[1][1])).not.toContain('gitleaks');

    // Merge: retry success replaces the failed first-pass entry
    expect((result.summary as any).trufflehog.status).toBe('success');
    expect((result.summary as any).gitleaks.status).toBe('success'); // first pass kept
    expect(result.warnings.filter(w => w.level === 'warning')).toHaveLength(0);
    expect(result.retriedTools).toEqual(['trufflehog']);
  });

  it('keeps the tool failed after a failed retry WITHOUT a duplicate warning entry', async () => {
    mockSshExec
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          tools: { trufflehog: { status: 'failed', exit_code: 1, error: 'config missing' } },
        }),
        stderr: '', code: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          tools: { trufflehog: { status: 'failed', exit_code: 1, error: 'config missing' } },
        }),
        stderr: '', code: 0,
      });

    const result = await runSecurityTools(makeCtx());

    // The failure surfaces exactly once — as the 'error' scan event emitted by
    // runSecToolsStep (plus toolErrors). A parallel 'warning' entry here used to
    // double-log the same incident in the Events tab.
    expect(result.warnings).toHaveLength(0);
    expect((result.summary.trufflehog as Record<string, unknown>).status).toBe('failed');
    expect(result.retriedTools).toContain('trufflehog');
  });

  it('maps the jf-audit summary key back to the jfrog tool key for the retry pass', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'jfrog', enabled: true },
    ]);
    mockSshExec
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          tools: { 'jf-audit': { status: 'failed', exit_code: 2, error: '403 forbidden' } },
        }),
        stderr: '', code: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          tools: { 'jf-audit': { status: 'success', exit_code: 0 } },
        }),
        stderr: '', code: 0,
      });

    const result = await runSecurityTools(makeCtx());

    const passes = scanPassCalls();
    expect(passes).toHaveLength(2);
    // is_enabled() in run-scans.sh checks 'jfrog', not the 'jf-audit' summary key
    expect(String(passes[1][1])).toContain('"jfrog"');
    expect((result.summary as any)['jf-audit'].status).toBe('success');
  });

  it('keeps first-pass results and does NOT throw when the retry pass itself crashes', async () => {
    mockSshExec
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          tools: {
            gitleaks: { status: 'success', exit_code: 0 },
            trufflehog: { status: 'failed', exit_code: 1, error: 'oom' },
          },
        }),
        stderr: '', code: 0,
      })
      .mockRejectedValueOnce(new Error('ssh connection lost'));

    const result = await runSecurityTools(makeCtx());

    expect((result.summary as any).trufflehog.status).toBe('failed');
    expect((result.summary as any).gitleaks.status).toBe('success');
    // Retry crash is surfaced as a warning event, not a scan failure
    const warnEvents = mockLogScanEvent.mock.calls.filter(c => c[2] === 'warning');
    expect(warnEvents.some(c => String(c[3]).includes('retry pass failed'))).toBe(true);
  });

  it('keeps first-pass results when the retry pass summary is unparseable (no scan failure)', async () => {
    mockSshExec
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          tools: { trufflehog: { status: 'failed', exit_code: 1, error: 'boom' } },
        }),
        stderr: '', code: 0,
      })
      .mockResolvedValueOnce({ stdout: 'garbage output no json', stderr: '', code: 0 });

    const result = await runSecurityTools(makeCtx());
    expect((result.summary as any).trufflehog.status).toBe('failed');
    // The initial-pass "results are lost, failing the scan" error event must NOT fire
    const errorEvents = mockLogScanEvent.mock.calls.filter(c => c[2] === 'error');
    expect(errorEvents).toHaveLength(0);
  });

  it('logs an info event announcing the retry pass', async () => {
    mockSshExec
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          tools: { trufflehog: { status: 'failed', exit_code: 1, error: 'x' } },
        }),
        stderr: '', code: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ tools: { trufflehog: { status: 'success', exit_code: 0 } } }),
        stderr: '', code: 0,
      });

    await runSecurityTools(makeCtx());

    const infoEvents = mockLogScanEvent.mock.calls.filter(c => c[2] === 'info');
    expect(infoEvents.some(c => String(c[3]).includes('Retrying failed security tools'))).toBe(true);
    expect(infoEvents.some(c => String(c[3]).includes('succeeded on retry'))).toBe(true);
  });

  it('recreates the credentials env file for the retry pass (run-scans.sh deletes it each run)', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitguardian', enabled: true },
    ]);
    mockGetSecret.mockResolvedValue('my-api-key');
    mockSshExec.mockImplementation(async (_cfg: unknown, cmd: string) => {
      if (String(cmd).startsWith('rm -f')) return { stdout: '', stderr: '', code: 0 };
      // Both passes report gitguardian failed
      return {
        stdout: JSON.stringify({ tools: { gitguardian: { status: 'failed', exit_code: 1, error: 'x' } } }),
        stderr: '', code: 0,
      };
    });

    await runSecurityTools(makeCtx());

    // Env file written once per pass
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    // And best-effort deleted after each pass
    const rmCalls = mockSshExec.mock.calls.filter(c => String(c[1]).startsWith('rm -f'));
    expect(rmCalls).toHaveLength(2);
  });

  // ── Unchanged hard-failure behavior (first pass) ─────────────

  it('generates info warnings for skipped tools', async () => {
    const toolsOutput = {
      tools: { xray: { status: 'skipped', error: 'not configured' } },
    };
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify(toolsOutput),
      stderr: '',
      code: 0,
    });

    const result = await runSecurityTools(makeCtx());
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].level).toBe('info');
    // Skipped is not failed — no retry pass
    expect(scanPassCalls()).toHaveLength(1);
  });

  it('throws when security tools fail with non-zero exit code', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'container not running',
      code: 255,
    });

    await expect(runSecurityTools(makeCtx())).rejects.toThrow('Security tools failed');
  });

  // An unparseable FIRST-pass summary means every tool result is lost — the
  // step must THROW (failing the scan), never continue with 0 findings.
  it('throws when the initial summary line is unparseable', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: 'some non-json output\nwithout valid json',
      stderr: '',
      code: 0,
    });

    await expect(runSecurityTools(makeCtx())).rejects.toThrow(/summary unparseable/i);
  });

  it('logs an error scan event before throwing when the initial summary line is unparseable', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: 'some non-json output\nwithout valid json trailing tail',
      stderr: '',
      code: 0,
    });

    await expect(runSecurityTools(makeCtx())).rejects.toThrow();

    expect(mockLogScanEvent).toHaveBeenCalledTimes(1);
    const [scanId, stepName, level, message, details] = mockLogScanEvent.mock.calls[0];
    expect(scanId).toBe('scan-1');
    expect(stepName).toBe('security-tools');
    expect(level).toBe('error');
    expect(message.toLowerCase()).toContain('unparseable');
    // Raw tail of stdout must be attached so the failure is debuggable
    expect(JSON.stringify(details)).toContain('without valid json trailing tail');
  });

  it('does NOT log a parse-error event when the summary parses fine', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    await runSecurityTools(makeCtx());
    expect(mockLogScanEvent).not.toHaveBeenCalled();
  });

  it('runs the scan command with inactivity + max timeouts (no hung-tool forever-scan)', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    await runSecurityTools(makeCtx());

    const options = mockSshExec.mock.calls[0][2];
    expect(options).toMatchObject({
      // Inactivity 60 min: trivy re-downloads its ~99 MiB vuln DB through the
      // throttled proxy with no stdout — 10 min killed the step mid-fetch.
      inactivityTimeoutMs: 60 * 60_000,
      maxTimeoutMs: 120 * 60_000,
    });
  });

  it('uses security-tools SSH config, not claude-runner', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    await runSecurityTools(makeCtx());
    expect(mockGetSecurityToolsConfig).toHaveBeenCalled();
    const config = mockSshExec.mock.calls[0][0];
    expect(config.host).toBe('security-tools');
  });

  // ── Workspace tools integration ──────────────────────────────
  it('passes enabled tools list in command', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitleaks', enabled: true },
      { toolKey: 'trivy-secrets', enabled: true },
      { toolKey: 'trufflehog', enabled: false },
    ]);
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    await runSecurityTools(makeCtx());
    const command = mockSshExec.mock.calls[0][1];
    expect(command).toContain('gitleaks,trivy-secrets');
    expect(command).not.toContain('trufflehog');
  });

  it('returns early when no tools enabled', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitleaks', enabled: false },
    ]);

    const result = await runSecurityTools(makeCtx());
    expect(result.summary).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].level).toBe('info');
    expect(result.warnings[0].tool).toBe('all');
    expect(mockSshExec).not.toHaveBeenCalled();
  });

  it('writes env file via fs.writeFileSync to toolsDir when credentials exist', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitguardian', enabled: true },
    ]);
    mockGetSecret.mockResolvedValue('my-api-key');
    mockSshExec.mockResolvedValue({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    const ctx = makeCtx({ toolsDir: '/workspace/repo/results' });
    await runSecurityTools(ctx);

    expect(mockWriteFileSync).toHaveBeenCalled();
    const [filePath, envContent] = mockWriteFileSync.mock.calls[0];
    expect(filePath).toBe('/workspace/repo/results/.beast-env');
    expect(envContent).toContain('GITGUARDIAN_API_KEY');
    expect(envContent).toContain('my-api-key');
  });

  it('writes the env file with owner-only permissions (0600)', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitguardian', enabled: true },
    ]);
    mockGetSecret.mockResolvedValue('my-api-key');
    mockSshExec.mockResolvedValue({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    await runSecurityTools(makeCtx());

    const writeOptions = mockWriteFileSync.mock.calls[0][2];
    expect(writeOptions).toMatchObject({ mode: 0o600 });
  });

  // The worker writes the env file as root, but run-scans.sh sources it over
  // SSH as the `scanner` user — without a chown the whole tools step dies with
  // "Permission denied" (caught live on the first post-0600 scan).
  it('chowns the env file to the scanner user so run-scans.sh can source it', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitguardian', enabled: true },
    ]);
    mockGetSecret.mockResolvedValue('my-api-key');
    mockSshExec.mockResolvedValue({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    await runSecurityTools(makeCtx());

    const [envPath] = mockWriteFileSync.mock.calls[0];
    expect(mockChownSync).toHaveBeenCalledWith(envPath, 1001, 1001);
  });

  it('best-effort deletes the env file over SSH after the scan (success path)', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitguardian', enabled: true },
    ]);
    mockGetSecret.mockResolvedValue('my-api-key');
    mockSshExec.mockResolvedValue({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    await runSecurityTools(makeCtx());

    expect(mockSshExec).toHaveBeenCalledTimes(2);
    const cleanupCmd = mockSshExec.mock.calls[1][1] as string;
    expect(cleanupCmd).toContain('rm -f');
    expect(cleanupCmd).toContain('/workspace/repo/results/.beast-env');
  });

  it('deletes the env file even when the scan command fails (early-failure leak)', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitguardian', enabled: true },
    ]);
    mockGetSecret.mockResolvedValue('my-api-key');
    // First call = scan (rejects mid-flight), second call = cleanup
    mockSshExec
      .mockRejectedValueOnce(new Error('ssh connection lost'))
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });

    await expect(runSecurityTools(makeCtx())).rejects.toThrow('ssh connection lost');

    expect(mockSshExec).toHaveBeenCalledTimes(2);
    const cleanupCmd = mockSshExec.mock.calls[1][1] as string;
    expect(cleanupCmd).toContain('rm -f');
    expect(cleanupCmd).toContain('.beast-env');
  });

  it('does not attempt env-file cleanup when no env file was written', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitleaks', enabled: true },
    ]);
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    await runSecurityTools(makeCtx());
    expect(mockSshExec).toHaveBeenCalledTimes(1);
  });

  it('swallows cleanup failures (cleanup is best-effort, scan result wins)', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitguardian', enabled: true },
    ]);
    mockGetSecret.mockResolvedValue('my-api-key');
    mockSshExec
      .mockResolvedValueOnce({ stdout: JSON.stringify({ tools: {} }), stderr: '', code: 0 })
      .mockRejectedValueOnce(new Error('cleanup ssh failed'));

    const result = await runSecurityTools(makeCtx());
    expect(result.summary).toEqual({});
  });

  it('does not write env file when no credentials needed', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitleaks', enabled: true },
    ]);
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    await runSecurityTools(makeCtx());
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('uses toolsDir/.beast-env as env file path in SSH command', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitguardian', enabled: true },
    ]);
    mockGetSecret.mockResolvedValue('my-api-key');
    mockSshExec.mockResolvedValue({
      stdout: JSON.stringify({ tools: {} }),
      stderr: '',
      code: 0,
    });

    const ctx = makeCtx({ toolsDir: '/workspace/repo/results' });
    await runSecurityTools(ctx);

    const command = mockSshExec.mock.calls[0][1];
    expect(command).toContain('/workspace/repo/results/.beast-env');
  });
});

describe('runSecToolsStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecret.mockResolvedValue(null);
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitleaks', enabled: true },
    ]);
  });

  it('exports a callable function', () => {
    expect(typeof runSecToolsStep).toBe('function');
  });

  it('returns SecurityToolsOutput shape with toolResults and totalDurationMs', async () => {
    const toolsOutput = {
      tools: {
        gitleaks: { status: 'success', duration_ms: 1200, findings_count: 3 },
      },
    };
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify(toolsOutput),
      stderr: '',
      code: 0,
    });

    const result = await runSecToolsStep(makeStepInput());

    expect(result).toHaveProperty('toolResults');
    expect(result).toHaveProperty('totalDurationMs');
    expect(typeof result.totalDurationMs).toBe('number');
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('maps tool summary to ToolResult entries with correct status (success + skipped)', async () => {
    const toolsOutput = {
      tools: {
        gitleaks: { status: 'success', duration_ms: 500, findings_count: 2 },
        semgrep: { status: 'skipped', duration_ms: 0, findings_count: 0 },
      },
    };
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitleaks', enabled: true },
      { toolKey: 'semgrep', enabled: true },
    ]);
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify(toolsOutput),
      stderr: '',
      code: 0,
    });

    const result = await runSecToolsStep(makeStepInput());

    expect(result.toolResults.gitleaks).toEqual({
      status: 'success',
      durationMs: 500,
      findingsCount: 2,
      error: undefined,
    });
    expect(result.toolResults.semgrep).toEqual({
      status: 'skipped',
      durationMs: 0,
      findingsCount: 0,
      error: undefined,
    });
  });

  // Maintainer policy (supersedes "failed tool → failed scan"): a tool that
  // stays failed after its retry becomes a structured step error; the step
  // does NOT throw and the scan completes "with errors".
  it('does NOT throw for a tool that failed after retry — reports it in toolErrors', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitleaks', enabled: true },
      { toolKey: 'trufflehog', enabled: true },
    ]);
    const failedSummary = {
      tools: {
        gitleaks: { status: 'success', duration_ms: 500, findings_count: 2 },
        trufflehog: { status: 'failed', duration_ms: 100, findings_count: 0, error: 'timeout' },
      },
    };
    // Both passes: trufflehog stays failed
    mockSshExec
      .mockResolvedValueOnce({ stdout: JSON.stringify(failedSummary), stderr: '', code: 0 })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ tools: { trufflehog: { status: 'failed', duration_ms: 90, findings_count: 0, error: 'timeout' } } }),
        stderr: '', code: 0,
      });

    const result = await runSecToolsStep(makeStepInput());

    expect(result.toolResults.trufflehog.status).toBe('failed');
    const errors = result.toolErrors as ScanStepError[];
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      kind: 'tool',
      name: 'trufflehog',
      failedAfterRetry: true,
    });
    expect(errors[0].error).toContain('timeout');

    // Still surfaced loudly in the Events tab — but exactly once (error level,
    // no parallel warning-level duplicate for the same incident)
    const failEvents = mockLogScanEvent.mock.calls.filter(c => c[2] === 'error');
    expect(failEvents).toHaveLength(1);
    expect(failEvents[0][3]).toContain('trufflehog failed after retry: timeout');
    const warnings = result.toolWarnings as ToolWarning[];
    expect(warnings.filter(w => w.tool === 'trufflehog')).toHaveLength(0);
  });

  it('does not include toolErrors when the retry rescued the tool', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'trufflehog', enabled: true },
    ]);
    mockSshExec
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ tools: { trufflehog: { status: 'failed', error: 'flaky' } } }),
        stderr: '', code: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ tools: { trufflehog: { status: 'success', duration_ms: 42, findings_count: 1 } } }),
        stderr: '', code: 0,
      });

    const result = await runSecToolsStep(makeStepInput());
    expect(result.toolResults.trufflehog.status).toBe('success');
    expect(result.toolErrors).toBeUndefined();
  });

  it('treats non-success, non-skipped status as failed (structured error, no throw)', async () => {
    mockSshExec
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ tools: { gitleaks: { status: 'error', duration_ms: 0, findings_count: 0, error: 'crash' } } }),
        stderr: '', code: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ tools: { gitleaks: { status: 'error', duration_ms: 0, findings_count: 0, error: 'crash' } } }),
        stderr: '', code: 0,
      });

    const result = await runSecToolsStep(makeStepInput());
    expect(result.toolResults.gitleaks.status).toBe('failed');
    const errors = result.toolErrors as ScanStepError[];
    expect(errors).toHaveLength(1);
    expect(errors[0].name).toBe('gitleaks');
    expect(errors[0].error).toContain('crash');
  });

  it('defaults durationMs and findingsCount to 0 when missing', async () => {
    const toolsOutput = {
      tools: {
        gitleaks: { status: 'success' },
      },
    };
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify(toolsOutput),
      stderr: '',
      code: 0,
    });

    const result = await runSecToolsStep(makeStepInput());
    expect(result.toolResults.gitleaks.durationMs).toBe(0);
    expect(result.toolResults.gitleaks.findingsCount).toBe(0);
  });

  it('includes toolWarnings in output for pipeline logging (skipped tools)', async () => {
    const toolsOutput = {
      tools: {
        gitleaks: { status: 'skipped', exit_code: 0, error: 'not configured' },
      },
    };
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify(toolsOutput),
      stderr: '',
      code: 0,
    });

    const result = await runSecToolsStep(makeStepInput());
    expect(result).toHaveProperty('toolWarnings');
    const warnings = result.toolWarnings as unknown[];
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('returns empty toolResults when no tools enabled', async () => {
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitleaks', enabled: false },
    ]);

    const result = await runSecToolsStep(makeStepInput());
    expect(result.toolResults).toEqual({});
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(mockSshExec).not.toHaveBeenCalled();
  });

  it('propagates errors from runSecurityTools', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'fatal error',
      code: 1,
    });

    await expect(runSecToolsStep(makeStepInput())).rejects.toThrow('Security tools failed');
  });

  it('totalDurationMs reflects wall-clock time of the step', async () => {
    mockSshExec.mockImplementationOnce(async () => {
      await new Promise(r => setTimeout(r, 10));
      return { stdout: JSON.stringify({ tools: {} }), stderr: '', code: 0 };
    });

    const result = await runSecToolsStep(makeStepInput());
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(10);
  });
});
