-- Record WHEN a finding was introduced, not just when a scan found it.
--
-- Triage already runs `git blame` on every 'keep' finding to attribute it to a
-- contributor, but the prompt only let it return the email and name — the
-- commit hash and author date were thrown away. So "who introduced this" was
-- answerable and "when was it introduced" was not: the only date on a finding
-- was created_at, the moment the pipeline imported it. A secret committed in
-- 2019 and first scanned yesterday looked a day old, and the finding page
-- rendered that date right next to the blamed contributor's name, which read
-- as "they committed it then".
--
-- NULL means blame produced nothing for that finding (binary/generated file,
-- unreachable history, or a finding triage never blamed) — never "committed
-- at the epoch".
ALTER TABLE findings ADD COLUMN IF NOT EXISTS commit_hash VARCHAR(64);
--> statement-breakpoint
ALTER TABLE findings ADD COLUMN IF NOT EXISTS commit_date TIMESTAMP WITH TIME ZONE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_findings_commit_date ON findings (commit_date);
