// 15-minute bucket aggregation: walks raw_snapshots in [bucket_start,
// bucket_start+900) for the just-completed bucket, computes per-station
// activity scores using the same formula as src/activity.ts on the frontend,
// and writes to station_buckets + neighborhood_buckets.
//
// Re-running for the same bucket is safe: INSERT OR REPLACE on both targets.
// Empty buckets (no source rows) are skipped without writing anything.

const BUCKET_SECONDS = 900

// Mirrors src/activity.ts. Keep these constants in lockstep with the frontend.
const DEST_MULT_POSITIVE = 1.0
const DEST_MULT_ZERO = 0.3
const DEST_MULT_NEGATIVE = 0.1

interface SnapshotRow {
  station_id: string
  captured_at: number
  bikes_available: number
}

export interface StationBucketRow {
  station_id: string
  bucket_start: number
  activity_score: number
  bikes_in: number
  bikes_out: number
}

export function bucketStartFor(nowSeconds: number): number {
  return Math.floor(nowSeconds / BUCKET_SECONDS) * BUCKET_SECONDS - BUCKET_SECONDS
}

export function computeStationBuckets(
  rows: SnapshotRow[],
  bucketStart: number,
): StationBucketRow[] {
  // Rows arrive sorted by (station_id, captured_at) from the SQL ORDER BY.
  const out: StationBucketRow[] = []
  let curStation: string | null = null
  let prevBikes = 0
  let totalChurn = 0
  let netInbound = 0
  let bikesIn = 0
  let bikesOut = 0
  let hasDeltas = false

  function emit() {
    if (curStation === null || !hasDeltas) return
    const mult =
      netInbound > 0
        ? DEST_MULT_POSITIVE
        : netInbound < 0
          ? DEST_MULT_NEGATIVE
          : DEST_MULT_ZERO
    out.push({
      station_id: curStation,
      bucket_start: bucketStart,
      activity_score: totalChurn * mult,
      bikes_in: bikesIn,
      bikes_out: bikesOut,
    })
  }

  for (const row of rows) {
    if (row.station_id !== curStation) {
      emit()
      curStation = row.station_id
      prevBikes = row.bikes_available
      totalChurn = 0
      netInbound = 0
      bikesIn = 0
      bikesOut = 0
      hasDeltas = false
    } else {
      const delta = row.bikes_available - prevBikes
      totalChurn += Math.abs(delta)
      netInbound += delta
      if (delta > 0) bikesIn += delta
      else if (delta < 0) bikesOut += -delta
      prevBikes = row.bikes_available
      hasDeltas = true
    }
  }
  emit()
  return out
}

const STATION_BUCKET_INSERT =
  'INSERT OR REPLACE INTO station_buckets (station_id, bucket_start, activity_score, bikes_in, bikes_out) VALUES (?, ?, ?, ?, ?)'

const NEIGHBORHOOD_AGGREGATE_SQL = `
INSERT OR REPLACE INTO neighborhood_buckets
  (neighborhood_id, bucket_start, total_activity, active_stations, total_capacity)
SELECT
  sn.neighborhood_id,
  ?1                                                                                  AS bucket_start,
  COALESCE(SUM(sb.activity_score), 0)                                                 AS total_activity,
  COALESCE(SUM(CASE WHEN sb.activity_score > 0 THEN 1 ELSE 0 END), 0)                 AS active_stations,
  COALESCE(SUM(sn.capacity), 0)                                                       AS total_capacity
FROM stations_neighborhoods sn
LEFT JOIN station_buckets sb
  ON sb.station_id = sn.station_id
  AND sb.bucket_start = ?1
GROUP BY sn.neighborhood_id
`

export async function runAggregation(db: D1Database, nowSeconds: number): Promise<void> {
  const bucketStart = bucketStartFor(nowSeconds)
  const bucketEnd = bucketStart + BUCKET_SECONDS

  const sourceRes = await db
    .prepare(
      'SELECT station_id, captured_at, bikes_available FROM raw_snapshots WHERE captured_at >= ? AND captured_at < ? ORDER BY station_id, captured_at',
    )
    .bind(bucketStart, bucketEnd)
    .all<SnapshotRow>()

  const sourceRows = sourceRes.results ?? []
  if (sourceRows.length === 0) {
    console.warn(`aggregation skipped: empty bucket bucket_start=${bucketStart}`)
    return
  }

  const stationBuckets = computeStationBuckets(sourceRows, bucketStart)

  if (stationBuckets.length === 0) {
    console.warn(
      `aggregation skipped: source rows existed but no station produced deltas bucket_start=${bucketStart} source_rows=${sourceRows.length}`,
    )
    return
  }

  const stmt = db.prepare(STATION_BUCKET_INSERT)
  await db.batch(
    stationBuckets.map((s) =>
      stmt.bind(s.station_id, s.bucket_start, s.activity_score, s.bikes_in, s.bikes_out),
    ),
  )

  const nbhRes = await db.prepare(NEIGHBORHOOD_AGGREGATE_SQL).bind(bucketStart).run()

  console.log(
    `aggregation ok bucket_start=${bucketStart} source_rows=${sourceRows.length} station_buckets=${stationBuckets.length} neighborhood_rows=${nbhRes.meta.changes ?? '?'}`,
  )
}
