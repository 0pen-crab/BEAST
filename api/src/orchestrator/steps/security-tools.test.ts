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
vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
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

import { runSecurityTools, runSecToolsStep } from './security-tools.ts';
import type { SecurityToolsResult, ToolWarning } from './security-tools.ts';
import type { StepInput } from '../pipeline-types.ts';

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
    ...overrides,
  } as PipelineContext;
}

function makeStepInput(overrides: Partial<PipelineContext> = {}): StepInput {
  return { ctx: makeCtx(overrides), prev: {} };
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

  it('returns summary and empty warnings on clean run', async () => {
    const toolsOutput = {
      tools: {
        gitleaks: { status: 'completed', findings: 0, exit_code: 0 },
        trufflehog: { status: 'completed', findings: 2, exit_code: 0 },
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
    expect(mockSshExec.mock.calls[0][1]).toContain('run-scans.sh');
  });

  it('generates warnings for failed tools', async () => {
    const toolsOutput = {
      tools: {
        gitleaks: { status: 'completed', findings: 0, exit_code: 0 },
        trufflehog: { status: 'failed', exit_code: 1, error: 'config missing' },
      },
    };
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify(toolsOutput),
      stderr: '',
      code: 0,
    });

    const result = await runSecurityTools(makeCtx());
    expect(result.warnings).toHaveLength(1);
    const w: ToolWarning = result.warnings[0];
    expect(w.tool).toBe('trufflehog');
    expect(w.level).toBe('warning');
    expect(w.message).toContain('failed');
  });

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
  });

  it('throws when security tools fail with non-zero exit code', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'container not running',
      code: 255,
    });

    await expect(runSecurityTools(makeCtx())).rejects.toThrow('Security tools failed');
  });

  it('handles unparseable stdout gracefully', async () => {
    mockSshExec.mockResolvedValueOnce({
      stdout: 'some non-json output\nwithout valid json',
      stderr: '',
      code: 0,
    });

    const result = await runSecurityTools(makeCtx());
    expect(result.warnings).toHaveLength(0);
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
    mockSshExec.mockResolvedValueOnce({
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
    mockSshExec.mockResolvedValueOnce({
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

  it('maps tool summary to ToolResult entries with correct status', async () => {
    const toolsOutput = {
      tools: {
        gitleaks: { status: 'success', duration_ms: 500, findings_count: 2 },
        trufflehog: { status: 'failed', duration_ms: 100, findings_count: 0, error: 'timeout' },
        semgrep: { status: 'skipped', duration_ms: 0, findings_count: 0 },
      },
    };
    mockGetWorkspaceTools.mockResolvedValue([
      { toolKey: 'gitleaks', enabled: true },
      { toolKey: 'trufflehog', enabled: true },
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
    expect(result.toolResults.trufflehog).toEqual({
      status: 'failed',
      durationMs: 100,
      findingsCount: 0,
      error: 'timeout',
    });
    expect(result.toolResults.semgrep).toEqual({
      status: 'skipped',
      durationMs: 0,
      findingsCount: 0,
      error: undefined,
    });
  });

  it('maps non-success, non-skipped status to failed', async () => {
    const toolsOutput = {
      tools: {
        gitleaks: { status: 'error', duration_ms: 0, findings_count: 0, error: 'crash' },
      },
    };
    mockSshExec.mockResolvedValueOnce({
      stdout: JSON.stringify(toolsOutput),
      stderr: '',
      code: 0,
    });

    const result = await runSecToolsStep(makeStepInput());
    expect(result.toolResults.gitleaks.status).toBe('failed');
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

  it('includes toolWarnings in output for pipeline logging', async () => {
    const toolsOutput = {
      tools: {
        gitleaks: { status: 'failed', exit_code: 1, error: 'OOM' },
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
