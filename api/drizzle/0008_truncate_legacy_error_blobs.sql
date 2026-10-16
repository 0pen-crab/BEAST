-- Truncate LEGACY multi-megabyte text blobs that predate the write-side caps.
--
-- New writes are already bounded: scans.error goes through sanitizeScanError
-- (8KB cap, drizzle params dump removed) and scan_events.message through
-- truncateEventMessage (4KB cap). But rows written BEFORE those caps still
-- carry the original blobs — one legacy failed scan holds a ~10MB error that
-- alone made GET /api/scans?limit=10 a 10.5MB response and froze the
-- dashboard renderer for 30–60s on every navigation/poll.
--
-- Thresholds sit slightly ABOVE the write-side caps (8200/4200) so rows the
-- app itself capped (8000/4000 + truncation suffix) are left untouched and
-- the migration stays idempotent.

UPDATE scans
SET error = left(error, 8000) || '… (truncated by migration 0008)'
WHERE length(error) > 8200;
--> statement-breakpoint
UPDATE scan_events
SET message = left(message, 4000) || '…'
WHERE length(message) > 4200;
