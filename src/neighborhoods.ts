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
  totalChurn: number
  netInbound: number
  stationCount: number
  activeStationCount: number
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
      agg = { totalScore: 0, totalChurn: 0, netInbound: 0, stationCount: 0, activeStationCount: 0 }
      result.set(ntaId, agg)
    }
    agg.stationCount += 1
    const a = stationActivity.get(stationId)
    if (a) {
      agg.totalScore += a.score
      agg.totalChurn += a.totalChurn
      agg.netInbound += a.netInbound
      if (a.score > 0) agg.activeStationCount += 1
    }
  }
  return result
}

// Linear interpolation from cool (low) to warm (high) on a normalized score 0..1.
// Returns "" for score = 0 so the caller can render a neutral fill.
export function neighborhoodFillColor(score: number, maxScore: number): string {
  if (maxScore <= 0 || score <= 0) return '#cccccc'
  const t = Math.min(1, score / maxScore)
  // Cool blue (#3b82f6) → warm red (#ef4444)
  const r = Math.round(0x3b + (0xef - 0x3b) * t)
  const g = Math.round(0x82 + (0x44 - 0x82) * t)
  const b = Math.round(0xf6 + (0x44 - 0xf6) * t)
  return `rgb(${r}, ${g}, ${b})`
}
