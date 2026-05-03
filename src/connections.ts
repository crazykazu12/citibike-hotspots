import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import convex from '@turf/convex'
import { featureCollection, point } from '@turf/helpers'
import type { Feature, Polygon } from 'geojson'
import type { StationActivity } from './activity'
import type { Station } from './types'

export const CONNECTION_DISTANCE_M = 300
export const MIN_CONNECTION_ACTIVITY = 1
export const CONNECTION_SAMPLE_SPACING_M = 30
export const CONNECTION_HEAT_MULTIPLIER = 0.4
export const CLUSTER_FILL_SPACING_M = 20
export const CLUSTER_FILL_HEAT_MULTIPLIER = 0.5
export const CLUSTER_FILL_RADIAL_FLOOR = 0.3
export const MAX_CLUSTER_FILL_POINTS = 400

// Equirectangular approximation — cluster scales (≤ a few km) at NYC latitude
// stay well within tolerance, so we skip haversine.
const METERS_PER_DEG_LAT = 111_000
const METERS_PER_DEG_LON_NYC = 84_000

export interface HeatPoint {
  lon: number
  lat: number
  weight: number
}

export interface ConnectionResult {
  corridorPoints: HeatPoint[]
  clusterFillPoints: HeatPoint[]
  stats: { pairCount: number; groupCount: number }
}

interface EligibleStation {
  id: string
  lon: number
  lat: number
  score: number
  cellX: number
  cellY: number
}

export function computeConnectionPoints(
  stations: Station[],
  activity: Map<string, StationActivity>,
): ConnectionResult {
  const eligible: EligibleStation[] = []
  for (const s of stations) {
    const score = activity.get(s.station_id)?.score ?? 0
    if (score < MIN_CONNECTION_ACTIVITY) continue
    eligible.push({
      id: s.station_id,
      lon: s.lon,
      lat: s.lat,
      score,
      cellX: Math.floor((s.lon * METERS_PER_DEG_LON_NYC) / CONNECTION_DISTANCE_M),
      cellY: Math.floor((s.lat * METERS_PER_DEG_LAT) / CONNECTION_DISTANCE_M),
    })
  }

  const grid = new Map<string, EligibleStation[]>()
  for (const e of eligible) {
    const key = `${e.cellX},${e.cellY}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(e)
    else grid.set(key, [e])
  }

  const distSqLimit = CONNECTION_DISTANCE_M * CONNECTION_DISTANCE_M
  const clusters = findClusters(eligible, grid, distSqLimit)

  const corridorPoints: HeatPoint[] = []
  const clusterFillPoints: HeatPoint[] = []
  let pairCount = 0
  let groupCount = 0

  for (const cluster of clusters) {
    if (cluster.length === 2) {
      pairCount++
      sampleCorridor(cluster[0], cluster[1], corridorPoints)
    } else {
      groupCount++
      const filled = fillCluster(cluster, clusterFillPoints)
      if (!filled) {
        // Hull failed (e.g., collinear points) — fall back to pairwise corridors
        // within the cluster so the region still renders something.
        for (let i = 0; i < cluster.length; i++) {
          for (let j = i + 1; j < cluster.length; j++) {
            const a = cluster[i]
            const b = cluster[j]
            const mx = (a.lon - b.lon) * METERS_PER_DEG_LON_NYC
            const my = (a.lat - b.lat) * METERS_PER_DEG_LAT
            if (mx * mx + my * my > distSqLimit) continue
            sampleCorridor(a, b, corridorPoints)
          }
        }
        if (import.meta.env.DEV) {
          console.warn(
            `convex hull failed for cluster of ${cluster.length} stations; fell back to corridors`,
          )
        }
      }
    }
  }

  return {
    corridorPoints,
    clusterFillPoints,
    stats: { pairCount, groupCount },
  }
}

function findClusters(
  eligible: EligibleStation[],
  grid: Map<string, EligibleStation[]>,
  distSqLimit: number,
): EligibleStation[][] {
  const visited = new Set<string>()
  const clusters: EligibleStation[][] = []

  for (const seed of eligible) {
    if (visited.has(seed.id)) continue
    const cluster: EligibleStation[] = []
    const queue: EligibleStation[] = [seed]
    visited.add(seed.id)
    let head = 0
    while (head < queue.length) {
      const a = queue[head++]
      cluster.push(a)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${a.cellX + dx},${a.cellY + dy}`)
          if (!bucket) continue
          for (const b of bucket) {
            if (visited.has(b.id)) continue
            const mx = (a.lon - b.lon) * METERS_PER_DEG_LON_NYC
            const my = (a.lat - b.lat) * METERS_PER_DEG_LAT
            if (mx * mx + my * my > distSqLimit) continue
            visited.add(b.id)
            queue.push(b)
          }
        }
      }
    }
    if (cluster.length >= 2) clusters.push(cluster)
  }
  return clusters
}

