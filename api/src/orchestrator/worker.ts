import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { scans, repositories, scanEvents, type Scan } from '../db/schema.ts';
import { runPipeline } from './pipeline.ts';

let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL = Number(process.env.WORKER_POLL_INTERVAL_MS) || 5000;
let running = false;

export async function pollForWork(): Promise<void> {
  if (running) return; // one scan at a time
  running = true;
  let picked: Scan | null = null;

  try {
    // Transaction: pick a queued scan + mark it running atomically
    // We use raw SQL for the FOR UPDATE SKIP LOCKED, then use Drizzle for the update
    await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id FROM scans
        WHERE status = 'queued'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);

      if (!rows.length) return;
      const scanId = (rows[0] as any).id as string;

      // Mark as running
      const [updated] = await tx.update(scans)
        .set({ status: 'running', startedAt: new Date() })
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

      // Log pipeline failure as a scan event
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

  // Recovery: fail any scans stuck in 'running' from a previous crash
  const stuck = await db.update(scans)
    .set({ status: 'failed', error: 'Worker restarted while scan was running', completedAt: new Date() })
    .where(eq(scans.status, 'running'))
    .returning({ id: scans.id, repoName: scans.repoName, repositoryId: scans.repositoryId, workspaceId: scans.workspaceId });

  if (stuck.length > 0) {
    console.log(`[worker] Recovered ${stuck.length} stuck scan(s): ${stuck.map(s => s.repoName).join(', ')}`);
    for (const s of stuck) {
      if (s.repositoryId) {
        await db.update(repositories)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(repositories.id, s.repositoryId));
      }
      await db.insert(scanEvents).values({
        scanId: s.id,
        level: 'error',
        source: 'pipeline',
        message: `Pipeline failed: Worker restarted while scan was running`,
        repoName: s.repoName,
        workspaceId: s.workspaceId,
      });
    }
  }

  pollTimer = setInterval(pollForWork, POLL_INTERVAL);
  console.log(`[worker] DB-driven scan worker started (poll every ${POLL_INTERVAL}ms)`);
}

export function stopScanWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[worker] Scan worker stopped');
  }
}
