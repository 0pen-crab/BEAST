import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../db/index.ts';
import { tests, findings, contributorAssessments, scanEvents, scanSteps } from '../db/schema.ts';

// ── Shared mock setup (same pattern as entities.test.ts) ──────────

const mockDb = db as any;

function resetMockDb() {
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
  if (typeof mockDb.mockReset === 'function') mockDb.mockReset();
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetMockDb();
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

async function cleanup() {
  return import('./cleanup.ts');
}

// ── Mock helpers ─────────────────────────────────────────────────

/** Route db.select().from(table).where() to per-table results. */
function mockSelects(byTable: Array<[unknown, unknown[]]>) {
  const map = new Map(byTable);
  mockDb.select.mockImplementation(() => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn().mockResolvedValue(map.get(table) ?? []),
    })),
  }));
}

/**
 * Route db.delete(table).where().returning() to per-table results.
 * Returns the array of tables passed to delete(), in call order.
 */
function mockDeletes(byTable: Array<[unknown, unknown[]]>) {
  const map = new Map(byTable);
  const callOrder: unknown[] = [];
  mockDb.delete.mockImplementation((table: unknown) => {
    callOrder.push(table);
    return {
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(map.get(table) ?? []),
      }),
    };
  });
  return callOrder;
}

/** Mock db.update(...).set(...).where(...) and return the set() spy. */
function mockUpdateSetWhere() {
  const set = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
  mockDb.update.mockReturnValue({ set });
  return set;
}

/** Mock db.insert(...).values(...) and return the values() spy. */
function mockInsertValues() {
  const values = vi.fn().mockResolvedValue(undefined);
  mockDb.insert.mockReturnValue({ values });
  return values;
}

// ── cleanupFailedScanData ────────────────────────────────────────

