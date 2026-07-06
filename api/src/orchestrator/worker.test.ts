import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/index.ts';
import { ScanPausedError } from './rate-limit.ts';

const mockDb = db as any;

const { mockRunPipeline, mockFetch, mockCleanupFailedScanData } = vi.hoisted(() => ({
  mockRunPipeline: vi.fn(),
  mockFetch: vi.fn(),
  mockCleanupFailedScanData: vi.fn(),
}));

vi.mock('./pipeline.ts', () => ({
  runPipeline: mockRunPipeline,
}));

vi.mock('./cleanup.ts', () => ({
  cleanupFailedScanData: mockCleanupFailedScanData,
}));

vi.stubGlobal('fetch', mockFetch);

function resetDbMock() {
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
  // The shared setup mock only stubs common Drizzle chain methods; transaction
  // isn't one of them. Add it on demand for worker tests.
  if (!mockDb.transaction || typeof mockDb.transaction.mockImplementation !== 'function') {
    mockDb.transaction = vi.fn();
  } else {
    mockDb.transaction.mockReset();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMock();
  // Default: worker is not paused
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ paused: false }),
  });
  // Default: cleanup succeeds and reports nothing deleted
  mockCleanupFailedScanData.mockResolvedValue({
    findingsDeleted: 0,
    testsDeleted: 0,
    assessmentsDeleted: 0,
  });
});

async function loadWorker() {
  return import('./worker.ts');
}

function makeScan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scan-1',
    status: 'queued',
    repoUrl: 'https://github.com/org/repo.git',
    repoName: 'repo',
    branch: 'main',
    commitHash: 'abc',
    localPath: null,
    repositoryId: 5,
    workspaceId: 1,
    scanType: 'full',
    metadata: {},
    error: null,
    durationMs: null,
    resumesAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// Arguments passed to tx.update().set() during the claim transaction — the
// COALESCE-startedAt test inspects these.
let txSetCalls: any[] = [];

function setupTransactionWithScan(scan: any) {
  // Pipeline: db.transaction(callback) — execute callback with a tx that mocks
  // execute() to return [{id: scan.id}] then update().set().where().returning() returns [scan].
  txSetCalls = [];
  mockDb.transaction.mockImplementation(async (cb: any) => {
    const setFn = vi.fn((arg: any) => {
      txSetCalls.push(arg);
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([scan]),
        }),
      };
    });
    const tx: any = {
      execute: vi.fn().mockResolvedValue([{ id: scan.id }]),
      update: vi.fn().mockReturnValue({ set: setFn }),
    };
    await cb(tx);
  });
}

// The worker failure path re-reads the scan row (db.select().from().where())
// to detect a mid-run user cancellation before overwriting error/completedAt.
function mockScanReRead(row: Record<string, unknown> | null) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(row ? [row] : []),
    }),
  });
}

