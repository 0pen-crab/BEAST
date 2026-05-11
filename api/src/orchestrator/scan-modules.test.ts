import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/index.ts';

const mockDb = db as any;

function resetMockDb() {
  for (const key of Object.keys(mockDb)) {
    if (typeof mockDb[key]?.mockReset === 'function') {
      mockDb[key].mockReset();
      mockDb[key].mockReturnValue(mockDb);
    }
  }
}

beforeEach(() => {
  resetMockDb();
});

async function loadModule() {
  return import('./scan-modules.ts');
}

describe('ensureScanModule', () => {
  it('returns existing row when one exists for (scanId, moduleIndex)', async () => {
    const existing = { id: 7, scanId: 'scan-1', moduleIndex: 0, moduleName: 'mod-a', status: 'completed' };
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([existing]),
      }),
    });

    const { ensureScanModule } = await loadModule();
    const result = await ensureScanModule({
      scanId: 'scan-1',
      moduleIndex: 0,
      moduleName: 'mod-a',
      fileCount: 100,
      outputPath: '/tmp/p.json',
    });

    expect(result).toBe(existing);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('inserts a new row when none exists', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    const created = { id: 1, scanId: 'scan-1', moduleIndex: 0, moduleName: 'mod-a', status: 'pending', fileCount: 100, outputPath: '/tmp/p.json' };
    const insertValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([created]),
    });
    mockDb.insert.mockReturnValue({ values: insertValues });

    const { ensureScanModule } = await loadModule();
    const result = await ensureScanModule({
      scanId: 'scan-1',
      moduleIndex: 0,
      moduleName: 'mod-a',
      fileCount: 100,
      outputPath: '/tmp/p.json',
    });

    expect(result).toEqual(created);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      scanId: 'scan-1',
      moduleIndex: 0,
      moduleName: 'mod-a',
      fileCount: 100,
      outputPath: '/tmp/p.json',
      status: 'pending',
    }));
  });
});

describe('listScanModules', () => {
  it('returns rows ordered by module_index ascending', async () => {
    const rows = [
      { id: 1, scanId: 's1', moduleIndex: 0, status: 'completed' },
      { id: 2, scanId: 's1', moduleIndex: 1, status: 'pending' },
    ];
    const orderBy = vi.fn().mockResolvedValue(rows);
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ orderBy }),
      }),
    });

    const { listScanModules } = await loadModule();
    const result = await listScanModules('s1');

    expect(result).toEqual(rows);
    expect(orderBy).toHaveBeenCalled();
  });
});

describe('mark helpers', () => {
  function mockUpdate() {
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: setFn });
    return setFn;
  }

  it('markScanModuleRunning sets status=running and clears error', async () => {
    const setFn = mockUpdate();
    const { markScanModuleRunning } = await loadModule();
    await markScanModuleRunning(42);
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      error: null,
    }));
    expect(setFn.mock.calls[0][0].startedAt).toBeInstanceOf(Date);
  });

  it('markScanModuleCompleted sets status=completed and completedAt', async () => {
    const setFn = mockUpdate();
    const { markScanModuleCompleted } = await loadModule();
    await markScanModuleCompleted(42);
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      error: null,
    }));
    expect(setFn.mock.calls[0][0].completedAt).toBeInstanceOf(Date);
  });

  it('markScanModulePending stores optional error message', async () => {
    const setFn = mockUpdate();
    const { markScanModulePending } = await loadModule();
    await markScanModulePending(42, 'rate limit hit');
    expect(setFn).toHaveBeenCalledWith({
      status: 'pending',
      error: 'rate limit hit',
    });
  });

  it('markScanModulePending stores null error when no message given', async () => {
    const setFn = mockUpdate();
    const { markScanModulePending } = await loadModule();
    await markScanModulePending(42);
    expect(setFn).toHaveBeenCalledWith({
      status: 'pending',
      error: null,
    });
  });

  it('markScanModuleFailed stores error and completedAt', async () => {
    const setFn = mockUpdate();
    const { markScanModuleFailed } = await loadModule();
    await markScanModuleFailed(42, 'boom');
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: 'boom',
    }));
    expect(setFn.mock.calls[0][0].completedAt).toBeInstanceOf(Date);
  });
});
