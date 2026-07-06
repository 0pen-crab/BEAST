// Cleanup of partial scan data after a terminal failure — SAFETY NET.
//
// Maintainer policy: "Все заливається тільки коли скан успішно завершився" —
// the database must only RETAIN scan-produced data from scans that completed
// successfully. Since the commit-step refactor, repo data (tests, findings,
// contributor stats/assessments) is written ONLY by the final 'commit' step,
// so a failure BEFORE commit should leave nothing for this cleanup to find:
//
//   - failure before commit → cleanup finds nothing (mid-scan writes are
//     gone by design). If it DOES delete something, a mid-scan write snuck
//     back in — that is an ANOMALY and screams as an error scan_event.
//   - failure DURING commit → the commit transaction rolled the scan-scoped
//     rows back; only post-transaction contributor-assessment rows (stamped
//     with this scan's execution_id) can remain, and cleanup removes them.
//     A worker crash mid-commit does NOT land here (the scan pauses and
//     resumes; the commit step itself wipes + re-commits idempotently).
//   - user cancellation AFTER commit committed but before the pipeline
//     finished → cleanup removes the committed rows (expected, warning).
//
// Deleted (rows this scan created), in FK-safe order:
//   1. findings attached to this scan's tests — finding_notes go along via
//      their ON DELETE CASCADE FK; duplicate_of self-references from surviving
//      findings are detached first (that FK has NO delete action).
//   2. tests of this scan.
//   3. contributor_assessments stamped with this scan's id in execution_id.
//
// Preserved on purpose — the diagnostic record of the failure must remain
// visible ("every error should scream"): the scans row itself, scan_events,
// scan_files (AI traces, logs, reports, raw tool outputs), scan_steps,
// scan_modules, scan_notes.
//
// Known limitations (documented, deliberately not handled):
//   - the commit step UPDATES dedup-matched findings from earlier scans
//     (severity/description refresh, triage status) while RE-PARENTING them
//     onto this scan's tests. Those updates cannot be rolled back here, and
//     the re-parented rows are deleted together with this scan's tests (their
//     previous test linkage is unrecoverable — leaving them would dangle on
//     deleted tests and cascade anyway). They are re-created as fresh findings
//     by the next successful scan; manual triage state on them is lost.
//   - contributors, contributor_repo_stats and contributor_daily_activity are
//     cross-scan aggregates upserted in place — not scan-scoped, not rolled back.
//   - contributor_assessments refreshed by the 6-month update path get this
//     scan's execution_id stamped on them, so deleting by execution_id removes
//     those too (their previous values were already overwritten).

import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { tests, findings, contributorAssessments, scanEvents, scanSteps } from '../db/schema.ts';

export interface CleanupFailedScanResult {
  findingsDeleted: number;
  testsDeleted: number;
  assessmentsDeleted: number;
}

/**
 * Did the 'commit' step of this scan ever start? Repo data may legitimately
 * exist only once commit is running/failed/completed — data found while
 * commit is still pending means a mid-scan write bypassed the policy.
 * Fails CLOSED to "started" so a broken lookup never turns a routine cleanup
 * into a false anomaly alarm.
 */
async function hasCommitStepStarted(scanId: string): Promise<boolean> {
  try {
    const rows = await db.select({ status: scanSteps.status })
      .from(scanSteps)
      .where(and(eq(scanSteps.scanId, scanId), eq(scanSteps.stepName, 'commit')));
    if (rows.length === 0) return false; // steps rows exist for any pipeline run
    return rows[0].status !== 'pending';
  } catch (err) {
    console.error(`[cleanup] Failed to check commit step status for ${scanId}:`, err instanceof Error ? err.message : err);
    return true;
  }
}

/**
 * Delete the partial repo data a failed scan left behind. Never throws —
 * cleanup runs inside the worker's failure path and must not mask the
 * original scan error; failures are screamed to console and scan_events.
 *
 * Must be called AFTER the scan row is marked 'failed' so the diagnostic
 * state stays consistent even if cleanup crashes mid-way. Must NEVER be
 * called for paused scans — they resume later and need their data.
 */
