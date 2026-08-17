import { db } from '../db/index.ts';
import { scanEvents } from '../db/schema.ts';
import { sanitizeForDb, truncateEventMessage } from '../lib/sanitize.ts';
import { createWorkspaceEvent } from './entities.ts';

/**
 * Central helpers for surfacing errors to the Events feeds (scan_events /
 * workspace_events). Standalone module (not pipeline.ts) so step files can
 * import it without a circular dependency — this used to be copy-pasted into
 * every step for exactly that reason.
 *
 * Both helpers NEVER throw: writing an event must not crash the operation
 * being reported. A failed event write screams to the worker log — the only
 * channel left when the DB itself can't be written (and /api/health surfaces
 * a down DB separately).
 */

export async function logScanEvent(
  scanId: string | null,
  stepName: string | null,
  level: 'info' | 'warning' | 'error',
  message: string,
  details?: Record<string, unknown>,
  repoName?: string,
  workspaceId?: number | null,
): Promise<void> {
  try {
    await db.insert(scanEvents).values({
      scanId,
      stepName,
      level,
      source: stepName ?? 'pipeline',
      // NUL-stripped AND capped at 4KB — a legacy step error once landed a
      // ~10MB message here, and event lists serialize messages inline.
      message: truncateEventMessage(message),
      details: sanitizeForDb(details ?? {}),
      repoName: repoName ?? null,
      workspaceId: workspaceId ?? null,
    });
  } catch (err) {
    console.error(`[events] Failed to log scan event for ${scanId}: ${message}`, err instanceof Error ? err.message : err);
  }
}

export async function tryCreateWorkspaceEvent(
  workspaceId: number,
  eventType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await createWorkspaceEvent(workspaceId, eventType, payload);
  } catch (err) {
    console.error(`[events] Failed to create workspace event ${eventType} for workspace ${workspaceId}:`, err instanceof Error ? err.message : err);
  }
}
