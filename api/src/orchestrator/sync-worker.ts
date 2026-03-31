import { or, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { sources } from '../db/schema.ts';
import { syncSource } from './git-sync.ts';
import { createWorkspaceEvent, getSource, updateSource } from './entities.ts';

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function checkSyncs() {
  if (running) return;
  running = true;

  try {
    const rows = await db.select({ id: sources.id })
      .from(sources)
      .where(
        or(
          isNull(sources.lastSyncedAt),
          sql`${sources.lastSyncedAt} + (${sources.syncIntervalMinutes} || ' minutes')::interval < NOW()`,
        ),
      );

    for (const row of rows) {
      try {
        console.log(`[sync] Syncing source ${row.id}`);
        const syncResult = await syncSource(row.id);
        console.log(`[sync] Source ${row.id}: +${syncResult.added} repos, ~${syncResult.updated} updated`);
      } catch (err: any) {
        console.error(`[sync] Source ${row.id} failed:`, err.message);
        try {
          // Update lastSyncedAt even on failure so the source backs off
          // for its full sync_interval instead of retrying every poll cycle
          await updateSource(row.id, { lastSyncedAt: new Date().toISOString() });

          const source = await getSource(row.id);
          if (source) {
            await createWorkspaceEvent(source.workspaceId, 'sync_failed', {
              source_id: row.id,
              provider: source.provider,
              org_name: source.orgName,
              error: err.message,
            });
          }
        } catch (eventErr) {
          console.error(`[sync] Failed to create workspace event for source ${row.id}:`, eventErr instanceof Error ? eventErr.message : eventErr);
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
