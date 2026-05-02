import type { GbfsFeed, RawStationInfo, RawStationStatus, Station } from './types'

const INFO_URL = 'https://gbfs.citibikenyc.com/gbfs/en/station_information.json'
const STATUS_URL = 'https://gbfs.citibikenyc.com/gbfs/en/station_status.json'

export const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === 'true'

export async function fetchStations(): Promise<Station[]> {
  if (USE_FIXTURES) {
    const data = await import('./fixtures/stations.json')
    return data.default as Station[]
  }
  const [infoRes, statusRes] = await Promise.all([fetch(INFO_URL), fetch(STATUS_URL)])
  const [infoFeed, statusFeed]: [GbfsFeed<RawStationInfo>, GbfsFeed<RawStationStatus>] =
    await Promise.all([infoRes.json(), statusRes.json()])

  const statusMap = new Map(statusFeed.data.stations.map((s) => [s.station_id, s]))

  return infoFeed.data.stations.flatMap((info) => {
    const status = statusMap.get(info.station_id)
    return status ? [{ ...info, ...status }] : []
  })
}

export async function fetchStationStatus(): Promise<RawStationStatus[]> {
  const res = await fetch(STATUS_URL)
  const feed: GbfsFeed<RawStationStatus> = await res.json()
  return feed.data.stations
}

