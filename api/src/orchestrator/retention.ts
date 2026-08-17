// Retention sweeper — ages out heavy per-scan artifacts after 90 days.
//
// Maintainer policy (approved): scan WORK DIRS are kept for ALL scans
// (successful included) and deleted only when the scan is older than
// 3 months. The same sweep purges heavy scan_files rows (AI traces,
// step logs) of those old scans. Everything the product actually sells
// lives forever: 'profile' and 'audit' reports, findings, raw tool
// outputs ('raw-*'), and the scans/events/steps diagnostic record.
//
// Filesystem layout on the shared volume (claude_workspaces → /workspace):
//   /workspace/src-<sourceId>/<repoName>/<scanId>/   ← ages out (90d)
//   /workspace/repo-<repositoryId>/<repoName>/<scanId>/ ← ages out (90d)
//   /workspace/<src|repo>-N/<repoName>/repo/         ← clone, REUSED — never touched
//   /workspace/<src|repo>-N/<repoName>/*.md          ← repo-profile/scan-context — never touched
//   /workspace/uploads/<uploadId>/                   ← upload route staging — never touched
//   /workspace/<repoName>/…                          ← LEGACY pre-src-N layout — one-time cleanup
//
// Design constraints:
//   - never crashes the worker (worker-main installs crash-on-unhandled-
//     rejection handlers) — every path is caught, failures scream to console;
//   - async fs only — a sweep over thousands of dirs must not block the
//     event loop while a scan is running;
//   - routine housekeeping logs to console only; a scan_events row is
//     written ONLY when something FAILED to delete (errors must scream,
//     successes must not spam the Events tab).

