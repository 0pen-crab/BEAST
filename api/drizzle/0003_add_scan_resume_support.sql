-- Add resumes_at column for paused scans
ALTER TABLE scans ADD COLUMN resumes_at timestamptz;
CREATE INDEX idx_scans_resumes_at ON scans(resumes_at);

-- Per-module checkpoint table for AI Sniper resume
CREATE TABLE scan_modules (
  id            serial PRIMARY KEY,
  scan_id       uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  module_index  smallint NOT NULL,
  module_name   varchar(256) NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'pending',
  file_count    integer NOT NULL DEFAULT 0,
  output_path   text,
  error         text,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_scan_modules_scan_id ON scan_modules(scan_id);
CREATE UNIQUE INDEX uq_scan_modules_scan_idx ON scan_modules(scan_id, module_index);
