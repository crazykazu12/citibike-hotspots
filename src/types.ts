export interface Station {
  station_id: string
  name: string
  lat: number
  lon: number
  capacity: number
}

export type ComparisonMode = 'none' | 'yesterday'
