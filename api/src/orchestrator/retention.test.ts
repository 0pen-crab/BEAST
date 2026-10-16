import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../db/index.ts';
import { scanFiles, scanEvents } from '../db/schema.ts';

// ── fs mock (retention.ts imports from 'node:fs/promises') ──────
vi.mock('node:fs/promises', () => {
  const readdir = vi.fn();
  const rm = vi.fn();
  const stat = vi.fn();
  return { readdir, rm, stat, default: { readdir, rm, stat } };
});

import { readdir, rm, stat } from 'node:fs/promises';
import {
  RETENTION_DAYS,
  SWEEP_INTERVAL_MS,
  FIRST_SWEEP_DELAY_MS,
  WORKSPACE_ROOT,
  isPurgeableFileType,
  newSweepStats,
  sweepWorkDirs,
  sweepLegacyDirs,
  sweepScanFileRows,
  runRetentionSweep,
  startRetentionSweeper,
  stopRetentionSweeper,
  resetRetentionStateForTests,
} from './retention.ts';

const mockReaddir = readdir as unknown as ReturnType<typeof vi.fn>;
const mockRm = rm as unknown as ReturnType<typeof vi.fn>;
const mockStat = stat as unknown as ReturnType<typeof vi.fn>;
const mockDb = db as any;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const CUTOFF = new Date(NOW - RETENTION_DAYS * DAY_MS);
const OLD = new Date(NOW - 120 * DAY_MS); // older than retention
const FRESH = new Date(NOW - 10 * DAY_MS); // younger than retention

const OLD_SCAN_ID = '11111111-1111-4111-8111-111111111111';
const FRESH_SCAN_ID = '22222222-2222-4222-8222-222222222222';
const ORPHAN_ID = '33333333-3333-4333-8333-333333333333';
const PAUSED_SCAN_ID = '44444444-4444-4444-8444-444444444444';

// ── helpers ──────────────────────────────────────────────────────

function dir(name: string) {
  return { name, isDirectory: () => true, isFile: () => false };
}
function file(name: string) {
  return { name, isDirectory: () => false, isFile: () => true };
}

/** Fake filesystem: path → dirents; mtimes: path → epoch ms. */
function mockFsTree(tree: Record<string, unknown[]>, mtimes: Record<string, number> = {}) {
  mockReaddir.mockImplementation(async (p: string) => {
    if (!(p in tree)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    return tree[p];
  });
  mockStat.mockImplementation(async (p: string) => {
    if (p in mtimes) return { mtimeMs: mtimes[p], mtime: new Date(mtimes[p]) };
    throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  });
  mockRm.mockResolvedValue(undefined);
}

/** db.select().from().where() resolves with `rows` (used by scan-id lookup + old-scan lookup). */
function mockSelect(rows: unknown[]) {
  mockDb.select.mockImplementation(() => ({
    from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(rows) })),
  }));
}

/** db.delete(table).where().returning() resolves with `rows`; captures deleted tables. */
function mockDelete(rows: unknown[]) {
  const tables: unknown[] = [];
  mockDb.delete.mockImplementation((table: unknown) => {
    tables.push(table);
    return { where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(rows) })) };
  });
  return tables;
}

function rmPaths(): string[] {
  return mockRm.mock.calls.map(c => c[0] as string);
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetRetentionStateForTests();
  mockDb.insert.mockReturnValue(mockDb);
  mockDb.values.mockResolvedValue(undefined);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  stopRetentionSweeper();
  logSpy.mockRestore();
  errSpy.mockRestore();
  vi.useRealTimers();
});

// ── work-dir sweep ───────────────────────────────────────────────

