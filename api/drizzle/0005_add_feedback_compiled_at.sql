-- Timestamp of the last successful compiled-profile write for a contributor
-- (set by the feedback worker in compileFeedback, both write paths).
-- Used by restart recovery: on boot the worker re-queues contributors whose
-- newest assessment (max contributor_assessments.assessed_at) is newer than
-- coalesce(feedback_compiled_at, epoch). NULL = profile never compiled.
-- NOTE: contributors.updated_at is NOT usable for this — it is bumped by
-- unrelated writes (score recomputation, team assignment).
ALTER TABLE contributors ADD COLUMN feedback_compiled_at timestamptz;

-- Backfill: contributors that already have compiled feedback text were
-- compiled at some point in the past — stamp them (updated_at is the best
-- available approximation) so the first post-deploy recovery run does NOT
-- re-queue every existing profile into pointless Claude recompilations.
-- Only truly never-compiled profiles (feedback IS NULL) stay NULL.
UPDATE contributors SET feedback_compiled_at = updated_at WHERE feedback IS NOT NULL;
