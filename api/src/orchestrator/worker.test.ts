import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/index.ts';
import { ScanPausedError } from './rate-limit.ts';

const mockDb = db as any;

const { mockRunPipeline, mockFetch } = vi.hoisted(() => ({
  mockRunPipeline: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('./pipeline.ts', () => ({
  runPipeline: mockRunPipeline,
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
    pullRequestId: null,
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

function setupTransactionWithScan(scan: any) {
  // Pipeline: db.transaction(callback) — execute callback with a tx that mocks
  // execute() to return [{id: scan.id}] then update().set().where().returning() returns [scan].
  mockDb.transaction.mockImplementation(async (cb: any) => {
    const tx: any = {
      execute: vi.fn().mockResolvedValue([{ id: scan.id }]),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([scan]),
          }),
        }),
      }),
    };
    await cb(tx);
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
});
