-- Drop artifacts of removed features that 0000_init.sql still creates but
-- schema.ts no longer knows about. Running databases already have them, so
-- history is left untouched and the cleanup happens forward-only.
--
--   * pull_requests table (+ its indexes/constraints, dropped via CASCADE)
--   * scans.pull_request_id
--   * sources.webhook_id
--   * sources.pr_comments_enabled
--
-- Also aligns sources.sync_interval_minutes DEFAULT with schema.ts:
-- 0000_init.sql said DEFAULT 60, schema.ts says .default(1440).

DROP TABLE IF EXISTS pull_requests CASCADE;
--> statement-breakpoint
ALTER TABLE scans DROP COLUMN IF EXISTS pull_request_id;
--> statement-breakpoint
ALTER TABLE sources DROP COLUMN IF EXISTS webhook_id;
--> statement-breakpoint
ALTER TABLE sources DROP COLUMN IF EXISTS pr_comments_enabled;
--> statement-breakpoint
ALTER TABLE sources ALTER COLUMN sync_interval_minutes SET DEFAULT 1440;
