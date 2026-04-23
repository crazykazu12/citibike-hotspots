import type { GbfsFeed, RawStationInfo, RawStationStatus, Station } from './types'

const INFO_URL = 'https://gbfs.citibikenyc.com/gbfs/en/station_information.json'
const STATUS_URL = 'https://gbfs.citibikenyc.com/gbfs/en/station_status.json'

export async function fetchStations(): Promise<Station[]> {
  const [infoRes, statusRes] = await Promise.all([
    fetch(INFO_URL),
    fetch(STATUS_URL),
  ])
  const [infoFeed, statusFeed]: [GbfsFeed<RawStationInfo>, GbfsFeed<RawStationStatus>] =
    await Promise.all([infoRes.json(), statusRes.json()])

  const statusMap = new Map(
    statusFeed.data.stations.map((s) => [s.station_id, s]),
  )

  return infoFeed.data.stations.flatMap((info) => {
    const status = statusMap.get(info.station_id)
    return status ? [{ ...info, ...status }] : []
  })
}
