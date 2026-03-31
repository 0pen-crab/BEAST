-- Add feedback columns and unique constraint for developer assessments

ALTER TABLE developers ADD COLUMN IF NOT EXISTS feedback text;

ALTER TABLE developer_assessments ADD COLUMN IF NOT EXISTS feedback text;

-- One assessment per developer per repo (enforced at DB level)
-- Drop duplicates first (keep the latest one per developer+repo pair)
DELETE FROM developer_assessments a
  USING developer_assessments b
  WHERE a.developer_id = b.developer_id
    AND a.repo_name = b.repo_name
    AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS developer_assessments_dev_repo_unique
  ON developer_assessments (developer_id, repo_name);