describe('cleanupFailedScanData', () => {
  it('deletes findings before tests (FK-safe order), then assessments', async () => {
    mockSelects([
      [tests, [{ id: 1 }, { id: 2 }]],
      [findings, [{ id: 10 }, { id: 11 }, { id: 12 }]],
    ]);
    const deleteOrder = mockDeletes([
      [findings, [{ id: 10 }, { id: 11 }, { id: 12 }]],
      [tests, [{ id: 1 }, { id: 2 }]],
      [contributorAssessments, []],
    ]);
    mockUpdateSetWhere();
    mockInsertValues();

    const { cleanupFailedScanData } = await cleanup();
    const result = await cleanupFailedScanData('scan-1');

    expect(deleteOrder).toEqual([findings, tests, contributorAssessments]);
    expect(result).toEqual({
      findingsDeleted: 3,
      testsDeleted: 2,
      assessmentsDeleted: 0,
    });
  });

  it('detaches duplicate_of self-references before deleting findings', async () => {
    mockSelects([
      [tests, [{ id: 1 }]],
      [findings, [{ id: 10 }]],
    ]);
    mockDeletes([
      [findings, [{ id: 10 }]],
      [tests, [{ id: 1 }]],
      [contributorAssessments, []],
    ]);
    const set = mockUpdateSetWhere();
    mockInsertValues();

    const { cleanupFailedScanData } = await cleanup();
    await cleanupFailedScanData('scan-1');

    expect(mockDb.update).toHaveBeenCalledWith(findings);
    expect(set).toHaveBeenCalledWith({ duplicateOf: null });
  });

  it('deletes contributor assessments linked via execution_id even when the scan has no tests', async () => {
    mockSelects([[tests, []]]);
    const deleteOrder = mockDeletes([
      [contributorAssessments, [{ id: 5 }, { id: 6 }]],
    ]);
    mockInsertValues();

    const { cleanupFailedScanData } = await cleanup();
    const result = await cleanupFailedScanData('scan-1');

    // No tests → no findings/tests deletes; only assessments
    expect(deleteOrder).toEqual([contributorAssessments]);
    expect(result.assessmentsDeleted).toBe(2);
    expect(result.findingsDeleted).toBe(0);
    expect(result.testsDeleted).toBe(0);
  });

  it('writes a WARNING scan_event when the commit step had started (expected partial-commit cleanup)', async () => {
    mockSelects([
      [tests, [{ id: 1 }]],
      [findings, [{ id: 10 }, { id: 11 }]],
      // Commit step failed mid-way → the deleted rows are its expected leftovers
      [scanSteps, [{ status: 'failed' }]],
    ]);
    mockDeletes([
      [findings, [{ id: 10 }, { id: 11 }]],
      [tests, [{ id: 1 }]],
      [contributorAssessments, [{ id: 5 }]],
    ]);
    mockUpdateSetWhere();
    const values = mockInsertValues();

    const { cleanupFailedScanData } = await cleanup();
    await cleanupFailedScanData('scan-1', { repoName: 'repo', workspaceId: 7 });

    expect(mockDb.insert).toHaveBeenCalledWith(scanEvents);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      level: 'warning',
      source: 'cleanup',
      message: 'Removed results of failed scan (commit step had started): 2 findings, 1 tests, 1 assessments',
      details: expect.objectContaining({
        findingsDeleted: 2,
        testsDeleted: 1,
        assessmentsDeleted: 1,
        commitStarted: true,
      }),
      repoName: 'repo',
      workspaceId: 7,
    }));

    const logged = consoleLogSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(logged).toContain('2 findings, 1 tests, 1 assessments');
  });

  it('SCREAMS with an ERROR scan_event when data is deleted before the commit step ever ran (anomaly)', async () => {
    // Repo data exists but the commit step is still pending → a mid-scan
    // write bypassed the commit-only policy. That must be loudly visible.
    mockSelects([
      [tests, [{ id: 1 }]],
      [findings, [{ id: 10 }]],
      [scanSteps, [{ status: 'pending' }]],
    ]);
    mockDeletes([
      [findings, [{ id: 10 }]],
      [tests, [{ id: 1 }]],
      [contributorAssessments, []],
    ]);
    mockUpdateSetWhere();
    const values = mockInsertValues();

    const { cleanupFailedScanData } = await cleanup();
    await cleanupFailedScanData('scan-1', { repoName: 'repo', workspaceId: 7 });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      source: 'cleanup',
      message: expect.stringContaining('ANOMALY'),
      details: expect.objectContaining({ commitStarted: false }),
    }));

    const errLogged = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(errLogged).toContain('ANOMALY');
    expect(errLogged).toContain('mid-scan write');
  });

  it('treats a missing commit step row as an anomaly too', async () => {
    mockSelects([
      [tests, [{ id: 1 }]],
      [findings, [{ id: 10 }]],
      [scanSteps, []],
    ]);
    mockDeletes([
      [findings, [{ id: 10 }]],
      [tests, [{ id: 1 }]],
      [contributorAssessments, []],
    ]);
    mockUpdateSetWhere();
    const values = mockInsertValues();

    const { cleanupFailedScanData } = await cleanup();
    await cleanupFailedScanData('scan-1');

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      message: expect.stringContaining('ANOMALY'),
    }));
  });

  it('does not write a scan_event when there is nothing to delete', async () => {
    mockSelects([[tests, []]]);
    mockDeletes([[contributorAssessments, []]]);
    const values = mockInsertValues();

    const { cleanupFailedScanData } = await cleanup();
    const result = await cleanupFailedScanData('scan-1');

    expect(values).not.toHaveBeenCalled();
    expect(result).toEqual({
      findingsDeleted: 0,
      testsDeleted: 0,
      assessmentsDeleted: 0,
    });
  });

  it('swallows db failures, screams to console, and writes an error scan_event', async () => {
    mockDb.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockRejectedValue(new Error('connection refused')),
      })),
    }));
    const values = mockInsertValues();

    const { cleanupFailedScanData } = await cleanup();
    // Must NOT throw — cleanup failure must not mask the original scan error
    const result = await cleanupFailedScanData('scan-1', { repoName: 'repo', workspaceId: 7 });

    expect(result).toEqual({
      findingsDeleted: 0,
      testsDeleted: 0,
      assessmentsDeleted: 0,
    });

    const errLogged = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(errLogged).toContain('[cleanup]');
    expect(errLogged).toContain('connection refused');

    expect(mockDb.insert).toHaveBeenCalledWith(scanEvents);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      level: 'error',
      source: 'cleanup',
    }));
  });

  it('does not throw even when the error scan_event insert itself fails', async () => {
    mockDb.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockRejectedValue(new Error('db down')),
      })),
    }));
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error('db still down')),
    });

    const { cleanupFailedScanData } = await cleanup();
    await expect(cleanupFailedScanData('scan-1')).resolves.toEqual({
      findingsDeleted: 0,
      testsDeleted: 0,
      assessmentsDeleted: 0,
    });
  });
});
