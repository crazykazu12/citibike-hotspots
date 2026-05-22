import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'

export interface NeighborhoodProps {
  nta2020: string
  ntaname: string
  boroname: string
}

export type NeighborhoodFeature = Feature<Polygon | MultiPolygon, NeighborhoodProps>
export type NeighborhoodFeatureCollection = FeatureCollection<Polygon | MultiPolygon, NeighborhoodProps>

export interface NeighborhoodActivity {
  totalScore: number
  // Set only in comparison mode. null means the neighborhood had no baseline
  // data → polygon renders fully transparent.
  deltaPercent?: number | null
}

export async function loadNeighborhoods(): Promise<NeighborhoodFeatureCollection> {
  const res = await fetch('/data/nyc-neighborhoods.geojson')
  if (!res.ok) throw new Error(`Failed to load neighborhoods: ${res.status}`)
  return res.json()
}
