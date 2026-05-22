// GET /comparison?baseline=1hour|yesterday|lastweek
// Returns the most recent completed 15-min bucket alongside the same bucket
// shifted back by the requested offset, with deltas. Missing baseline rows
// surface as null rather than failures so the frontend can render "no
// comparison data yet" states gracefully (this is the expected state for
// 'yesterday' before 24h of polling history accumulates, and for 'lastweek'
// before 7d).

const HOUR_SECONDS = 3_600
const DAY_SECONDS = 86_400
const WEEK_SECONDS = 7 * DAY_SECONDS

export type Baseline = '1hour' | 'yesterday' | 'lastweek'

const BASELINE_OFFSETS: Record<Baseline, number> = {
  '1hour': HOUR_SECONDS,
  yesterday: DAY_SECONDS,
  lastweek: WEEK_SECONDS,
}

interface NeighborhoodRow {
  neighborhood_id: string
  current_activity: number | null
  baseline_activity: number | null
}

interface StationRow {
  station_id: string
  name: string
  lat: number
  lon: number
  current_activity: number | null
  baseline_activity: number | null
}

interface ResponseNeighborhood {
  neighborhood_id: string
  current_activity: number
  baseline_activity: number | null
  delta: number | null
  delta_percent: number | null
}

interface ResponseStation {
  station_id: string
  name: string
  lat: number
  lon: number
  current_activity: number
  baseline_activity: number | null
  delta: number | null
}

export interface ComparisonResponse {
  current_bucket_start: number
  baseline_bucket_start: number
  baseline: Baseline
  computed_at: number
  neighborhoods: ResponseNeighborhood[]
  stations: ResponseStation[]
}

function offsetSeconds(baseline: Baseline): number {
  return BASELINE_OFFSETS[baseline]
}

export function parseBaseline(raw: string | null): Baseline | null {
  if (raw === '1hour' || raw === 'yesterday' || raw === 'lastweek') return raw
  return null
}

export async function getComparison(
  db: D1Database,
  baseline: Baseline,
): Promise<ComparisonResponse | null> {
  const computedAt = Math.floor(Date.now() / 1000)
  const latest = await db
    .prepare('SELECT MAX(bucket_start) AS bucket_start FROM station_buckets')
    .first<{ bucket_start: number | null }>()
  const currentBucketStart = latest?.bucket_start
  if (currentBucketStart === null || currentBucketStart === undefined) return null

  const baselineBucketStart = currentBucketStart - offsetSeconds(baseline)

  const [nbhRes, stationRes] = await Promise.all([
    db
      .prepare(
        `SELECT
           sn.neighborhood_id                 AS neighborhood_id,
           cur.total_activity                 AS current_activity,
           base.total_activity                AS baseline_activity
         FROM (SELECT DISTINCT neighborhood_id FROM stations_neighborhoods) sn
         LEFT JOIN neighborhood_buckets cur
           ON cur.neighborhood_id = sn.neighborhood_id AND cur.bucket_start = ?1
         LEFT JOIN neighborhood_buckets base
           ON base.neighborhood_id = sn.neighborhood_id AND base.bucket_start = ?2`,
      )
      .bind(currentBucketStart, baselineBucketStart)
      .all<NeighborhoodRow>(),
    db
      .prepare(
        `SELECT
           si.station_id   AS station_id,
           si.name         AS name,
           si.lat          AS lat,
           si.lon          AS lon,
           cur.activity_score  AS current_activity,
           base.activity_score AS baseline_activity
         FROM station_info si
         LEFT JOIN station_buckets cur
           ON cur.station_id = si.station_id AND cur.bucket_start = ?1
         LEFT JOIN station_buckets base
           ON base.station_id = si.station_id AND base.bucket_start = ?2`,
      )
      .bind(currentBucketStart, baselineBucketStart)
      .all<StationRow>(),
  ])

  const neighborhoods: ResponseNeighborhood[] = (nbhRes.results ?? []).map((r) => {
    const cur = r.current_activity ?? 0
    const base = r.baseline_activity
    const delta = base === null ? null : cur - base
    const deltaPercent = base === null || base === 0 ? null : ((cur - base) / base) * 100
    return {
      neighborhood_id: r.neighborhood_id,
      current_activity: cur,
      baseline_activity: base,
      delta,
      delta_percent: deltaPercent,
    }
  })

  const stations: ResponseStation[] = (stationRes.results ?? []).map((r) => {
    const cur = r.current_activity ?? 0
    const base = r.baseline_activity
    return {
      station_id: r.station_id,
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      current_activity: cur,
      baseline_activity: base,
      delta: base === null ? null : cur - base,
    }
  })

  return {
    current_bucket_start: currentBucketStart,
    baseline_bucket_start: baselineBucketStart,
    baseline,
    computed_at: computedAt,
    neighborhoods,
    stations,
  }
}
