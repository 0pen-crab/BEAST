import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/index.ts';

const mockDb = db as any;

vi.mock('./ssh.ts', () => ({
  sshExec: vi.fn(),
  getSecurityToolsConfig: vi.fn(() => ({ host: 'security-tools', port: 22, username: 'scanner', privateKey: Buffer.from('') })),
  getClaudeRunnerConfig: vi.fn(() => ({ host: 'claude-runner', port: 22, username: 'scanner', privateKey: Buffer.from('') })),
}));

vi.mock('./entities.ts', () => ({
  listWorkspaces: vi.fn(),
}));

import { sshExec } from './ssh.ts';
import { listWorkspaces } from './entities.ts';

const mockSshExec = vi.mocked(sshExec);
const mockListWorkspaces = vi.mocked(listWorkspaces);

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.insert?.mockClear?.();
  mockDb.values?.mockClear?.();
  mockSshExec.mockReset();
  mockListWorkspaces.mockReset();
});

describe('runInfraCheck', () => {
  it('writes no events when both probes succeed', async () => {
    mockSshExec.mockResolvedValue({ stdout: 'ok\n', stderr: '', code: 0 });
    mockListWorkspaces.mockResolvedValue([{ id: 1, name: 'ws' } as any]);

    const { runInfraCheck } = await import('./infra-check.ts');
    await runInfraCheck();

    expect(mockSshExec).toHaveBeenCalledTimes(2);
    // No insert because no failure
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('auto-resolves previous unresolved events for a target when probe succeeds', async () => {
    mockSshExec.mockResolvedValue({ stdout: 'ok\n', stderr: '', code: 0 });
    mockListWorkspaces.mockResolvedValue([{ id: 1, name: 'ws' } as any]);

    const { runInfraCheck } = await import('./infra-check.ts');
    await runInfraCheck();

    // db.update(scanEvents).set({ resolved: true, ... }).where(...) — once per target
    expect(mockDb.update).toHaveBeenCalledTimes(2);
    const setCalls = mockDb.set.mock.calls.map((c: any[]) => c[0]);
    for (const args of setCalls) {
      expect(args.resolved).toBe(true);
      expect(args.resolvedBy).toBe('infra-check-auto');
    }
  });

  it('writes one error event per workspace when SSH fails', async () => {
    mockSshExec.mockRejectedValue(new Error('All configured authentication methods failed'));
    mockListWorkspaces.mockResolvedValue([
      { id: 1, name: 'ws-a' } as any,
      { id: 7, name: 'ws-b' } as any,
    ]);

    const { runInfraCheck } = await import('./infra-check.ts');
    await runInfraCheck();

    // 2 targets × 2 workspaces = 4 inserted events
    expect(mockDb.insert).toHaveBeenCalledTimes(4);
    const valueCalls = mockDb.values.mock.calls.map((c: any[]) => c[0]);
    const targets = new Set(valueCalls.map((v: any) => v.details.target));
    expect(targets.has('security-tools')).toBe(true);
    expect(targets.has('claude-runner')).toBe(true);
    for (const v of valueCalls) {
      expect(v.level).toBe('error');
      expect(v.source).toBe('infra-check');
      expect(v.message).toContain('authentication methods failed');
    }
  });

  it('treats non-zero exit code as a failure', async () => {
    mockSshExec.mockResolvedValue({ stdout: '', stderr: 'permission denied', code: 255 });
    mockListWorkspaces.mockResolvedValue([{ id: 1, name: 'ws' } as any]);

    const { runInfraCheck } = await import('./infra-check.ts');
    await runInfraCheck();

    // 2 targets × 1 workspace = 2 events
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('logs to console but writes no events when there are no workspaces yet', async () => {
    mockSshExec.mockRejectedValue(new Error('connect ECONNREFUSED'));
    mockListWorkspaces.mockResolvedValue([]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { runInfraCheck } = await import('./infra-check.ts');
    await runInfraCheck();

    expect(mockDb.insert).not.toHaveBeenCalled();
    const logged = errSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('infra-check');
    expect(logged).toContain('ECONNREFUSED');
    errSpy.mockRestore();
  });
});

describe('hasOpenInfraIssues', () => {
  it('returns false when no unresolved infra events exist', async () => {
    mockDb.where.mockResolvedValueOnce([]);

    const { hasOpenInfraIssues } = await import('./infra-check.ts');
    const result = await hasOpenInfraIssues();
    expect(result).toEqual({ degraded: false, issues: [] });
  });

  it('returns issues when unresolved infra events exist', async () => {
    mockDb.where.mockResolvedValueOnce([
      { message: 'Cannot reach security-tools: auth failed', source: 'infra-check' },
    ]);

    const { hasOpenInfraIssues } = await import('./infra-check.ts');
    const result = await hasOpenInfraIssues();
    expect(result.degraded).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toContain('security-tools');
  });

  it('dedupes issues with identical messages across workspaces', async () => {
    mockDb.where.mockResolvedValueOnce([
      { message: 'Cannot reach security-tools: auth failed', source: 'infra-check' },
      { message: 'Cannot reach security-tools: auth failed', source: 'infra-check' },
      { message: 'Cannot reach security-tools: auth failed', source: 'infra-check' },
      { message: 'Cannot reach claude-runner: refused', source: 'infra-check' },
    ]);

    const { hasOpenInfraIssues } = await import('./infra-check.ts');
    const result = await hasOpenInfraIssues();
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map(i => i.message)).toEqual([
      'Cannot reach security-tools: auth failed',
      'Cannot reach claude-runner: refused',
    ]);
  });
});
