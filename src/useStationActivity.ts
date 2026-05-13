import { useEffect, useState } from 'react'
import { fetchCurrent, USE_FIXTURES, type CurrentResponse } from './api'
import type { StationActivity } from './activity'
import {
  loadNeighborhoods,
  type NeighborhoodActivity,
  type NeighborhoodFeatureCollection,
} from './neighborhoods'
import type { Station } from './types'

const POLL_INTERVAL_MS = 30_000

interface HookResult {
  stations: Station[] | null
  neighborhoods: NeighborhoodFeatureCollection | null
  error: string | null
  activity: Map<string, StationActivity>
  neighborhoodActivity: Map<string, NeighborhoodActivity>
  maxNeighborhoodScore: number
  lastSnapshotAt: number | null
}

interface ReshapedCurrent {
  stations: Station[]
  activity: Map<string, StationActivity>
  neighborhoodActivity: Map<string, NeighborhoodActivity>
  maxNeighborhoodScore: number
  lastSnapshotAt: number
}

function reshape(res: CurrentResponse): ReshapedCurrent {
  const stations: Station[] = res.stations.map((s) => ({
    station_id: s.station_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    capacity: s.capacity,
  }))

  const activity = new Map<string, StationActivity>()
  for (const s of res.stations) {
    activity.set(s.station_id, { score: s.activity_score })
  }

  const neighborhoodActivity = new Map<string, NeighborhoodActivity>()
  let maxNeighborhoodScore = 0
  for (const n of res.neighborhoods) {
    neighborhoodActivity.set(n.neighborhood_id, { totalScore: n.total_activity })
    if (n.total_activity > maxNeighborhoodScore) maxNeighborhoodScore = n.total_activity
  }

  return {
    stations,
    activity,
    neighborhoodActivity,
    maxNeighborhoodScore,
    lastSnapshotAt: res.computed_at * 1000,
  }
}

export function useStationActivity(): HookResult {
  const [stations, setStations] = useState<Station[] | null>(null)
  const [neighborhoods, setNeighborhoods] = useState<NeighborhoodFeatureCollection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<Map<string, StationActivity>>(new Map())
  const [neighborhoodActivity, setNeighborhoodActivity] = useState<Map<string, NeighborhoodActivity>>(
    new Map(),
  )
  const [maxNeighborhoodScore, setMaxNeighborhoodScore] = useState(0)
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    function applyResponse(res: CurrentResponse) {
      const r = reshape(res)
      setStations(r.stations)
      setActivity(r.activity)
      setNeighborhoodActivity(r.neighborhoodActivity)
      setMaxNeighborhoodScore(r.maxNeighborhoodScore)
      setLastSnapshotAt(r.lastSnapshotAt)
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

    Promise.all([fetchCurrent(), loadNeighborhoods()])
      .then(([res, nbh]) => {
        if (cancelled) return
        applyResponse(res)
        setNeighborhoods(nbh)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })

    if (USE_FIXTURES) {
      // Fixture mode: one-shot load, no polling — frozen state for visual iteration.
      return () => {
        cancelled = true
      }
    }

    const id = setInterval(() => {
      fetchCurrent()
        .then((res) => {
          if (cancelled) return
          applyResponse(res)
        })
        .catch(() => {
          // transient poll failures are ignored; next tick will retry
        })
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return {
    stations,
    neighborhoods,
    error,
    activity,
    neighborhoodActivity,
    maxNeighborhoodScore,
    lastSnapshotAt,
  }
}