describe('pollForWork', () => {
  it('does nothing when no scan available', async () => {
    mockDb.transaction.mockImplementation(async (cb: any) => {
      const tx: any = { execute: vi.fn().mockResolvedValue([]) };
      await cb(tx);
    });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it('marks scan paused (not failed) when ScanPausedError is thrown', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    mockRunPipeline.mockRejectedValueOnce(new ScanPausedError('Rate limit hit', '2026-05-04T20:00:00Z'));

    // Mock outer db.update().set().where()
    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });

    // Mock db.insert().values() (for scanEvents)
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    // outer update set called with status='paused' + resumesAt set + error
    const pausedCall = outerSet.mock.calls.find(c => c[0]?.status === 'paused');
    expect(pausedCall).toBeDefined();
    expect(pausedCall![0]).toEqual(expect.objectContaining({
      status: 'paused',
      error: 'Rate limit hit',
    }));
    expect(pausedCall![0].resumesAt).toBeInstanceOf(Date);

    // Must NOT have any update call setting status='failed'
    const failedCall = outerSet.mock.calls.find(c => c[0]?.status === 'failed');
    expect(failedCall).toBeUndefined();
  });

  it('marks scan failed when non-paused error is thrown', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    mockRunPipeline.mockRejectedValueOnce(new Error('Boom'));
    mockScanReRead({ status: 'running' });

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    const failedCall = outerSet.mock.calls.find(c => c[0]?.status === 'failed');
    expect(failedCall).toBeDefined();
    expect(failedCall![0].error).toBe('Boom');

    // Should NOT have set status='paused'
    const pausedCall = outerSet.mock.calls.find(c => c[0]?.status === 'paused');
    expect(pausedCall).toBeUndefined();
  });

  it('does not pick up work while the worker is paused', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ paused: true }),
    });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it('proceeds when the worker-status check fails, but SCREAMS about it', async () => {
    // API down → we keep the old fail-open behavior (worker proceeds as if
    // unpaused) but it must be loudly logged, not swallowed.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED api:3000'));
      mockDb.transaction.mockImplementation(async (cb: any) => {
        const tx: any = { execute: vi.fn().mockResolvedValue([]) };
        await cb(tx);
      });

      const { pollForWork } = await loadWorker();
      await pollForWork();

      // Fail-open: polling continued despite the status-check failure
      expect(mockDb.transaction).toHaveBeenCalled();

      const call = consoleErrorSpy.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('[worker]'),
      );
      expect(call).toBeDefined();
      expect(call!.join(' ')).toContain('ECONNREFUSED');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('marks scan completed on successful pipeline run', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    mockRunPipeline.mockResolvedValueOnce(undefined);

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    const completedCall = outerSet.mock.calls.find(c => c[0]?.status === 'completed');
    expect(completedCall).toBeDefined();
  });

  it('persists completedWithErrors=false + empty stepErrors on a clean run', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    mockRunPipeline.mockResolvedValueOnce({ completedWithErrors: false, stepErrors: [] });

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    const completedCall = outerSet.mock.calls.find(c => c[0]?.status === 'completed');
    expect(completedCall).toBeDefined();
    expect(completedCall![0]).toMatchObject({
      status: 'completed',
      completedWithErrors: false,
      stepErrors: [],
    });
  });

  it('persists completedWithErrors=true + the structured stepErrors when the pipeline reports them', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    const stepErrors = [
      { kind: 'tool', name: 'semgrep', error: 'failed after retry: network timeout', failedAfterRetry: true },
      { kind: 'module', name: 'src/api', error: 'failed after retry — attempt 1: context overflow; attempt 2: context overflow', failedAfterRetry: true },
    ];
    mockRunPipeline.mockResolvedValueOnce({ completedWithErrors: true, stepErrors });

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    // Scan stays 'completed' (the flag is additive, no new status value)
    const completedCall = outerSet.mock.calls.find(c => c[0]?.status === 'completed');
    expect(completedCall).toBeDefined();
    expect(completedCall![0]).toMatchObject({
      status: 'completed',
      completedWithErrors: true,
      stepErrors,
    });
    // No 'failed' update — this is NOT a scan failure
    const failedCall = outerSet.mock.calls.find(c => c[0]?.status === 'failed');
    expect(failedCall).toBeUndefined();
    // And no failed-scan cleanup — committed results stay
    expect(mockCleanupFailedScanData).not.toHaveBeenCalled();
  });

  it('cleans up partial scan data after a pipeline failure', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    mockRunPipeline.mockRejectedValueOnce(new Error('triage exploded'));
    mockScanReRead({ status: 'running' });

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    expect(mockCleanupFailedScanData).toHaveBeenCalledTimes(1);
    expect(mockCleanupFailedScanData).toHaveBeenCalledWith('scan-1', {
      repoName: 'repo',
      workspaceId: 1,
    });

    // Cleanup must run AFTER the scan row is marked failed — the diagnostic
    // state has to be consistent even if cleanup crashes mid-way.
    const failedCallIdx = outerSet.mock.calls.findIndex(c => c[0]?.status === 'failed');
    expect(failedCallIdx).toBeGreaterThanOrEqual(0);
    expect(outerSet.mock.invocationCallOrder[failedCallIdx])
      .toBeLessThan(mockCleanupFailedScanData.mock.invocationCallOrder[0]);
  });

  it('cleans up on cancellation-induced failure (cancelled scan = no partial data)', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    // User cancel flips the scan to 'failed'; the pipeline notices and throws
    // a plain Error — the worker must treat it like any terminal failure.
    mockRunPipeline.mockRejectedValueOnce(new Error('Scan cancelled by user'));
    mockScanReRead({ status: 'failed' });

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    expect(mockCleanupFailedScanData).toHaveBeenCalledWith('scan-1', {
      repoName: 'repo',
      workspaceId: 1,
    });
  });

  it('does NOT clean up when the scan is paused (ScanPausedError)', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    mockRunPipeline.mockRejectedValueOnce(new ScanPausedError('Rate limit hit', '2026-05-04T20:00:00Z'));

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    // Paused scans RESUME later — their data must never be cleaned.
    expect(mockCleanupFailedScanData).not.toHaveBeenCalled();
  });

  it('does NOT clean up on successful pipeline run', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    mockRunPipeline.mockResolvedValueOnce(undefined);

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    expect(mockCleanupFailedScanData).not.toHaveBeenCalled();
  });

  it('preserves the cancel reason and completedAt when the scan was cancelled mid-run', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    // The abort tears down an in-flight SSH session — the pipeline surfaces
    // the TECHNICAL message, not the human reason.
    mockRunPipeline.mockRejectedValueOnce(new Error('SSH command aborted by cancellation'));
    // Re-read shows the cancel route already flipped the row to 'failed'
    // (with error='Cancelled by user' and completedAt set).
    mockScanReRead({ status: 'failed' });

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    const failedCall = outerSet.mock.calls.find(c => c[0]?.status === 'failed');
    expect(failedCall).toBeDefined();
    // The human 'Cancelled by user' and the route's completedAt must survive —
    // the worker only records the duration of the active leg.
    expect(failedCall![0]).not.toHaveProperty('error');
    expect(failedCall![0]).not.toHaveProperty('completedAt');
    expect(typeof failedCall![0].durationMs).toBe('number');

    // Cancelled scans still get their partial data cleaned.
    expect(mockCleanupFailedScanData).toHaveBeenCalledWith('scan-1', {
      repoName: 'repo',
      workspaceId: 1,
    });
  });

  it('overwrites error normally when the scan failed without cancellation', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    mockRunPipeline.mockRejectedValueOnce(new Error('SSH command aborted by cancellation'));
    // Re-read still shows 'running' → NOT user-cancelled (e.g. an abort raced
    // with something else) → technical message is the truth, record it.
    mockScanReRead({ status: 'running' });

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    const failedCall = outerSet.mock.calls.find(c => c[0]?.status === 'failed');
    expect(failedCall).toBeDefined();
    expect(failedCall![0].error).toBe('SSH command aborted by cancellation');
    expect(failedCall![0].completedAt).toBeInstanceOf(Date);
  });
});

