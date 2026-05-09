# where-in-the-citi-backend

Cloudflare Worker that polls the NYC Citi Bike GBFS feed every minute and writes
raw station snapshots into a D1 database. The frontend (in the parent repo's
`src/`) currently fetches GBFS directly; this backend will replace that path
once the API endpoints land in Session 3.

## Stack

- **Cloudflare Workers** — scheduled (cron) execution
- **D1** — SQLite-compatible serverless database
- **Wrangler** — Cloudflare's CLI for local dev + deploy

## What this Worker does

- Cron `* * * * *` (every minute): fetch `station_status.json`, write ~2300 rows
  to `raw_snapshots` via a single batched transaction.
- Cron `*/15 * * * *` (every 15 min): aggregate the just-completed 15-minute
  bucket of `raw_snapshots` into `station_buckets` (per-station activity score)
  and `neighborhood_buckets` (per-NTA totals). Activity formula matches the
  frontend's `src/activity.ts` (total_churn × destination_multiplier).
- Cron `0 3 * * *` (daily, 03:00 UTC): delete `raw_snapshots` older than 24h
  and `*_buckets` older than 7 days.

## Local development

```bash
npm install

# One-time: log in, create the D1 database, fill in database_id in wrangler.toml
wrangler login
wrangler d1 create where-in-the-citi-data
# → paste the printed database_id into wrangler.toml under [[d1_databases]]

# Apply schema to the remote DB
npm run db:schema

# One-time-ish: populate the station→neighborhood mapping table from the
# current GBFS station_information feed and the NYC NTA GeoJSON. Re-run
# whenever the station network changes meaningfully.
npm run setup:stations

# Run the Worker locally; visit /__scheduled?cron=*+*+*+*+* to fire the poll cron
npm run dev
```

## Deploy

```bash
npm run deploy
```

Crons fire automatically once deployed. Monitor with `npm run tail`.

## Inspect the database

```bash
# Total row count + min/max timestamps
npm run db:count

# Anything ad-hoc
wrangler d1 execute where-in-the-citi-data --remote \
  --command="SELECT captured_at, COUNT(*) FROM raw_snapshots GROUP BY captured_at ORDER BY captured_at DESC LIMIT 10"
```

## Logs

```bash
npm run tail
```

Each poll logs `poll ok captured_at=<unix> stations=<n> written=<n>`. Cleanup
logs `cleanup ok cutoff=<unix> deleted=<n>`.

## File layout

```
backend/
  src/
    index.ts        — scheduled() entry; dispatches by cron string
    gbfs.ts         — fetchSnapshotRows(capturedAt)
    db.ts           — insertSnapshots(), runRetentionCleanup()
    aggregation.ts  — bucketStartFor(), computeStationBuckets(), runAggregation()
  scripts/
    populate-stations-neighborhoods.ts  — one-time-ish: stations→NTA mapping
  data/
    nyc-neighborhoods.geojson           — NYC NTA2020 polygons (synced from
                                          frontend's public/data/)
  schema.sql        — raw_snapshots, station_buckets, neighborhood_buckets,
                      stations_neighborhoods (with capacity)
  wrangler.toml     — Worker name, three crons, D1 binding
```
