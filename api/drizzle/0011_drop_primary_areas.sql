-- Remove unused primary_areas column from developer_repo_stats
ALTER TABLE "developer_repo_stats" DROP COLUMN IF EXISTS "primary_areas";
