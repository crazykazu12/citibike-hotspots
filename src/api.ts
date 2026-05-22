// Backend API client. The frontend used to fetch GBFS directly and compute
// activity in the browser; now both come pre-computed from the Cloudflare
// Worker at VITE_API_BASE_URL.

const PRODUCTION_API_BASE = 'https://where-in-the-citi-backend.kazumasa-umemoto.workers.dev'

export const API_BASE: string =
  import.meta.env.VITE_API_BASE_URL ?? PRODUCTION_API_BASE

export const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === 'true'

export interface CurrentStation {
  station_id: string
  activity_score: number
  bikes_in: number
  bikes_out: number
  lat: number
  lon: number
  name: string
  capacity: number
}

export interface CurrentNeighborhood {
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

export type ComparisonBaseline = 'yesterday' | 'lastweek'

export interface ComparisonNeighborhood {
  neighborhood_id: string
  current_activity: number
  baseline_activity: number | null
  delta: number | null
  delta_percent: number | null
}

export interface ComparisonStation {
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
  baseline: ComparisonBaseline
  computed_at: number
  neighborhoods: ComparisonNeighborhood[]
  stations: ComparisonStation[]
}

export async function fetchCurrent(signal?: AbortSignal): Promise<CurrentResponse> {
  if (USE_FIXTURES) {
    const data = await import('./fixtures/current.json')
    return data.default as CurrentResponse
  }
  const res = await fetch(`${API_BASE}/current`, { signal })
  if (!res.ok) throw new Error(`/current failed: ${res.status} ${res.statusText}`)
  return (await res.json()) as CurrentResponse
}

export async function fetchComparison(
  baseline: ComparisonBaseline,
  signal?: AbortSignal,
): Promise<ComparisonResponse> {
  const res = await fetch(`${API_BASE}/comparison?baseline=${baseline}`, { signal })
  if (!res.ok) throw new Error(`/comparison failed: ${res.status} ${res.statusText}`)
  return (await res.json()) as ComparisonResponse
}
