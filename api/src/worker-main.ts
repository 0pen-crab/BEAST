import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { installCrashHandlers } from './app.ts';
import { db } from './db/index.ts';
import { startScanWorker, stopScanWorker } from './orchestrator/worker.ts';
import { startSyncWorker, stopSyncWorker } from './orchestrator/sync-worker.ts';
import { startFeedbackWorker, stopFeedbackWorker } from './orchestrator/feedback-worker.ts';
import { startWorkerHeartbeat, stopWorkerHeartbeat } from './orchestrator/heartbeat.ts';
import { startRetentionSweeper, stopRetentionSweeper } from './orchestrator/retention.ts';
import { runInfraCheck } from './orchestrator/infra-check.ts';

// A stray rejection inside a worker setInterval must crash loudly (docker
// restarts the worker), never zombify it silently.
installCrashHandlers();

async function main() {
  console.log('[worker-main] Starting BEAST workers...');

  // Run migrations (same as API — ensures schema is up to date)
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
  } catch (err: any) {
    if (err?.cause?.code === '42P07') {
      console.log('[worker-main] Tables already exist, skipping initial migration');
    } else {
      throw err;
    }
  }

  // Boot-time infra connectivity check. Failure is logged to console + scan_events
  // (Events tab) so a broken SCANNER_SSH_PUBKEY surfaces immediately instead of
  // poisoning every scan with "All configured authentication methods failed".
  await runInfraCheck();

  // Liveness signal for /api/health — upserts worker_heartbeat every minute.
  // beatOnce never throws, so this can't crash the worker.
  startWorkerHeartbeat();

  await startScanWorker();
  startSyncWorker();
  startFeedbackWorker();

  // Daily retention sweep (90-day work-dir + heavy scan_files cleanup).
  // First run ~5 min after boot; runRetentionSweep never throws.
  startRetentionSweeper();

  console.log('[worker-main] All workers running.');
}

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[worker-main] Received ${signal}, shutting down...`);
  stopScanWorker();
  stopSyncWorker();
  stopFeedbackWorker();
  stopWorkerHeartbeat();
  stopRetentionSweeper();
  // Give in-flight SSH commands a moment to settle
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  console.error('[worker-main] Fatal error:', err);
  process.exit(1);
});