import { readdir, rm, stat } from 'node:fs/promises';
import { and, inArray, like, lt, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { scans, scanFiles } from '../db/schema.ts';
import { logScanEvent } from './events.ts';

export const RETENTION_DAYS = 90;
export const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
export const FIRST_SWEEP_DELAY_MS = 5 * 60 * 1000; // ~5 min after boot
export const WORKSPACE_ROOT = '/workspace';

// scan_files types that age out. Everything else ('profile', 'audit',
// 'raw-*' tool outputs) is the product / diagnostics record — kept forever.
export const PURGEABLE_EXACT_TYPES = ['ai-trace'] as const;
export const PURGEABLE_TYPE_PREFIX = 'log-';

export function isPurgeableFileType(fileType: string | null): boolean {
  if (!fileType) return false;
  return (PURGEABLE_EXACT_TYPES as readonly string[]).includes(fileType)
    || fileType.startsWith(PURGEABLE_TYPE_PREFIX);
}

// New-layout top-level dirs: src-<sourceId> / repo-<repositoryId>.
const SOURCE_DIR_RE = /^(src|repo)-\d+$/;
// Root-level dirs that are NOT legacy repo dirs and must never be deleted.
const PROTECTED_ROOT_DIRS = new Set(['uploads', 'lost+found']);
// The reused clone dir inside each repo base dir.
const CLONE_DIR_NAME = 'repo';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Old dirs of scans in these states may still be resumed — never delete them.
const ACTIVE_SCAN_STATUSES = new Set(['queued', 'running', 'paused']);

const SELECT_CHUNK = 500;

export interface SweepStats {
  workDirsDeleted: number;
  orphanDirsDeleted: number;
  legacyDirsDeleted: number;
  scanFileRowsDeleted: number;
  errors: string[];
}

export function newSweepStats(): SweepStats {
  return {
    workDirsDeleted: 0,
    orphanDirsDeleted: 0,
    legacyDirsDeleted: 0,
    scanFileRowsDeleted: 0,
    errors: [],
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function listDirents(path: string): Promise<Array<{ name: string; isDirectory: () => boolean }> | null> {
  try {
    return await readdir(path, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory: () => boolean }>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

async function removeDir(path: string, stats: SweepStats): Promise<boolean> {
  try {
    await rm(path, { recursive: true, force: true });
    return true;
  } catch (err) {
    const msg = `failed to delete ${path}: ${errMsg(err)}`;
    console.error(`[retention] ${msg}`);
    stats.errors.push(msg);
    return false;
  }
}

// ── 1. per-scan work dirs (/workspace/<src|repo>-N/<repoName>/<scanId>) ──

export async function sweepWorkDirs(cutoff: Date, stats: SweepStats): Promise<void> {
  try {
    const rootEntries = await listDirents(WORKSPACE_ROOT);
    if (!rootEntries) return;

    // Collect scan-dir candidates: /workspace/<src|repo>-N/<repoName>/<dir>
    // where <dir> is anything but the reused `repo` clone. Files at the repo
    // base (repo-profile.md, scan-context.md) are not directories — immune
    // by construction.
    const candidates: Array<{ path: string; name: string }> = [];
    for (const sourceDir of rootEntries) {
      if (!sourceDir.isDirectory() || !SOURCE_DIR_RE.test(sourceDir.name)) continue;
      const sourcePath = `${WORKSPACE_ROOT}/${sourceDir.name}`;
      const repoDirs = await listDirents(sourcePath);
      if (!repoDirs) continue;
      for (const repoDir of repoDirs) {
        if (!repoDir.isDirectory()) continue;
        const repoPath = `${sourcePath}/${repoDir.name}`;
        const entries = await listDirents(repoPath);
        if (!entries) continue;
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name === CLONE_DIR_NAME) continue;
          candidates.push({ path: `${repoPath}/${entry.name}`, name: entry.name });
        }
      }
    }
    if (candidates.length === 0) return;

    // Resolve uuid-shaped dir names against the scans table (chunked).
    const uuidNames = [...new Set(candidates.filter(c => UUID_RE.test(c.name)).map(c => c.name.toLowerCase()))];
    const known = new Map<string, { createdAt: Date | null; status: string }>();
    for (let i = 0; i < uuidNames.length; i += SELECT_CHUNK) {
      const chunk = uuidNames.slice(i, i + SELECT_CHUNK);
      const rows = await db.select({ id: scans.id, createdAt: scans.createdAt, status: scans.status })
        .from(scans)
        .where(inArray(scans.id, chunk)) as Array<{ id: string; createdAt: Date | null; status: string }>;
      for (const row of rows) known.set(row.id.toLowerCase(), { createdAt: row.createdAt, status: row.status });
    }

    for (const candidate of candidates) {
      const scan = known.get(candidate.name.toLowerCase());
      if (scan) {
        // Known scan: age by created_at; never touch resumable scans.
        if (ACTIVE_SCAN_STATUSES.has(scan.status)) continue;
        if (!scan.createdAt || scan.createdAt.getTime() >= cutoff.getTime()) continue;
        if (await removeDir(candidate.path, stats)) {
          stats.workDirsDeleted += 1;
          console.log(`[retention] deleted work dir ${candidate.path} (scan created ${scan.createdAt.toISOString()})`);
        }
      } else {
        // Unknown in the DB → orphan. Age by dir mtime, same 90-day rule.
        let mtimeMs: number;
        try {
          mtimeMs = (await stat(candidate.path)).mtimeMs;
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            stats.errors.push(`failed to stat ${candidate.path}: ${errMsg(err)}`);
          }
          continue;
        }
        if (mtimeMs >= cutoff.getTime()) continue;
        if (await removeDir(candidate.path, stats)) {
          stats.orphanDirsDeleted += 1;
          console.log(`[retention] deleted orphan dir ${candidate.path} (no scans row, mtime ${new Date(mtimeMs).toISOString()})`);
        }
      }
    }
  } catch (err) {
    const msg = `work-dir sweep failed: ${errMsg(err)}`;
    console.error(`[retention] ${msg}`);
    stats.errors.push(msg);
  }
}

// ── 2. legacy pre-src-N layout (/workspace/<repoName>/…) — one-time ──

/**
 * The path scheme moved from /workspace/<repoName>/ to
 * /workspace/src-<sourceId>/<repoName>/ — dirs in the old layout are
 * unusable garbage and are removed regardless of age. Safety heuristic:
 * only dirs that actually look like old repo bases (contain a `repo`
 * clone subdir or scan-uuid-shaped subdirs) are touched; uploads/ and
 * anything unrecognized is left alone.
 *
 * Returns true when the pass completed (root was readable) so the caller
 * can latch the one-time guard.
 */
export async function sweepLegacyDirs(stats: SweepStats): Promise<boolean> {
  let rootEntries: Awaited<ReturnType<typeof listDirents>>;
  try {
    rootEntries = await listDirents(WORKSPACE_ROOT);
  } catch (err) {
    const msg = `legacy sweep failed to read ${WORKSPACE_ROOT}: ${errMsg(err)}`;
    console.error(`[retention] ${msg}`);
    stats.errors.push(msg);
    return false;
  }
  if (!rootEntries) return true;

  for (const entry of rootEntries) {
    if (!entry.isDirectory()) continue;
    if (SOURCE_DIR_RE.test(entry.name) || PROTECTED_ROOT_DIRS.has(entry.name)) continue;
    const path = `${WORKSPACE_ROOT}/${entry.name}`;
    let children: Awaited<ReturnType<typeof listDirents>>;
    try {
      children = await listDirents(path);
    } catch (err) {
      stats.errors.push(`legacy sweep failed to read ${path}: ${errMsg(err)}`);
      continue;
    }
    if (!children) continue;
    const looksLegacy = children.some(c =>
      c.isDirectory() && (c.name === CLONE_DIR_NAME || UUID_RE.test(c.name)));
    if (!looksLegacy) continue;
    if (await removeDir(path, stats)) {
      stats.legacyDirsDeleted += 1;
      console.log(`[retention] deleted legacy-layout dir ${path} (pre-src-N path scheme)`);
    }
  }
  return true;
}

// ── 3. heavy scan_files rows (AI traces + step logs) of old scans ──

export async function sweepScanFileRows(cutoff: Date, stats: SweepStats): Promise<void> {
  try {
    const oldScans = await db.select({ id: scans.id })
      .from(scans)
      .where(lt(scans.createdAt, cutoff)) as Array<{ id: string }>;
    if (oldScans.length === 0) return;

    for (let i = 0; i < oldScans.length; i += SELECT_CHUNK) {
      const chunk = oldScans.slice(i, i + SELECT_CHUNK).map(r => r.id);
      const deleted = await db.delete(scanFiles)
        .where(and(
          inArray(scanFiles.scanId, chunk),
          // Same predicate as isPurgeableFileType: 'ai-trace' exactly, or the
          // log-* step-log family (log-analysis, log-ai-research, log-triage,
          // log-sniper-fail today — the prefix keeps future log types covered).
          or(
            inArray(scanFiles.fileType, [...PURGEABLE_EXACT_TYPES]),
            like(scanFiles.fileType, `${PURGEABLE_TYPE_PREFIX}%`),
          ),
        ))
        .returning({ id: scanFiles.id }) as Array<{ id: number }>;
      stats.scanFileRowsDeleted += deleted.length;
    }
    if (stats.scanFileRowsDeleted > 0) {
      console.log(`[retention] deleted ${stats.scanFileRowsDeleted} heavy scan_files rows (ai-trace/log-*) of ${oldScans.length} old scans`);
    }
  } catch (err) {
    const msg = `scan_files sweep failed: ${errMsg(err)}`;
    console.error(`[retention] ${msg}`);
    stats.errors.push(msg);
  }
}

// ── orchestration ────────────────────────────────────────────────

let legacySweepDone = false;
let sweeping = false;

export async function runRetentionSweep(): Promise<SweepStats> {
  const stats = newSweepStats();
  if (sweeping) return stats; // a previous sweep is still running — skip
  sweeping = true;
  const startedAt = Date.now();
  const cutoff = new Date(startedAt - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  try {
    if (!legacySweepDone) {
      legacySweepDone = await sweepLegacyDirs(stats);
    }
    await sweepWorkDirs(cutoff, stats);
    await sweepScanFileRows(cutoff, stats);
  } catch (err) {
    // Sub-sweeps catch their own errors — this is the belt-and-braces layer.
    const msg = `sweep crashed: ${errMsg(err)}`;
    console.error(`[retention] ${msg}`);
    stats.errors.push(msg);
  } finally {
    sweeping = false;
  }

  const tookMs = Date.now() - startedAt;
  console.log(
    `[retention] sweep done in ${tookMs}ms: ${stats.workDirsDeleted} work dirs, `
    + `${stats.orphanDirsDeleted} orphans, ${stats.legacyDirsDeleted} legacy dirs, `
    + `${stats.scanFileRowsDeleted} scan_files rows deleted; ${stats.errors.length} errors `
    + `(cutoff ${cutoff.toISOString()}, ${RETENTION_DAYS}d)`,
  );

  // Routine housekeeping stays out of the Events tab — but FAILURES scream.
  if (stats.errors.length > 0) {
    await logScanEvent(null, 'retention', 'error',
      `Retention sweep hit ${stats.errors.length} failure(s) — some artifacts were not deleted`,
      {
        errors: stats.errors.slice(0, 20),
        workDirsDeleted: stats.workDirsDeleted,
        orphanDirsDeleted: stats.orphanDirsDeleted,
        legacyDirsDeleted: stats.legacyDirsDeleted,
        scanFileRowsDeleted: stats.scanFileRowsDeleted,
      });
  }

  return stats;
}

// ── timer wiring (worker-main) ───────────────────────────────────

let bootTimer: ReturnType<typeof setTimeout> | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the daily retention sweep: first run ~5 minutes after boot (so a
 * worker restart storm doesn't hammer the volume), then every 24 hours.
 * runRetentionSweep never rejects, so the fire-and-forget `void` is safe
 * under worker-main's crash-on-unhandled-rejection handlers.
 */
export function startRetentionSweeper(): void {
  if (bootTimer || sweepTimer) return;
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void runRetentionSweep();
    sweepTimer = setInterval(() => { void runRetentionSweep(); }, SWEEP_INTERVAL_MS);
  }, FIRST_SWEEP_DELAY_MS);
  console.log(`[retention] Sweeper scheduled: first run in ${FIRST_SWEEP_DELAY_MS / 60000} min, then every ${SWEEP_INTERVAL_MS / 3600000}h (${RETENTION_DAYS}-day retention)`);
}

export function stopRetentionSweeper(): void {
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}

/** Test hook — resets the one-time legacy guard and the overlap latch. */
export function resetRetentionStateForTests(): void {
  legacySweepDone = false;
  sweeping = false;
  stopRetentionSweeper();
}
