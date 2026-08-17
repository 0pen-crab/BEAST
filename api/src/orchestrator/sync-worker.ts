import { or, isNull, sql, lt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { sources } from '../db/schema.ts';
import { syncSource } from './git-sync.ts';
import { getSource, updateSource } from './entities.ts';
import { tryCreateWorkspaceEvent } from './events.ts';

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SYNC_FAIL_THRESHOLD = 3;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function checkSyncs() {
  if (running) return;
  running = true;

  try {
    const rows = await db.select({ id: sources.id })
      .from(sources)
      .where(
        sql`${sources.syncFailCount} < ${SYNC_FAIL_THRESHOLD}
            AND (${sources.lastSyncedAt} IS NULL
                 OR ${sources.lastSyncedAt} + (${sources.syncIntervalMinutes} || ' minutes')::interval < NOW())`,
      );

    for (const row of rows) {
      try {
        console.log(`[sync] Syncing source ${row.id}`);
        const syncResult = await syncSource(row.id);
        console.log(`[sync] Source ${row.id}: +${syncResult.added} repos, ~${syncResult.updated} updated`);
        await updateSource(row.id, { syncFailCount: 0 });
      } catch (err: any) {
        console.error(`[sync] Source ${row.id} failed:`, err.message);
        try {
          const source = await getSource(row.id);
          if (!source) continue;

          const newFailCount = (source.syncFailCount ?? 0) + 1;
          await updateSource(row.id, {
            lastSyncedAt: new Date().toISOString(),
            syncFailCount: newFailCount,
          });

          if (newFailCount >= SYNC_FAIL_THRESHOLD) {
            console.warn(`[sync] Source ${row.id} paused after ${newFailCount} consecutive failures`);
            await tryCreateWorkspaceEvent(source.workspaceId, 'sync_paused', {
              source_id: row.id,
              provider: source.provider,
              org_name: source.orgName,
              error: err.message,
              fail_count: newFailCount,
            });
          } else {
            await tryCreateWorkspaceEvent(source.workspaceId, 'sync_failed', {
              source_id: row.id,
              provider: source.provider,
              org_name: source.orgName,
              error: err.message,
            });
          }
        } catch (eventErr) {
          console.error(`[sync] Failed to record sync failure for source ${row.id}:`, eventErr instanceof Error ? eventErr.message : eventErr);
        }
      }
    }
  } catch (err) {
    console.error('[sync] Poll error:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startSyncWorker() {
  if (timer) return;
  timer = setInterval(checkSyncs, POLL_INTERVAL);
  console.log(`[sync] Source sync worker started (every ${POLL_INTERVAL / 60_000} min)`);
}

export function stopSyncWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[sync] Source sync worker stopped');
  }
}
