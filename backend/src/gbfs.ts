const STATUS_URL = 'https://gbfs.citibikenyc.com/gbfs/en/station_status.json'

interface RawStationStatus {
  station_id: string
  num_bikes_available: number
  num_docks_available: number
}

interface StationStatusFeed {
  data: { stations: RawStationStatus[] }
}

export interface SnapshotRow {
  station_id: string
  captured_at: number
  bikes_available: number
  docks_available: number
}

export async function fetchSnapshotRows(capturedAt: number): Promise<SnapshotRow[]> {
  const res = await fetch(STATUS_URL, { cf: { cacheTtl: 0 } })
  if (!res.ok) {
    throw new Error(`GBFS fetch failed: ${res.status} ${res.statusText}`)
  }
  const feed = (await res.json()) as StationStatusFeed
  return feed.data.stations.map((s) => ({
    station_id: s.station_id,
    captured_at: capturedAt,
    bikes_available: s.num_bikes_available,
    docks_available: s.num_docks_available,
  }))
}