// ── Honest duration: sum of ACTIVE legs, paused waiting excluded ──────────

describe('durationMs accumulation across pause/resume legs', () => {
  it('adds the current active leg to the accumulated durationMs on pause', async () => {
    // Scan already ran a 30-minute leg before a previous pause.
    const scan = makeScan({ durationMs: 1_800_000 });
    setupTransactionWithScan(scan);
    mockRunPipeline.mockRejectedValueOnce(new ScanPausedError('Rate limit hit', '2026-07-05T20:00:00Z'));

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    const pausedCall = outerSet.mock.calls.find(c => c[0]?.status === 'paused');
    expect(pausedCall).toBeDefined();
    // prior 30min + this (near-instant) leg — pause wait itself is not counted
    expect(pausedCall![0].durationMs).toBeGreaterThanOrEqual(1_800_000);
    expect(pausedCall![0].durationMs).toBeLessThan(1_800_000 + 60_000);
  });

  it('completion reports the SUM of legs, not just the last one', async () => {
    // 30min + 20min of ACTIVE work accumulated by previous pauses ("30хв скану
    // + 4 години лімітів + 20хв скану = 50 хвилин") — the final leg adds ~0.
    const scan = makeScan({ durationMs: 3_000_000 });
    setupTransactionWithScan(scan);
    mockRunPipeline.mockResolvedValueOnce(undefined);

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    const completedCall = outerSet.mock.calls.find(c => c[0]?.status === 'completed');
    expect(completedCall).toBeDefined();
    expect(completedCall![0].durationMs).toBeGreaterThanOrEqual(3_000_000);
    expect(completedCall![0].durationMs).toBeLessThan(3_000_000 + 60_000);
  });

  it('a scan with no prior legs counts only the current leg', async () => {
    const scan = makeScan(); // durationMs: null
    setupTransactionWithScan(scan);
    mockRunPipeline.mockResolvedValueOnce(undefined);

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    const completedCall = outerSet.mock.calls.find(c => c[0]?.status === 'completed');
    expect(completedCall).toBeDefined();
    expect(completedCall![0].durationMs).toBeGreaterThanOrEqual(0);
    expect(completedCall![0].durationMs).toBeLessThan(60_000);
  });

  it('claim keeps the ORIGINAL startedAt (COALESCE) instead of resetting it per leg', async () => {
    const scan = makeScan();
    setupTransactionWithScan(scan);
    mockRunPipeline.mockResolvedValueOnce(undefined);

    const outerSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: outerSet });

    const { pollForWork } = await loadWorker();
    await pollForWork();

    const claimSet = txSetCalls.find(a => a?.status === 'running');
    expect(claimSet).toBeDefined();
    // A raw `new Date()` would silently reset the start on every resume leg;
    // the claim must send SQL (COALESCE(started_at, NOW())) instead.
    expect(claimSet.startedAt).toBeDefined();
    expect(claimSet.startedAt).not.toBeInstanceOf(Date);
  });
});
