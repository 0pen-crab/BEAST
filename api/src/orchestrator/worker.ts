import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { sanitizeScanError } from '../lib/sanitize.ts';
import { scans, repositories, scanEvents, type Scan } from '../db/schema.ts';
import { runPipeline } from './pipeline.ts';
import { ScanPausedError } from './rate-limit.ts';
import { cleanupFailedScanData } from './cleanup.ts';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let rateLimitCheckTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL = Number(process.env.WORKER_POLL_INTERVAL_MS) || 5000;
// How often to re-probe Claude when paused due to rate/usage limit.
// 30 min default — each probe itself uses a Claude API call, so don't burn it too often.
// Override via env when experimenting (e.g. WORKER_RATE_LIMIT_CHECK_INTERVAL_MS=900000 for 15min).
const RATE_LIMIT_CHECK_INTERVAL = Number(process.env.WORKER_RATE_LIMIT_CHECK_INTERVAL_MS) || 30 * 60 * 1000;
let running = false;

const API_URL = process.env.API_SELF_URL || 'http://api:3000';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';

async function isWorkerPaused(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/worker-status`);
    const data = await res.json() as { paused: boolean };
    return data.paused;
  } catch (err) {
    // Fail-open on purpose (API briefly down must not stall the queue), but
    // never silently: a persistently failing status check means pause state is
    // being ignored.
    console.error(`[worker] Failed to check worker pause status (${API_URL}/api/worker-status) — proceeding as NOT paused:`, err instanceof Error ? err.message : err);
    return false;
  }
}

async function resumeWorkerViaApi(): Promise<void> {
  await fetch(`${API_URL}/api/worker/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': INTERNAL_TOKEN },
    body: '{}',
  }).catch(err => {
    // Best-effort (the pause also auto-expires via resumesAt), but SCREAM:
    // if this keeps failing the queue may stay paused longer than intended.
    console.error(`[worker] Failed to resume worker via ${API_URL}/api/worker/resume:`, err instanceof Error ? err.message : err);
  });
}

