import type { SnapshotRow } from './gbfs'

const INSERT_SQL =
  'INSERT OR IGNORE INTO raw_snapshots (station_id, captured_at, bikes_available, docks_available) VALUES (?, ?, ?, ?)'

export async function insertSnapshots(db: D1Database, rows: SnapshotRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const stmt = db.prepare(INSERT_SQL)
  const batch = rows.map((r) =>
    stmt.bind(r.station_id, r.captured_at, r.bikes_available, r.docks_available),
  )
  await db.batch(batch)
  return rows.length
}

// Returns the most-recent stored bikes_available per station. Used by the
// poll handler to filter incoming rows down to ones whose value actually
// changed — drops ~92% of writes vs naively inserting every poll.
//
// Uses SQLite's "bare columns with MAX()" behavior: when a query has MAX()
// in its SELECT, SQLite returns other column values from the row that
// produced the maximum. Officially documented for MIN/MAX aggregates only.
export async function fetchLastBikesPerStation(db: D1Database): Promise<Map<string, number>> {
  const res = await db
    .prepare(
      'SELECT station_id, bikes_available, MAX(captured_at) AS captured_at FROM raw_snapshots GROUP BY station_id',
    )
    .all<{ station_id: string; bikes_available: number; captured_at: number }>()
  const map = new Map<string, number>()
  for (const r of res.results ?? []) map.set(r.station_id, r.bikes_available)
  return map
}

export async function deleteOlderThan(db: D1Database, cutoffSeconds: number): Promise<number> {
  const result = await db
    .prepare('DELETE FROM raw_snapshots WHERE captured_at < ?')
    .bind(cutoffSeconds)
    .run()
  return result.meta.changes ?? 0
}

export interface CleanupResult {
  rawSnapshotsDeleted: number
  stationBucketsDeleted: number
  neighborhoodBucketsDeleted: number
}

export async function runRetentionCleanup(
  db: D1Database,
  nowSeconds: number,
): Promise<CleanupResult> {
  const rawCutoff = nowSeconds - 24 * 3600
  const bucketCutoff = nowSeconds - 7 * 24 * 3600

  const [raw, sb, nb] = await db.batch([
    db.prepare('DELETE FROM raw_snapshots WHERE captured_at < ?').bind(rawCutoff),
    db.prepare('DELETE FROM station_buckets WHERE bucket_start < ?').bind(bucketCutoff),
    db.prepare('DELETE FROM neighborhood_buckets WHERE bucket_start < ?').bind(bucketCutoff),
  ])

  return {
    rawSnapshotsDeleted: raw.meta.changes ?? 0,
    stationBucketsDeleted: sb.meta.changes ?? 0,
    neighborhoodBucketsDeleted: nb.meta.changes ?? 0,
  }
}
