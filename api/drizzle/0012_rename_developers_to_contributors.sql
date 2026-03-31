-- Rename developers to contributors
ALTER TABLE "developers" RENAME TO "contributors";
ALTER TABLE "developer_repo_stats" RENAME TO "contributor_repo_stats";
ALTER TABLE "developer_daily_activity" RENAME TO "contributor_daily_activity";
ALTER TABLE "developer_assessments" RENAME TO "contributor_assessments";

-- Rename developer_id columns
ALTER TABLE "contributor_repo_stats" RENAME COLUMN "developer_id" TO "contributor_id";
ALTER TABLE "contributor_daily_activity" RENAME COLUMN "developer_id" TO "contributor_id";
ALTER TABLE "contributor_assessments" RENAME COLUMN "developer_id" TO "contributor_id";

-- Rename indexes
ALTER INDEX "idx_developers_score" RENAME TO "idx_contributors_score";
ALTER INDEX "idx_dev_repo_stats_dev" RENAME TO "idx_contrib_repo_stats_contrib";
ALTER INDEX "idx_dev_daily_dev" RENAME TO "idx_contrib_daily_contrib";
ALTER INDEX "idx_dev_assessments_dev" RENAME TO "idx_contrib_assessments_contrib";

-- Rename unique constraints
ALTER TABLE "contributor_repo_stats" RENAME CONSTRAINT "developer_repo_stats_developer_id_repo_name_unique" TO "contributor_repo_stats_contributor_id_repo_name_unique";
ALTER TABLE "contributor_daily_activity" RENAME CONSTRAINT "developer_daily_activity_dev_repo_date_unique" TO "contributor_daily_activity_contrib_repo_date_unique";
ALTER TABLE "contributor_assessments" RENAME CONSTRAINT "developer_assessments_dev_repo_unique" TO "contributor_assessments_contrib_repo_unique";
