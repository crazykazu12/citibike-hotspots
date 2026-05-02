import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import type { Station } from './types'
import type { StationActivity } from './activity'

export interface NeighborhoodProps {
  nta2020: string
  ntaname: string
  boroname: string
}

export type NeighborhoodFeature = Feature<Polygon | MultiPolygon, NeighborhoodProps>
export type NeighborhoodFeatureCollection = FeatureCollection<Polygon | MultiPolygon, NeighborhoodProps>

export interface NeighborhoodActivity {
  totalScore: number
}

export async function loadNeighborhoods(): Promise<NeighborhoodFeatureCollection> {
  const res = await fetch('/data/nyc-neighborhoods.geojson')
  if (!res.ok) throw new Error(`Failed to load neighborhoods: ${res.status}`)
  return res.json()
}

export function assignStationsToNeighborhoods(
  stations: Station[],
  neighborhoods: NeighborhoodFeatureCollection,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const s of stations) {
    const pt = point([s.lon, s.lat])
    for (const f of neighborhoods.features) {
      if (booleanPointInPolygon(pt, f)) {
        result.set(s.station_id, f.properties.nta2020)
        break
      }
    }
  }
  return result
}

export function computeNeighborhoodActivity(
  stationActivity: Map<string, StationActivity>,
  stationToNeighborhood: Map<string, string>,
): Map<string, NeighborhoodActivity> {
  const result = new Map<string, NeighborhoodActivity>()
  for (const [stationId, ntaId] of stationToNeighborhood) {
    let agg = result.get(ntaId)
    if (!agg) {
      agg = { totalScore: 0 }
      result.set(ntaId, agg)
    }
    const a = stationActivity.get(stationId)
    if (a) agg.totalScore += a.score
  }
  return result
}