describe('sweepWorkDirs', () => {
  it('deletes work dirs of scans older than the cutoff, keeps younger ones', async () => {
    mockFsTree({
      [WORKSPACE_ROOT]: [dir('src-1'), dir('uploads')],
      [`${WORKSPACE_ROOT}/src-1`]: [dir('myrepo')],
      [`${WORKSPACE_ROOT}/src-1/myrepo`]: [
        dir('repo'), dir(OLD_SCAN_ID), dir(FRESH_SCAN_ID),
        file('repo-profile.md'), file('scan-context.md'),
      ],
    });
    mockSelect([
      { id: OLD_SCAN_ID, createdAt: OLD, status: 'completed' },
      { id: FRESH_SCAN_ID, createdAt: FRESH, status: 'completed' },
    ]);

    const stats = newSweepStats();
    await sweepWorkDirs(CUTOFF, stats);

    expect(rmPaths()).toEqual([`${WORKSPACE_ROOT}/src-1/myrepo/${OLD_SCAN_ID}`]);
    expect(stats.workDirsDeleted).toBe(1);
    expect(stats.errors).toEqual([]);
  });

  it('never touches the repo clone dir or the .md files at the repo base', async () => {
    mockFsTree({
      [WORKSPACE_ROOT]: [dir('repo-7')],
      [`${WORKSPACE_ROOT}/repo-7`]: [dir('lonely')],
      [`${WORKSPACE_ROOT}/repo-7/lonely`]: [
        dir('repo'), file('repo-profile.md'), file('scan-context.md'), dir(OLD_SCAN_ID),
      ],
    });
    mockSelect([{ id: OLD_SCAN_ID, createdAt: OLD, status: 'failed' }]);

    const stats = newSweepStats();
    await sweepWorkDirs(CUTOFF, stats);

    const deleted = rmPaths();
    expect(deleted).toEqual([`${WORKSPACE_ROOT}/repo-7/lonely/${OLD_SCAN_ID}`]);
    expect(deleted.some(p => p.endsWith('/repo'))).toBe(false);
    expect(deleted.some(p => p.includes('repo-profile.md') || p.includes('scan-context.md'))).toBe(false);
  });

  it('deletes orphan dirs (scan id unknown in DB) only when their mtime is older than the cutoff', async () => {
    const oldOrphan = `${WORKSPACE_ROOT}/src-1/myrepo/${ORPHAN_ID}`;
    const freshOrphan = `${WORKSPACE_ROOT}/src-1/myrepo/not-a-uuid`;
    mockFsTree(
      {
        [WORKSPACE_ROOT]: [dir('src-1')],
        [`${WORKSPACE_ROOT}/src-1`]: [dir('myrepo')],
        [`${WORKSPACE_ROOT}/src-1/myrepo`]: [dir('repo'), dir(ORPHAN_ID), dir('not-a-uuid')],
      },
      {
        [oldOrphan]: NOW - 120 * DAY_MS,
        [freshOrphan]: NOW - 5 * DAY_MS,
      },
    );
    mockSelect([]); // nothing known in the DB

    const stats = newSweepStats();
    await sweepWorkDirs(CUTOFF, stats);

    expect(rmPaths()).toEqual([oldOrphan]);
    expect(stats.orphanDirsDeleted).toBe(1);
    expect(stats.workDirsDeleted).toBe(0);
  });

  it('keeps old dirs of scans still queued/running/paused (resume safety)', async () => {
    mockFsTree({
      [WORKSPACE_ROOT]: [dir('src-2')],
      [`${WORKSPACE_ROOT}/src-2`]: [dir('r')],
      [`${WORKSPACE_ROOT}/src-2/r`]: [dir(PAUSED_SCAN_ID)],
    });
    mockSelect([{ id: PAUSED_SCAN_ID, createdAt: OLD, status: 'paused' }]);

    const stats = newSweepStats();
    await sweepWorkDirs(CUTOFF, stats);

    expect(mockRm).not.toHaveBeenCalled();
    expect(stats.workDirsDeleted).toBe(0);
  });

  it('records an error and keeps sweeping when one rm fails', async () => {
    const otherOld = '55555555-5555-4555-8555-555555555555';
    mockFsTree({
      [WORKSPACE_ROOT]: [dir('src-1')],
      [`${WORKSPACE_ROOT}/src-1`]: [dir('a'), dir('b')],
      [`${WORKSPACE_ROOT}/src-1/a`]: [dir(OLD_SCAN_ID)],
      [`${WORKSPACE_ROOT}/src-1/b`]: [dir(otherOld)],
    });
    mockSelect([
      { id: OLD_SCAN_ID, createdAt: OLD, status: 'completed' },
      { id: otherOld, createdAt: OLD, status: 'completed' },
    ]);
    mockRm
      .mockRejectedValueOnce(new Error('EACCES: permission denied'))
      .mockResolvedValueOnce(undefined);

    const stats = newSweepStats();
    await sweepWorkDirs(CUTOFF, stats);

    expect(mockRm).toHaveBeenCalledTimes(2);
    expect(stats.workDirsDeleted).toBe(1);
    expect(stats.errors).toHaveLength(1);
    expect(stats.errors[0]).toContain('EACCES');
  });

  it('does not throw when the workspace root cannot be read', async () => {
    mockReaddir.mockRejectedValue(new Error('EIO: disk gone'));
    const stats = newSweepStats();
    await expect(sweepWorkDirs(CUTOFF, stats)).resolves.toBeUndefined();
    expect(stats.errors).toHaveLength(1);
  });
});

