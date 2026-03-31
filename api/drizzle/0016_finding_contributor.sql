ALTER TABLE findings ADD COLUMN contributor_id INTEGER REFERENCES contributors(id) ON DELETE SET NULL;
CREATE INDEX idx_findings_contributor_id ON findings(contributor_id);
