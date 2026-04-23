export interface RawStationInfo {
  station_id: string
  name: string
  lat: number
  lon: number
  capacity: number
}

export interface RawStationStatus {
  station_id: string
  num_bikes_available: number
  num_docks_available: number
  is_installed: 0 | 1
  is_renting: 0 | 1
  is_returning: 0 | 1
  last_reported: number
}

export interface GbfsFeed<T> {
  last_updated: number
  ttl: number
  data: { stations: T[] }
}

export interface Station extends RawStationInfo, RawStationStatus {}