// ── legacy layout cleanup ────────────────────────────────────────

describe('sweepLegacyDirs', () => {
  it('deletes old-layout dirs that contain a repo clone or scan-uuid subdirs; spares uploads/ and unrecognized dirs', async () => {
    mockFsTree({
      [WORKSPACE_ROOT]: [
        dir('src-1'),          // new layout — not legacy
        dir('repo-3'),         // new layout — not legacy
        dir('uploads'),        // system dir — KEEP
        dir('lost+found'),     // system dir — KEEP
        dir('old-repo-a'),     // legacy: has repo subdir → delete
        dir('old-repo-b'),     // legacy: has scan-uuid subdir → delete
        dir('random-stuff'),   // no heuristic markers → KEEP
      ],
      [`${WORKSPACE_ROOT}/old-repo-a`]: [dir('repo'), file('repo-profile.md')],
      [`${WORKSPACE_ROOT}/old-repo-b`]: [dir(ORPHAN_ID)],
      [`${WORKSPACE_ROOT}/random-stuff`]: [file('notes.txt'), dir('misc')],
      [`${WORKSPACE_ROOT}/uploads`]: [dir(ORPHAN_ID)],
    });

    const stats = newSweepStats();
    await sweepLegacyDirs(stats);

    expect(rmPaths().sort()).toEqual([
      `${WORKSPACE_ROOT}/old-repo-a`,
      `${WORKSPACE_ROOT}/old-repo-b`,
    ]);
    expect(stats.legacyDirsDeleted).toBe(2);
    // each deletion is logged
    const logged = logSpy.mock.calls.flat().join('\n');
    expect(logged).toContain('old-repo-a');
    expect(logged).toContain('old-repo-b');
  });

  it('runs only on the first sweep of the process (guard flag)', async () => {
    mockFsTree({
      [WORKSPACE_ROOT]: [dir('legacy-x')],
      [`${WORKSPACE_ROOT}/legacy-x`]: [dir('repo')],
    });
    mockSelect([]);
    mockDelete([]);

    await runRetentionSweep();
    expect(rmPaths()).toContain(`${WORKSPACE_ROOT}/legacy-x`);

    mockRm.mockClear();
    await runRetentionSweep();
    expect(rmPaths()).not.toContain(`${WORKSPACE_ROOT}/legacy-x`);
  });
});

// ── scan_files DB sweep ──────────────────────────────────────────

describe('isPurgeableFileType', () => {
  it('purges ai-trace and log-* types only — profile/audit/raw-* live forever', () => {
    expect(isPurgeableFileType('ai-trace')).toBe(true);
    expect(isPurgeableFileType('log-analysis')).toBe(true);
    expect(isPurgeableFileType('log-ai-research')).toBe(true);
    expect(isPurgeableFileType('log-triage')).toBe(true);
    expect(isPurgeableFileType('log-sniper-fail')).toBe(true);
    expect(isPurgeableFileType('profile')).toBe(false);
    expect(isPurgeableFileType('audit')).toBe(false);
    expect(isPurgeableFileType('raw-semgrep')).toBe(false);
    expect(isPurgeableFileType(null)).toBe(false);
  });
});

describe('sweepScanFileRows', () => {
  it('deletes purgeable rows of old scans and records the count', async () => {
    mockSelect([{ id: OLD_SCAN_ID }]); // old scans lookup
    const tables = mockDelete([{ id: 1 }, { id: 2 }, { id: 3 }]);

    const stats = newSweepStats();
    await sweepScanFileRows(CUTOFF, stats);

    expect(tables).toEqual([scanFiles]);
    expect(stats.scanFileRowsDeleted).toBe(3);
    expect(stats.errors).toEqual([]);
  });

  it('skips the delete entirely when no scans are old enough', async () => {
    mockSelect([]);
    const tables = mockDelete([]);

    const stats = newSweepStats();
    await sweepScanFileRows(CUTOFF, stats);

    expect(tables).toEqual([]);
    expect(stats.scanFileRowsDeleted).toBe(0);
  });

  it('records an error instead of throwing when the DB fails', async () => {
    mockDb.select.mockImplementation(() => ({
      from: vi.fn(() => ({ where: vi.fn().mockRejectedValue(new Error('db down')) })),
    }));

    const stats = newSweepStats();
    await expect(sweepScanFileRows(CUTOFF, stats)).resolves.toBeUndefined();
    expect(stats.errors).toHaveLength(1);
    expect(stats.errors[0]).toContain('db down');
  });
});

