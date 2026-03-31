import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './db/index.ts';
import { startScanWorker, stopScanWorker } from './orchestrator/worker.ts';
import { startSyncWorker, stopSyncWorker } from './orchestrator/sync-worker.ts';
import { startFeedbackWorker, stopFeedbackWorker } from './orchestrator/feedback-worker.ts';

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

  await startScanWorker();
  startSyncWorker();
  startFeedbackWorker();

  console.log('[worker-main] All workers running.');
}

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[worker-main] Received ${signal}, shutting down...`);
  stopScanWorker();
  stopSyncWorker();
  stopFeedbackWorker();
  // Give in-flight SSH commands a moment to settle
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  console.error('[worker-main] Fatal error:', err);
  process.exit(1);
});
