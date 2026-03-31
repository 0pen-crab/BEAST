-- Add repo_name column to developer_daily_activity
-- Makes activity unique per (developer, repo, date) instead of (developer, date)
-- Rescanning same repo replaces counts; different repos accumulate independently

ALTER TABLE "developer_daily_activity" ADD COLUMN "repo_name" varchar(256);

-- Backfill existing rows with 'unknown' so we can make NOT NULL
UPDATE "developer_daily_activity" SET "repo_name" = 'unknown' WHERE "repo_name" IS NULL;

ALTER TABLE "developer_daily_activity" ALTER COLUMN "repo_name" SET NOT NULL;

-- Drop old unique constraint and create new one
ALTER TABLE "developer_daily_activity"
  DROP CONSTRAINT IF EXISTS "developer_daily_activity_developer_id_activity_date_unique";

ALTER TABLE "developer_daily_activity"
  ADD CONSTRAINT "developer_daily_activity_dev_repo_date_unique"
  UNIQUE ("developer_id", "repo_name", "activity_date");
