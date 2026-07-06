import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/index.ts';

const mockDb = db as any;

vi.mock('../../orchestrator/infra-check.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../orchestrator/infra-check.ts')>();
  return {
    ...actual, // keep the real infraTargetFromMessage
    hasOpenInfraIssues: vi.fn(),
  };
});

import { hasOpenInfraIssues } from '../../orchestrator/infra-check.ts';
import { checkAllSystems, WORKER_HEARTBEAT_STALE_MS } from './checks.ts';

const mockInfra = vi.mocked(hasOpenInfraIssues);

function mockHeartbeat(beatAt: Date | null) {
  // checks.ts reads the heartbeat via db.select(...).from(...).where(...)
  mockDb.where.mockResolvedValueOnce(beatAt ? [{ beatAt }] : []);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockResolvedValue([{ '?column?': 1 }]);
  mockInfra.mockResolvedValue({ degraded: false, issues: [] });
});

describe('checkAllSystems', () => {
  it('returns ok when every system is healthy', async () => {
    mockHeartbeat(new Date());

    const result = await checkAllSystems();
    expect(result).toEqual({ status: 'ok', failures: [] });
  });

  it('returns down with a db failure when SELECT 1 fails', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    const result = await checkAllSystems();
    expect(result.status).toBe('down');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].system).toBe('db');
    expect(result.failures[0].message).toContain('Database is unreachable');
    expect(result.failures[0].message).toContain('ECONNREFUSED');
  });

  it('does not run dependent checks when the db is down', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('down'));

    await checkAllSystems();
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockInfra).not.toHaveBeenCalled();
  });

  it('reports the worker down when no heartbeat row exists', async () => {
    mockHeartbeat(null);

    const result = await checkAllSystems();
    expect(result.status).toBe('degraded');
    expect(result.failures).toEqual([
      { system: 'worker', message: expect.stringContaining('never reported a heartbeat') },
    ]);
  });

  it('reports the worker down when the heartbeat is older than the staleness threshold', async () => {
    const stale = new Date(Date.now() - WORKER_HEARTBEAT_STALE_MS - 1000);
    mockHeartbeat(stale);

    const result = await checkAllSystems();
    expect(result.status).toBe('degraded');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].system).toBe('worker');
    expect(result.failures[0].message).toContain('stale');
    expect(result.failures[0].message).toContain(stale.toISOString());
  });

  it('accepts a heartbeat within the staleness threshold', async () => {
    mockHeartbeat(new Date(Date.now() - WORKER_HEARTBEAT_STALE_MS + 30_000));

    const result = await checkAllSystems();
    expect(result.status).toBe('ok');
  });

  it('reports the worker when the heartbeat table cannot be read', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('relation "worker_heartbeat" does not exist'));

    const result = await checkAllSystems();
    expect(result.status).toBe('degraded');
    expect(result.failures[0].system).toBe('worker');
    expect(result.failures[0].message).toContain('could not be read');
  });

  it('maps persisted infra-check issues to claude-runner / security-tools failures', async () => {
    mockHeartbeat(new Date());
    mockInfra.mockResolvedValue({
      degraded: true,
      issues: [
        { message: 'Cannot reach security-tools: All configured authentication methods failed', source: 'infra-check' },
        { message: 'Cannot reach claude-runner: connect ECONNREFUSED', source: 'infra-check' },
      ],
    });

    const result = await checkAllSystems();
    expect(result.status).toBe('degraded');
    expect(result.failures).toEqual([
      { system: 'security-tools', message: 'Cannot reach security-tools: All configured authentication methods failed' },
      { system: 'claude-runner', message: 'Cannot reach claude-runner: connect ECONNREFUSED' },
    ]);
  });

  it('collects failures from multiple systems at once', async () => {
    mockHeartbeat(null);
    mockInfra.mockResolvedValue({
      degraded: true,
      issues: [{ message: 'Cannot reach claude-runner: timeout', source: 'infra-check' }],
    });

    const result = await checkAllSystems();
    expect(result.status).toBe('degraded');
    expect(result.failures.map(f => f.system)).toEqual(['worker', 'claude-runner']);
  });

  it('ignores a transient infra status query failure (db already proven up)', async () => {
    mockHeartbeat(new Date());
    mockInfra.mockRejectedValue(new Error('query exploded'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await checkAllSystems();
    expect(result.status).toBe('ok');
    expect(result.failures).toEqual([]);
    errSpy.mockRestore();
  });
});
