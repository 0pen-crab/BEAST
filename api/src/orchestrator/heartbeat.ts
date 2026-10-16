import { db } from '../db/index.ts';
import { workerHeartbeat } from '../db/schema.ts';

/**
 * Worker liveness heartbeat.
 *
 * The worker process runs as a separate docker service with no HTTP surface,
 * so the API can't probe it directly. Instead the worker upserts a single row
 * (id = 1) in `worker_heartbeat` every minute; /api/health reports the worker
 * as down when that beat is older than ~3 minutes (3 missed beats).
 */

export const HEARTBEAT_INTERVAL_MS = 60_000;
export const HEARTBEAT_ROW_ID = 1;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Write one heartbeat. NEVER throws — liveness reporting must not take the
 * worker down (worker-main installs crash-on-unhandled-rejection handlers),
 * but failures are screamed to the console so a broken heartbeat is visible.
 */
export async function beatOnce(): Promise<void> {
  try {
    const now = new Date();
    await db.insert(workerHeartbeat)
      .values({ id: HEARTBEAT_ROW_ID, beatAt: now })
      .onConflictDoUpdate({ target: workerHeartbeat.id, set: { beatAt: now } });
  } catch (err) {
    console.error('[heartbeat] Failed to write worker heartbeat:', err instanceof Error ? err.message : err);
  }
}

export function startWorkerHeartbeat(): void {
  if (heartbeatTimer) return;
  void beatOnce(); // first beat right away so health goes green on worker boot
  heartbeatTimer = setInterval(() => { void beatOnce(); }, HEARTBEAT_INTERVAL_MS);
  console.log(`[heartbeat] Worker heartbeat started (every ${HEARTBEAT_INTERVAL_MS / 1000}s)`);
}

export function stopWorkerHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('[heartbeat] Worker heartbeat stopped');
  }
}
