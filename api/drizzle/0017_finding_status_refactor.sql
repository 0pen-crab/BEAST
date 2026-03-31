-- Refactor finding status: single `status` varchar as source of truth
-- Remove redundant boolean columns: active, risk_accepted, duplicate

-- Step 1: Drop old check constraint
ALTER TABLE findings DROP CONSTRAINT IF EXISTS chk_findings_status;

-- Step 2: Migrate data to status column
UPDATE findings SET status = 'duplicate' WHERE duplicate = true;
UPDATE findings SET status = 'open' WHERE status = 'active';
UPDATE findings SET status = 'fixed' WHERE status = 'mitigated';

-- Step 3: Add new check constraint with updated values
ALTER TABLE findings ADD CONSTRAINT chk_findings_status
  CHECK (status IN ('open', 'false_positive', 'fixed', 'risk_accepted', 'duplicate'));

-- Step 4: Drop the index that references `active` column
DROP INDEX IF EXISTS idx_findings_repository;

-- Step 5: Drop redundant boolean columns
ALTER TABLE findings DROP COLUMN IF EXISTS active;
ALTER TABLE findings DROP COLUMN IF EXISTS risk_accepted;
ALTER TABLE findings DROP COLUMN IF EXISTS duplicate;

-- Step 6: Recreate index without the boolean column
CREATE INDEX idx_findings_repository ON findings (repository_id);

-- Step 7: Set proper default
ALTER TABLE findings ALTER COLUMN status SET DEFAULT 'open';