// ── full sweep orchestration ─────────────────────────────────────

describe('runRetentionSweep', () => {
  it('logs a one-line summary and writes NO scan_events row when everything succeeds', async () => {
    mockFsTree({
      [WORKSPACE_ROOT]: [dir('src-1')],
      [`${WORKSPACE_ROOT}/src-1`]: [dir('r')],
      [`${WORKSPACE_ROOT}/src-1/r`]: [dir(OLD_SCAN_ID)],
    });
    mockSelect([{ id: OLD_SCAN_ID, createdAt: OLD, status: 'completed' }]);
    mockDelete([{ id: 9 }]);

    const stats = await runRetentionSweep();

    expect(stats.workDirsDeleted).toBe(1);
    expect(stats.errors).toEqual([]);
    const summary = logSpy.mock.calls.flat().filter((l: unknown) => String(l).includes('sweep done'));
    expect(summary).toHaveLength(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('writes a scan_events row when a deletion failed', async () => {
    mockFsTree({
      [WORKSPACE_ROOT]: [dir('src-1')],
      [`${WORKSPACE_ROOT}/src-1`]: [dir('r')],
      [`${WORKSPACE_ROOT}/src-1/r`]: [dir(OLD_SCAN_ID)],
    });
    mockSelect([{ id: OLD_SCAN_ID, createdAt: OLD, status: 'completed' }]);
    mockDelete([]);
    mockRm.mockRejectedValue(new Error('EBUSY'));

    const stats = await runRetentionSweep();

    expect(stats.errors.length).toBeGreaterThan(0);
    expect(mockDb.insert).toHaveBeenCalledWith(scanEvents);
    const values = mockDb.values.mock.calls[0][0];
    expect(values.level).toBe('error');
    expect(values.source).toBe('retention');
    expect(values.scanId).toBeNull();
  });

  it('never throws, even when everything is on fire', async () => {
    mockReaddir.mockRejectedValue(new Error('fs exploded'));
    mockDb.select.mockImplementation(() => { throw new Error('db exploded'); });
    mockDb.insert.mockImplementation(() => { throw new Error('events exploded'); });

    await expect(runRetentionSweep()).resolves.toBeDefined();
  });
});

// ── timer wiring ─────────────────────────────────────────────────

describe('startRetentionSweeper', () => {
  it('runs ~5 min after boot and then every 24h; stop clears the timers', async () => {
    vi.useFakeTimers();
    mockFsTree({ [WORKSPACE_ROOT]: [] });
    mockSelect([]);
    mockDelete([]);

    startRetentionSweeper();
    expect(mockReaddir).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FIRST_SWEEP_DELAY_MS);
    expect(mockReaddir).toHaveBeenCalled();
    const callsAfterBoot = mockReaddir.mock.calls.length;

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(mockReaddir.mock.calls.length).toBeGreaterThan(callsAfterBoot);

    const callsBeforeStop = mockReaddir.mock.calls.length;
    stopRetentionSweeper();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 3);
    expect(mockReaddir.mock.calls.length).toBe(callsBeforeStop);
  });

  it('is idempotent — calling start twice schedules only one first run', async () => {
    vi.useFakeTimers();
    mockFsTree({ [WORKSPACE_ROOT]: [] });
    mockSelect([]);
    mockDelete([]);

    startRetentionSweeper();
    startRetentionSweeper();
    await vi.advanceTimersByTimeAsync(FIRST_SWEEP_DELAY_MS);
    // one sweep = one readdir of the root (legacy + workdir share the listing)
    const rootReads = mockReaddir.mock.calls.filter(c => c[0] === WORKSPACE_ROOT).length;
    expect(rootReads).toBeLessThanOrEqual(2); // legacy pass + workdir pass, single sweep
  });
});
