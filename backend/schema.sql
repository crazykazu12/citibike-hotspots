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

-- Per-station 15-minute aggregates. Computed from raw_snapshots by the
-- aggregation cron (`*/15 * * * *`). Retained for 7 days.
-- activity_score = total_churn × destination_multiplier (1.0 / 0.3 / 0.1
-- depending on sign of net_inbound). Mirrors src/activity.ts on the frontend.
CREATE TABLE IF NOT EXISTS station_buckets (
  station_id TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,  -- Unix seconds, floor(t/900)*900 boundary
  activity_score REAL NOT NULL,
  bikes_in INTEGER NOT NULL,
  bikes_out INTEGER NOT NULL,
  PRIMARY KEY (station_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_station_buckets_bucket_start
  ON station_buckets(bucket_start);

-- Per-neighborhood 15-minute aggregates. Computed from station_buckets joined
-- with stations_neighborhoods. Retained for 7 days.
-- active_stations counts only stations with activity_score > 0 in this bucket.
-- total_capacity is the structural sum from stations_neighborhoods.capacity
-- regardless of activity in this bucket.
CREATE TABLE IF NOT EXISTS neighborhood_buckets (
  neighborhood_id TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  total_activity REAL NOT NULL,
  active_stations INTEGER NOT NULL,
  total_capacity INTEGER NOT NULL,
  PRIMARY KEY (neighborhood_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_neighborhood_buckets_bucket_start
  ON neighborhood_buckets(bucket_start);

-- Static-ish station→neighborhood mapping with capacity. Populated by
-- backend/scripts/populate-stations-neighborhoods.ts via point-in-polygon
-- against the NTA2020 GeoJSON. Re-run when stations are added/removed.
-- neighborhood_id is the GeoJSON nta2020 code (e.g. 'BK0101').
CREATE TABLE IF NOT EXISTS stations_neighborhoods (
  station_id TEXT PRIMARY KEY,
  neighborhood_id TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0
);

-- Cached station facts from GBFS station_information.json. Populated by the
-- same populator script that writes stations_neighborhoods. The /current and
-- /comparison API endpoints join through this table for lat/lon/name in
-- responses, so the frontend doesn't need to fetch GBFS directly.
-- NOTE: capacity is duplicated with stations_neighborhoods.capacity. Both are
-- written atomically by the populator so they can't drift; consolidating into
-- a single source of truth is a future cleanup.
CREATE TABLE IF NOT EXISTS station_info (
  station_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0
);
