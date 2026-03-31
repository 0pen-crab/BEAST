import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/index.ts';
import { createScan, getScan, listScans, updateScan } from './db.ts';

const mockDb = db as any;

beforeEach(() => {
  // Reset all mock functions on the chainable db mock
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      // Re-chain: each method returns mockDb by default
      mockDb[key].mockReturnValue(mockDb);
    }
  }
  // Reset the top-level mock too
  if (typeof mockDb.mockReset === 'function') mockDb.mockReset();
});

// ── Module exports ──────────────────────────────────────────────────

describe('db module exports', () => {
  it('exports createScan function', async () => {
    const mod = await import('./db.ts');
    expect(typeof mod.createScan).toBe('function');
  });

  it('exports getScan function', async () => {
    const mod = await import('./db.ts');
    expect(typeof mod.getScan).toBe('function');
  });

  it('exports listScans function', async () => {
    const mod = await import('./db.ts');
    expect(typeof mod.listScans).toBe('function');
  });

  it('exports updateScan function', async () => {
    const mod = await import('./db.ts');
    expect(typeof mod.updateScan).toBe('function');
  });
});

// ── createScan ──────────────────────────────────────────────────────

describe('createScan', () => {
  it('inserts a scan and returns the row', async () => {
    const row = { id: 'scan-1', repoName: 'my-repo', status: 'queued' };
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    });

    const result = await createScan({ repoName: 'my-repo' });

    expect(result).toEqual(row);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('passes all fields when provided', async () => {
    const row = { id: 'scan-2' };
    const valuesFn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([row]),
    });
    mockDb.insert.mockReturnValue({ values: valuesFn });

    await createScan({
      repoUrl: 'https://github.com/org/repo',
      repoName: 'repo',
      branch: 'main',
      commitHash: 'abc123',
      localPath: '/tmp/repo',
      workspaceId: 5,
    });

    expect(valuesFn).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/org/repo',
      repoName: 'repo',
      branch: 'main',
      commitHash: 'abc123',
      localPath: '/tmp/repo',
      workspaceId: 5,
      repositoryId: null,
      pullRequestId: null,
      scanType: 'full',
    });
  });
});

// ── getScan ─────────────────────────────────────────────────────────

describe('getScan', () => {
  it('returns scan row when found', async () => {
    const row = { id: 'scan-1', status: 'running' };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([row]),
      }),
    });

    const result = await getScan('scan-1');
    expect(result).toEqual(row);
  });

  it('returns null when scan not found', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await getScan('nonexistent');
    expect(result).toBeNull();
  });
});

// ── listScans ───────────────────────────────────────────────────────

describe('listScans', () => {
  function setupListMock(countVal: number, rows: unknown[]) {
    // First db.select() call → count query
    // Second db.select() call → data query
    let callNum = 0;
    mockDb.select.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        // count query chain
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: countVal }]),
          }),
        };
      }
      // data query chain
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(rows),
              }),
            }),
          }),
        }),
      };
    });
  }

  it('returns count and results with default limit/offset', async () => {
    setupListMock(3, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    const result = await listScans();
    expect(result.count).toBe(3);
    expect(result.results).toHaveLength(3);
  });

  it('returns filtered results when workspaceId provided', async () => {
    setupListMock(1, [{ id: 'a' }]);

    const result = await listScans(20, 0, 42);
    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it('returns filtered results when status provided', async () => {
    setupListMock(1, [{ id: 'a' }]);

    const result = await listScans(20, 0, undefined, 'running');
    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it('combines workspace_id and status filters', async () => {
    setupListMock(0, []);

    const result = await listScans(10, 5, 42, 'completed');
    expect(result.count).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

// ── updateScan ──────────────────────────────────────────────────────

describe('updateScan', () => {
  it('updates scan with provided fields', async () => {
    const row = { id: 'scan-1', status: 'running' };
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([row]),
        }),
      }),
    });

    const result = await updateScan('scan-1', { status: 'running' });
    expect(result).toEqual(row);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('skips undefined values in updates', async () => {
    const row = { id: 'scan-1' };
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    });
    mockDb.update.mockReturnValue({ set: setFn });

    await updateScan('scan-1', { status: 'completed', error: undefined });

    expect(setFn).toHaveBeenCalledWith({ status: 'completed' });
  });
});
