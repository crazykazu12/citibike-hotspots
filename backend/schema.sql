-- Raw GBFS station_status snapshots, written by the Worker every minute.
-- Retention is 24 hours (older rows are deleted nightly at 03:00 UTC).
-- Aggregated 15-minute and per-neighborhood buckets land in separate tables
-- in Session 2.

CREATE TABLE IF NOT EXISTS raw_snapshots (
  station_id TEXT NOT NULL,
  captured_at INTEGER NOT NULL,  -- Unix seconds, set by the Worker (NOT GBFS last_reported)
  bikes_available INTEGER NOT NULL,
  docks_available INTEGER NOT NULL,
  PRIMARY KEY (station_id, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_raw_snapshots_captured_at
  ON raw_snapshots(captured_at);
