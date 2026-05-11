import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { scans, repositories, scanEvents, type Scan } from '../db/schema.ts';
import { runPipeline } from './pipeline.ts';
import { ScanPausedError } from './rate-limit.ts';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let rateLimitCheckTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL = Number(process.env.WORKER_POLL_INTERVAL_MS) || 5000;
const RATE_LIMIT_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes
let running = false;

const API_URL = process.env.API_SELF_URL || 'http://api:3000';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';

async function isWorkerPaused(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/worker-status`);
    const data = await res.json() as { paused: boolean };
    return data.paused;
  } catch { return false; }
}

async function resumeWorkerViaApi(): Promise<void> {
  await fetch(`${API_URL}/api/worker/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': INTERNAL_TOKEN },
    body: '{}',
  }).catch(() => {});
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
      const [updated] = await tx.update(scans)
        .set({ status: 'running', startedAt: new Date(), resumesAt: null })
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

    console.log(`[worker] Starting scan ${scanId} for ${scan.repoName}`);

    try {
      await runPipeline(scan);

      const durationMs = Date.now() - startTime;
      await db.update(scans)
        .set({
          status: 'completed',
          completedAt: new Date(),
          durationMs,
        })
        .where(eq(scans.id, scanId));

      if (scan.repositoryId) {
        await db.update(repositories)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(repositories.id, scan.repositoryId));
      }

      console.log(`[worker] Completed scan ${scanId} in ${durationMs}ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof ScanPausedError) {
        // Scan is recoverable: mark paused with resumes_at, do NOT mark failed,
        // do NOT re-queue. The poller will pick it up again once resumes_at passes.
        const resumesAt = err.resumesAt ? new Date(err.resumesAt) : null;
        await db.update(scans)
          .set({ status: 'paused', resumesAt, error: message })
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

      const durationMs = Date.now() - startTime;
      await db.update(scans)
        .set({
          status: 'failed',
          error: message,
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

  // Background check: when paused due to rate limit, ask API to check Claude every 10min
  rateLimitCheckTimer = setInterval(async () => {
    if (!(await isWorkerPaused())) return;
    console.log('[worker] Rate limit pause active — checking Claude status via API...');
    try {
      const res = await fetch(`${API_URL}/api/claude-status`);
      const data = await res.json() as { status: string };
      if (data.status === 'authenticated') {
        console.log('[worker] Claude is back — resuming queue');
        await resumeWorkerViaApi();
      } else {
        console.log(`[worker] Claude status: ${data.status} — staying paused`);
      }
    } catch (err) {
      console.log('[worker] Claude status check failed — staying paused:', err instanceof Error ? err.message : err);
    }
  }, RATE_LIMIT_CHECK_INTERVAL);
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