export async function cleanupFailedScanData(
  scanId: string,
  meta?: { repoName?: string | null; workspaceId?: number | null },
): Promise<CleanupFailedScanResult> {
  const result: CleanupFailedScanResult = {
    findingsDeleted: 0,
    testsDeleted: 0,
    assessmentsDeleted: 0,
  };

  try {
    const testRows = await db.select({ id: tests.id })
      .from(tests)
      .where(eq(tests.scanId, scanId));
    const testIds = testRows.map(r => r.id);

    if (testIds.length > 0) {
      const findingRows = await db.select({ id: findings.id })
        .from(findings)
        .where(inArray(findings.testId, testIds));
      const findingIds = findingRows.map(r => r.id);

      if (findingIds.length > 0) {
        // findings.duplicate_of is a self-FK with no ON DELETE action — a
        // surviving finding pointing at a row we are about to delete would
        // abort the whole delete. Detach those references first.
        await db.update(findings)
          .set({ duplicateOf: null })
          .where(inArray(findings.duplicateOf, findingIds));

        // finding_notes are removed by their ON DELETE CASCADE FK.
        const deletedFindings = await db.delete(findings)
          .where(inArray(findings.id, findingIds))
          .returning({ id: findings.id });
        result.findingsDeleted = deletedFindings.length;
      }

      const deletedTests = await db.delete(tests)
        .where(eq(tests.scanId, scanId))
        .returning({ id: tests.id });
      result.testsDeleted = deletedTests.length;
    }

    // Assessments created (or 6-month-refreshed) by this scan — ingest stamps
    // execution_id with the scan id (see ingestContributors).
    const deletedAssessments = await db.delete(contributorAssessments)
      .where(eq(contributorAssessments.executionId, scanId))
      .returning({ id: contributorAssessments.id });
    result.assessmentsDeleted = deletedAssessments.length;

    const total = result.findingsDeleted + result.testsDeleted + result.assessmentsDeleted;
    if (total > 0) {
      // Repo data is written only by the final 'commit' step. Finding data to
      // delete when commit NEVER STARTED means a mid-scan write snuck back in
      // — that's an anomaly that must scream, not a routine cleanup.
      const commitStarted = await hasCommitStepStarted(scanId);
      const counts = `${result.findingsDeleted} findings, ${result.testsDeleted} tests, ${result.assessmentsDeleted} assessments`;
      const level = commitStarted ? ('warning' as const) : ('error' as const);
      const message = commitStarted
        ? `Removed results of failed scan (commit step had started): ${counts}`
        : `ANOMALY: removed pre-commit repo data of failed scan — a mid-scan write bypassed the commit step: ${counts}`;
      if (commitStarted) {
        console.log(`[cleanup] ${message} (scan ${scanId})`);
      } else {
        console.error(`[cleanup] ${message} (scan ${scanId})`);
      }
      try {
        await db.insert(scanEvents).values({
          scanId,
          level,
          source: 'cleanup',
          message,
          details: { ...result, commitStarted },
          repoName: meta?.repoName ?? null,
          workspaceId: meta?.workspaceId ?? null,
        });
      } catch (eventErr) {
        console.error(`[cleanup] Failed to log cleanup event for ${scanId}:`, eventErr instanceof Error ? eventErr.message : eventErr);
      }
    } else {
      console.log(`[cleanup] No partial results to remove for failed scan ${scanId}`);
    }
  } catch (err) {
    // Cleanup failure must not mask the original scan error — scream and return.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cleanup] Failed to remove partial data of failed scan ${scanId}:`, message);
    try {
      await db.insert(scanEvents).values({
        scanId,
        level: 'error',
        source: 'cleanup',
        message: `Cleanup of failed scan data crashed: ${message}`,
        details: { ...result, stack: err instanceof Error ? err.stack : null },
        repoName: meta?.repoName ?? null,
        workspaceId: meta?.workspaceId ?? null,
      });
    } catch (eventErr) {
      console.error(`[cleanup] Failed to log cleanup failure event for ${scanId}:`, eventErr instanceof Error ? eventErr.message : eventErr);
    }
  }

  return result;
}
