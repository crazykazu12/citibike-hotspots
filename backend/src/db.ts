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

export async function deleteOlderThan(db: D1Database, cutoffSeconds: number): Promise<number> {
  const result = await db
    .prepare('DELETE FROM raw_snapshots WHERE captured_at < ?')
    .bind(cutoffSeconds)
    .run()
  return result.meta.changes ?? 0
}