export async function pollForWork(): Promise<void> {
  if (running) return; // one scan at a time
  if (await isWorkerPaused()) return; // paused (e.g. rate limit)
  running = true;
  let picked: Scan | null = null;

  try {
    // Transaction: pick a queued scan OR a paused scan whose resumes_at has passed.
    // Mark it running atomically.
    await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id FROM scans
        WHERE status = 'queued'
           OR (status = 'paused' AND (resumes_at IS NULL OR resumes_at <= now()))
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);

      if (!rows.length) return;
      const scanId = (rows[0] as any).id as string;

      // Mark as running. Clear resumes_at since we're picking it up now.
      // startedAt: COALESCE keeps the ORIGINAL start on resume — durationMs
      // accumulates the active legs (see pause/completion below), so resetting
      // startedAt on every claim would lie about when the scan really began.
      const [updated] = await tx.update(scans)
        .set({ status: 'running', startedAt: sql`COALESCE(${scans.startedAt}, NOW())`, resumesAt: null })
        .where(eq(scans.id, scanId))
        .returning();

      picked = updated;

      if (updated.repositoryId) {
        await tx.update(repositories)
          .set({ status: 'analyzing', updatedAt: new Date() })
          .where(eq(repositories.id, updated.repositoryId));
      }
    });

    if (!picked) return;

    const scan: Scan = picked;
    const scanId = scan.id;
    const startTime = Date.now();
    // Honest duration = SUM of ACTIVE legs only (paused waiting excluded).
    // Each pause adds its leg's elapsed time to scans.duration_ms; the claim
    // above returns the row with that accumulated value, so completion/failure
    // only add the CURRENT leg on top — legs are never double-counted.
    const priorDurationMs = scan.durationMs ?? 0;

    console.log(`[worker] Starting scan ${scanId} for ${scan.repoName}`);

    try {
      // Defensive default: runPipeline always returns a result, but keep old
      // callers/mocks that resolve undefined from crashing the success path.
      const pipelineResult = (await runPipeline(scan)) ?? { completedWithErrors: false, stepErrors: [] };

      const durationMs = priorDurationMs + (Date.now() - startTime);
      // "Completed with errors": status stays 'completed' (all existing
      // status-matching queries keep working); the additive flag + structured
      // error list mark the partial success and feed the UI details.
      await db.update(scans)
        .set({
          status: 'completed',
          completedWithErrors: pipelineResult.completedWithErrors,
          stepErrors: pipelineResult.stepErrors,
          completedAt: new Date(),
          durationMs,
        })
        .where(eq(scans.id, scanId));

      if (scan.repositoryId) {
        await db.update(repositories)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(repositories.id, scan.repositoryId));
      }

      console.log(`[worker] Completed scan ${scanId} in ${durationMs}ms${pipelineResult.completedWithErrors ? ` WITH ${pipelineResult.stepErrors.length} error(s)` : ''}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof ScanPausedError) {
        // Scan is recoverable: mark paused with resumes_at, do NOT mark failed,
        // do NOT re-queue. The poller will pick it up again once resumes_at passes.
        const resumesAt = err.resumesAt ? new Date(err.resumesAt) : null;
        // Accumulate this ACTIVE leg into duration_ms now — the paused wait
        // that follows must not count ("30min scan + 4h limits + 20min scan
        // = 50min"). The resume claim reads the accumulated value back.
        await db.update(scans)
          .set({ status: 'paused', resumesAt, error: message, durationMs: priorDurationMs + (Date.now() - startTime) })
          .where(eq(scans.id, scanId));

        if (scan.repositoryId) {
          await db.update(repositories)
            .set({ status: 'analyzing', updatedAt: new Date() })
            .where(eq(repositories.id, scan.repositoryId));
        }

        try {
          await db.insert(scanEvents).values({
            scanId,
            level: 'warning',
            source: 'pipeline',
            message: `Scan paused: ${message}`,
            details: { resumesAt: err.resumesAt, reason: err.reason },
            repoName: scan.repoName,
            workspaceId: scan.workspaceId,
          });
        } catch (eventErr) {
          console.error(`[worker] Failed to log paused event for ${scanId}:`, eventErr instanceof Error ? eventErr.message : eventErr);
        }

        console.log(`[worker] Scan ${scanId} paused${resumesAt ? ` until ${resumesAt.toISOString()}` : ''}: ${message}`);
        return;
      }

      const durationMs = priorDurationMs + (Date.now() - startTime);

      // User cancellation: the cancel route already set status='failed',
      // error='Cancelled by user' and completedAt. The pipeline then tears
      // down and throws a TECHNICAL message ('Scan cancelled by user',
      // 'SSH command aborted by cancellation', …) which must NOT overwrite
      // the human reason or the route's completedAt. The worker set this scan
      // 'running' when it claimed it, so status 'failed' here can only mean
      // the cancel route flipped it mid-run.
      let cancelledByUser = false;
      try {
        const [current] = await db.select({ status: scans.status })
          .from(scans)
          .where(eq(scans.id, scanId));
        cancelledByUser = current?.status === 'failed';
      } catch (readErr) {
        console.error(`[worker] Failed to re-read scan ${scanId} before failure update — assuming not cancelled:`, readErr instanceof Error ? readErr.message : readErr);
      }

      await db.update(scans)
        .set(cancelledByUser
          ? { status: 'failed', durationMs } // keep route's error + completedAt
          : {
              status: 'failed',
              error: sanitizeScanError(message),
              completedAt: new Date(),
              durationMs,
            })
        .where(eq(scans.id, scanId));

      if (scan.repositoryId) {
        await db.update(repositories)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(repositories.id, scan.repositoryId));
      }

      try {
        await db.insert(scanEvents).values({
          scanId,
          level: 'error',
          source: 'pipeline',
          message: `Pipeline failed: ${message}`,
          details: { stack: err instanceof Error ? err.stack : null },
          repoName: scan.repoName,
          workspaceId: scan.workspaceId,
        });
      } catch (eventErr) {
        console.error(`[worker] Failed to log scan event for ${scanId}:`, eventErr instanceof Error ? eventErr.message : eventErr);
      }

      // Maintainer policy: the DB only retains data from scans that completed
      // successfully — remove partial findings/tests/assessments this scan
      // wrote before dying (cancellation lands here too: the pipeline throws a
      // plain Error when it notices the user-cancelled 'failed' status).
      // Runs AFTER the scan row is marked failed so the diagnostic state stays
      // consistent even if cleanup crashes mid-way; never called for
      // ScanPausedError (handled above) — paused scans resume and keep their
      // data. cleanupFailedScanData never throws, so the original error above
      // is never masked.
      await cleanupFailedScanData(scanId, { repoName: scan.repoName, workspaceId: scan.workspaceId });

      console.error(`[worker] Scan ${scanId} failed: ${message}`);
    }
  } catch (err) {
    // DB connection error or transaction failure — log and continue
    console.error('[worker] Poll error:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export async function startScanWorker(): Promise<void> {
  if (pollTimer) return;

  // Recovery: scans stuck in 'running' from a previous crash → reset to 'paused'
  // with resumes_at=now so the poller picks them up immediately. Per-step and
  // per-module checkpoints in scan_steps / scan_modules let the pipeline resume
  // from where it left off.
  const stuck = await db.update(scans)
    .set({ status: 'paused', resumesAt: new Date(), error: 'Worker restarted while scan was running' })
    .where(eq(scans.status, 'running'))
    .returning({ id: scans.id, repoName: scans.repoName, repositoryId: scans.repositoryId, workspaceId: scans.workspaceId });

  if (stuck.length > 0) {
    console.log(`[worker] Recovered ${stuck.length} stuck scan(s) to paused: ${stuck.map(s => s.repoName).join(', ')}`);
    for (const s of stuck) {
      if (s.repositoryId) {
        await db.update(repositories)
          .set({ status: 'analyzing', updatedAt: new Date() })
          .where(eq(repositories.id, s.repositoryId));
      }
      await db.insert(scanEvents).values({
        scanId: s.id,
        level: 'warning',
        source: 'pipeline',
        message: `Scan paused: worker restarted, will resume`,
        repoName: s.repoName,
        workspaceId: s.workspaceId,
      });
    }
  }

  pollTimer = setInterval(pollForWork, POLL_INTERVAL);
  console.log(`[worker] DB-driven scan worker started (poll every ${POLL_INTERVAL}ms)`);

  // Background check: when paused due to rate/usage limit, probe Claude periodically.
  // When Claude is reachable again, clear `resumes_at` on every paused scan so the
  // poller picks them up on its next tick instead of waiting until the API-reported
  // reset time (which can be hours or even days away for monthly-cap errors).
  rateLimitCheckTimer = setInterval(async () => {
    if (!(await isWorkerPaused())) return;
    console.log(`[worker] Rate limit pause active — checking Claude status (interval=${RATE_LIMIT_CHECK_INTERVAL / 60000}min)...`);
    try {
      const res = await fetch(`${API_URL}/api/claude-status`);
      const data = await res.json() as { status: string };
      if (data.status === 'authenticated') {
        console.log('[worker] Claude is back — resuming queue and clearing scan resumes_at');
        await clearPausedScansResumesAt();
        await resumeWorkerViaApi();
      } else {
        console.log(`[worker] Claude status: ${data.status} — staying paused`);
      }
    } catch (err) {
      console.log('[worker] Claude status check failed — staying paused:', err instanceof Error ? err.message : err);
    }
  }, RATE_LIMIT_CHECK_INTERVAL);
}

/**
 * Null out `resumes_at` on every paused scan. Called from the rate-limit probe
 * when Claude is reachable again — without this the poller would still wait for
 * each scan's API-reported reset time (which can be hours away even after the
 * actual blocker has cleared). Worker poll then re-acquires the scan on its
 * next tick (5s). If Claude is still limited on the actual retry, the scan will
 * just re-pause with a fresh `resumes_at` from the API.
 */
async function clearPausedScansResumesAt(): Promise<void> {
  try {
    const updated = await db.update(scans)
      .set({ resumesAt: null })
      .where(and(eq(scans.status, 'paused'), isNotNull(scans.resumesAt)))
      .returning({ id: scans.id });
    if (updated.length > 0) {
      console.log(`[worker] Cleared resumes_at on ${updated.length} paused scan(s) — will retry immediately`);
    }
  } catch (err) {
    console.error('[worker] Failed to clear paused scan resumes_at:', err instanceof Error ? err.message : err);
  }
}

export function stopScanWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (rateLimitCheckTimer) {
    clearInterval(rateLimitCheckTimer);
    rateLimitCheckTimer = null;
  }
  console.log('[worker] Scan worker stopped');
}
