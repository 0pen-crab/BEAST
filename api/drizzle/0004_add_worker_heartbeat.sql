-- Worker liveness heartbeat — a single row (id = 1) upserted by the worker
-- process roughly every minute. /api/health reads it and reports the worker
-- as down when the beat is older than ~3 minutes.
CREATE TABLE worker_heartbeat (
  id       integer PRIMARY KEY,
  beat_at  timestamptz NOT NULL DEFAULT now()
);
