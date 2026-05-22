import { useEffect, useState } from 'react'
import {
  fetchComparison,
  fetchCurrent,
  USE_FIXTURES,
  type ComparisonResponse,
  type CurrentResponse,
} from './api'
import type { StationActivity } from './activity'
import {
  loadNeighborhoods,
  type NeighborhoodActivity,
  type NeighborhoodFeatureCollection,
} from './neighborhoods'
import type { ComparisonMode, Station } from './types'

// 1-min cadence matches the backend's `* * * * *` poll. Backend data refreshes
// every minute; the Worker's edge cache (max-age=30) absorbs any over-polling.
const POLL_INTERVAL_MS = 60_000

interface HookResult {
  stations: Station[] | null
  neighborhoods: NeighborhoodFeatureCollection | null
  error: string | null
  activity: Map<string, StationActivity>
  neighborhoodActivity: Map<string, NeighborhoodActivity>
  maxNeighborhoodScore: number
  lastSnapshotAt: number | null
  // True when in yesterday mode and every neighborhood has null baseline data.
  // Drives the "data not yet available" status banner.
  noBaselineData: boolean
}

interface Reshaped {
  stations: Station[]
  activity: Map<string, StationActivity>
  neighborhoodActivity: Map<string, NeighborhoodActivity>
  maxNeighborhoodScore: number
  lastSnapshotAt: number
  noBaselineData: boolean
}

function reshapeCurrent(res: CurrentResponse): Reshaped {
  const stations: Station[] = res.stations.map((s) => ({
    station_id: s.station_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    capacity: s.capacity,
  }))
  const activity = new Map<string, StationActivity>()
  for (const s of res.stations) activity.set(s.station_id, { score: s.activity_score })

  const neighborhoodActivity = new Map<string, NeighborhoodActivity>()
  let max = 0
  for (const n of res.neighborhoods) {
    neighborhoodActivity.set(n.neighborhood_id, { totalScore: n.total_activity })
    if (n.total_activity > max) max = n.total_activity
  }
  return {
    stations,
    activity,
    neighborhoodActivity,
    maxNeighborhoodScore: max,
    lastSnapshotAt: res.computed_at * 1000,
    noBaselineData: false,
  }
}

function reshapeComparison(res: ComparisonResponse): Reshaped {
  // The comparison response doesn't carry capacity per station — set 0 since
  // nothing renders it in comparison mode (the heatmap + cluster layers are
  // hidden in yesterday mode).
  const stations: Station[] = res.stations.map((s) => ({
    station_id: s.station_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    capacity: 0,
  }))

  const activity = new Map<string, StationActivity>()
  for (const s of res.stations) {
    const hasBaseline = s.baseline_activity !== null && s.delta !== null
    activity.set(s.station_id, {
      // |delta| as the score so existing MIN_CONNECTION_ACTIVITY threshold
      // logic in connections.ts naturally filters out stations without
      // baseline data. In practice the heatmap/cluster layers are also
      // hidden in yesterday mode, so this is defense in depth.
      score: hasBaseline ? Math.abs(s.delta as number) : 0,
      hasBaseline,
    })
  }

  const neighborhoodActivity = new Map<string, NeighborhoodActivity>()
  let max = 0
  let anyBaseline = false
  for (const n of res.neighborhoods) {
    neighborhoodActivity.set(n.neighborhood_id, {
      totalScore: n.current_activity,
      // Unclamped — paint expression clamps via interpolate boundary
      // stops; tooltip reads the raw value so users see the real number.
      deltaPercent: n.delta_percent,
    })
    if (n.current_activity > max) max = n.current_activity
    if (n.baseline_activity !== null) anyBaseline = true
  }

  return {
    stations,
    activity,
    neighborhoodActivity,
    maxNeighborhoodScore: max,
    lastSnapshotAt: res.computed_at * 1000,
    noBaselineData: !anyBaseline,
  }
}

export function useStationActivity({
  comparisonMode,
}: {
  comparisonMode: ComparisonMode
}): HookResult {
  const [stations, setStations] = useState<Station[] | null>(null)
  const [neighborhoods, setNeighborhoods] = useState<NeighborhoodFeatureCollection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<Map<string, StationActivity>>(new Map())
  const [neighborhoodActivity, setNeighborhoodActivity] = useState<Map<string, NeighborhoodActivity>>(
    new Map(),
  )
  const [maxNeighborhoodScore, setMaxNeighborhoodScore] = useState(0)
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null)
  const [noBaselineData, setNoBaselineData] = useState(false)

  // Neighborhoods GeoJSON is mode-independent — load once on mount.
  useEffect(() => {
    let cancelled = false
    loadNeighborhoods()
      .then((nbh) => {
        if (!cancelled) setNeighborhoods(nbh)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Poll the right endpoint based on mode. Mode change → re-run → abort
  // in-flight fetch from the previous mode, clear stale Maps so the user
  // sees an honest loading state for ~100-300ms.
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    setActivity(new Map())
    setNeighborhoodActivity(new Map())
    setMaxNeighborhoodScore(0)
    setNoBaselineData(false)

    function apply(r: Reshaped) {
      if (cancelled) return
      setStations(r.stations)
      setActivity(r.activity)
      setNeighborhoodActivity(r.neighborhoodActivity)
      setMaxNeighborhoodScore(r.maxNeighborhoodScore)
      setLastSnapshotAt(r.lastSnapshotAt)
      setNoBaselineData(r.noBaselineData)
    }

    function isAbort(err: unknown): boolean {
      return err instanceof DOMException && err.name === 'AbortError'
    }

    function pollOnce(): Promise<void> {
      // comparisonMode narrows: 'none' falls through to fetchCurrent; the three
      // comparison values are exactly the ComparisonBaseline union, so the
      // type fits fetchComparison's signature with no cast.
      if (comparisonMode !== 'none') {
        return fetchComparison(comparisonMode, controller.signal)
          .then((res) => apply(reshapeComparison(res)))
          .catch((err: unknown) => {
            if (isAbort(err) || cancelled) return
            console.error('comparison poll failed', err)
          })
      }
      return fetchCurrent(controller.signal)
        .then((res) => apply(reshapeCurrent(res)))
        .catch((err: unknown) => {
          if (isAbort(err) || cancelled) return
          console.error('current poll failed', err)
        })
    }

    if (import.meta.env.DEV) {
      window.__downloadFixtures = async () => {
        const res = await fetchCurrent()
        const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'current.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    }

    pollOnce()

    if (USE_FIXTURES) {
      return () => {
        cancelled = true
        controller.abort()
      }
    }

    const id = setInterval(pollOnce, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      controller.abort()
      clearInterval(id)
    }
  }, [comparisonMode])

  return {
    stations,
    neighborhoods,
    error,
    activity,
    neighborhoodActivity,
    maxNeighborhoodScore,
    lastSnapshotAt,
    noBaselineData,
  }
}
