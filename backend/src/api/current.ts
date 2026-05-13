// GET /current — returns the most recent activity data combining the last
// completed 15-min bucket with a partial in-progress bucket computed live
// from raw_snapshots. Combination is duration-weighted average:
//   combined = (completed × 900 + partial × partial_seconds) / (900 + partial_seconds)
// At minute 0 of a new bucket the result equals the completed score; as the
// partial fills it converges toward the partial's per-second rate.

import { computeStationBuckets, type StationBucketRow } from '../aggregation'

const BUCKET_SECONDS = 900

interface StationInfoRow {
  station_id: string
  name: string
  lat: number
  lon: number
  capacity: number
  neighborhood_id: string | null
}

interface CurrentStation {
  station_id: string
  activity_score: number
  bikes_in: number
  bikes_out: number
  lat: number
  lon: number
  name: string
  capacity: number
}

interface CurrentNeighborhood {
  neighborhood_id: string
  total_activity: number
  active_stations: number
  total_capacity: number
}

export interface CurrentResponse {
  bucket_start: number
  partial_bucket_start: number
  computed_at: number
  stations: CurrentStation[]
  neighborhoods: CurrentNeighborhood[]
}

interface RawSnapshotRow {
  station_id: string
  captured_at: number
  bikes_available: number
}

export async function getCurrent(db: D1Database): Promise<CurrentResponse> {
  const computedAt = Math.floor(Date.now() / 1000)
  const partialBucketStart = Math.floor(computedAt / BUCKET_SECONDS) * BUCKET_SECONDS
  const partialSeconds = Math.max(1, computedAt - partialBucketStart)

  const [latestBucket, completedRowsRes, partialRowsRes, infoRes] = await Promise.all([
    db.prepare('SELECT MAX(bucket_start) AS bucket_start FROM station_buckets').first<{
      bucket_start: number | null
    }>(),
    db
      .prepare(
        'SELECT station_id, activity_score, bikes_in, bikes_out FROM station_buckets WHERE bucket_start = (SELECT MAX(bucket_start) FROM station_buckets)',
      )
      .all<StationBucketRow>(),
    db
      .prepare(
        'SELECT station_id, captured_at, bikes_available FROM raw_snapshots WHERE captured_at >= ? ORDER BY station_id, captured_at',
      )
      .bind(partialBucketStart)
      .all<RawSnapshotRow>(),
    db
      .prepare(
        'SELECT si.station_id, si.name, si.lat, si.lon, si.capacity, sn.neighborhood_id FROM station_info si LEFT JOIN stations_neighborhoods sn ON sn.station_id = si.station_id',
      )
      .all<StationInfoRow>(),
  ])

  const completedBucketStart = latestBucket?.bucket_start ?? partialBucketStart - BUCKET_SECONDS
  const completedRows = completedRowsRes.results ?? []
  const partialRows = partialRowsRes.results ?? []
  const infoRows = infoRes.results ?? []

  const completedById = new Map<string, StationBucketRow>()
  for (const r of completedRows) completedById.set(r.station_id, r)

  const partialById = new Map<string, StationBucketRow>()
  for (const r of computeStationBuckets(partialRows, partialBucketStart)) {
    partialById.set(r.station_id, r)
  }

  const stations: CurrentStation[] = []
  const neighborhoodAggregates = new Map<
    string,
    { total_activity: number; active_stations: number; total_capacity: number }
  >()

  for (const info of infoRows) {
    const completed = completedById.get(info.station_id)
    const partial = partialById.get(info.station_id)
    const completedScore = completed?.activity_score ?? 0
    const partialScore = partial?.activity_score ?? 0
    const combined =
      (completedScore * BUCKET_SECONDS + partialScore * partialSeconds) /
      (BUCKET_SECONDS + partialSeconds)

    const station: CurrentStation = {
      station_id: info.station_id,
      activity_score: combined,
      bikes_in: (completed?.bikes_in ?? 0) + (partial?.bikes_in ?? 0),
      bikes_out: (completed?.bikes_out ?? 0) + (partial?.bikes_out ?? 0),
      lat: info.lat,
      lon: info.lon,
      name: info.name,
      capacity: info.capacity,
    }
    stations.push(station)

    if (info.neighborhood_id) {
      let agg = neighborhoodAggregates.get(info.neighborhood_id)
      if (!agg) {
        agg = { total_activity: 0, active_stations: 0, total_capacity: 0 }
        neighborhoodAggregates.set(info.neighborhood_id, agg)
      }
      agg.total_activity += combined
      agg.total_capacity += info.capacity
      if (combined > 0) agg.active_stations += 1
    }
  }

  const neighborhoods: CurrentNeighborhood[] = []
  for (const [neighborhood_id, agg] of neighborhoodAggregates) {
    neighborhoods.push({ neighborhood_id, ...agg })
  }

  return {
    bucket_start: completedBucketStart,
    partial_bucket_start: partialBucketStart,
    computed_at: computedAt,
    stations,
    neighborhoods,
  }
}
