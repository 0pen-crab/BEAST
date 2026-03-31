-- 1. Create scan_steps table
CREATE TABLE IF NOT EXISTS scan_steps (
  id            SERIAL PRIMARY KEY,
  scan_id       UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  step_name     VARCHAR(50) NOT NULL,
  step_order    SMALLINT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  input         JSONB,
  output        JSONB,
  error         TEXT,
  artifacts_path VARCHAR(500),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scan_steps_scan_id ON scan_steps(scan_id);

-- 2. Modify scan_events: add scan_id FK, step_name; migrate execution_id data; drop execution_id
ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS scan_id UUID;
ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS step_name VARCHAR(50);

-- Backfill scan_id from execution_id (existing values are UUIDs)
UPDATE scan_events SET scan_id = execution_id::uuid
  WHERE execution_id IS NOT NULL
  AND scan_id IS NULL
  AND execution_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Null out scan_ids that don't reference existing scans
UPDATE scan_events SET scan_id = NULL
  WHERE scan_id IS NOT NULL
  AND scan_id NOT IN (SELECT id FROM scans);

-- Add FK constraint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_scan_events_scan_id') THEN
    ALTER TABLE scan_events ADD CONSTRAINT fk_scan_events_scan_id
      FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE scan_events DROP COLUMN IF EXISTS execution_id;

-- Drop the old execution index (if exists)
DROP INDEX IF EXISTS idx_scan_events_execution;
-- Add new scan_id index
CREATE INDEX IF NOT EXISTS idx_scan_events_scan_id ON scan_events(scan_id);

-- 3. Modify scans: drop old columns, add duration_ms
ALTER TABLE scans DROP COLUMN IF EXISTS steps;
ALTER TABLE scans DROP COLUMN IF EXISTS current_step;
ALTER TABLE scans DROP COLUMN IF EXISTS job_id;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