function sampleCorridor(a: EligibleStation, b: EligibleStation, out: HeatPoint[]): void {
  const mx = (a.lon - b.lon) * METERS_PER_DEG_LON_NYC
  const my = (a.lat - b.lat) * METERS_PER_DEG_LAT
  const dist = Math.sqrt(mx * mx + my * my)
  const steps = Math.max(1, Math.round(dist / CONNECTION_SAMPLE_SPACING_M))
  const weight = CONNECTION_HEAT_MULTIPLIER * 0.5 * (a.score + b.score)
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps
    out.push({
      lon: a.lon + (b.lon - a.lon) * t,
      lat: a.lat + (b.lat - a.lat) * t,
      weight,
    })
  }
}

function fillCluster(cluster: EligibleStation[], out: HeatPoint[]): boolean {
  const fc = featureCollection(cluster.map((e) => point([e.lon, e.lat])))
  const hull = convex(fc) as Feature<Polygon> | null
  if (!hull) return false

  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const ring of hull.geometry.coordinates) {
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon
      if (lon > east) east = lon
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  }

  const bboxWidthM = (east - west) * METERS_PER_DEG_LON_NYC
  const bboxHeightM = (north - south) * METERS_PER_DEG_LAT
  const naiveCount =
    (bboxWidthM / CLUSTER_FILL_SPACING_M) * (bboxHeightM / CLUSTER_FILL_SPACING_M)
  const spacing =
    naiveCount > MAX_CLUSTER_FILL_POINTS
      ? CLUSTER_FILL_SPACING_M * Math.sqrt(naiveCount / MAX_CLUSTER_FILL_POINTS)
      : CLUSTER_FILL_SPACING_M

  const lonStep = spacing / METERS_PER_DEG_LON_NYC
  const latStep = spacing / METERS_PER_DEG_LAT

  let totalScore = 0
  let centroidLon = 0
  let centroidLat = 0
  for (const e of cluster) {
    totalScore += e.score
    centroidLon += e.lon
    centroidLat += e.lat
  }
  const meanScore = totalScore / cluster.length
  centroidLon /= cluster.length
  centroidLat /= cluster.length

  let radiusM = 0
  for (const ring of hull.geometry.coordinates) {
    for (const [lon, lat] of ring) {
      const dx = (lon - centroidLon) * METERS_PER_DEG_LON_NYC
      const dy = (lat - centroidLat) * METERS_PER_DEG_LAT
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > radiusM) radiusM = d
    }
  }

  const baseWeight = CLUSTER_FILL_HEAT_MULTIPLIER * meanScore

  for (let lon = west; lon <= east; lon += lonStep) {
    for (let lat = south; lat <= north; lat += latStep) {
      if (!booleanPointInPolygon(point([lon, lat]), hull)) continue
      let radial = 1
      if (radiusM > 0) {
        const dx = (lon - centroidLon) * METERS_PER_DEG_LON_NYC
        const dy = (lat - centroidLat) * METERS_PER_DEG_LAT
        const distNorm = Math.min(1, Math.max(0, Math.sqrt(dx * dx + dy * dy) / radiusM))
        radial =
          CLUSTER_FILL_RADIAL_FLOOR + (1 - CLUSTER_FILL_RADIAL_FLOOR) * (1 - distNorm)
      }
      out.push({ lon, lat, weight: baseWeight * radial })
    }
  }
  return true
}
