-- "Completed with errors" terminal state for scans.
--
-- Design decision: scans.status has NO check constraint and every consumer
-- (repos joins, findings queries, worker resumable-scan queries, dashboard
-- status pills) matches on 'completed'/'failed'. Introducing a new status
-- value would require auditing every one of those matches, so instead the
-- scan stays status='completed' and gets:
--
--   * completed_with_errors — boolean flag distinguishing a clean success
--     from a scan where some security tools or AI Sniper modules failed
--     even after their end-of-step retry pass.
--   * step_errors — structured jsonb list of the surviving failures:
--     [{ kind: 'tool'|'module', name, error, failedAfterRetry }].
--
-- Both columns are additive with defaults, so existing rows read as clean
-- completions and no existing query changes behavior.

ALTER TABLE scans ADD COLUMN completed_with_errors boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE scans ADD COLUMN step_errors jsonb NOT NULL DEFAULT '[]'::jsonb;
