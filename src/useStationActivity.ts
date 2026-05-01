import { useEffect, useRef, useState } from 'react'
import { fetchStations, fetchStationStatus } from './gbfs'
import {
  POLL_INTERVAL_MS,
  WINDOW_SIZE,
  computeActivity,
  type StationActivity,
  type StatusSnapshot,
} from './activity'
import {
  loadNeighborhoods,
  assignStationsToNeighborhoods,
  type NeighborhoodFeatureCollection,
} from './neighborhoods'
import type { RawStationStatus, Station } from './types'

function toSnapshot(statuses: Pick<RawStationStatus, 'station_id' | 'num_bikes_available'>[]): StatusSnapshot {
  return new Map(statuses.map((s) => [s.station_id, s.num_bikes_available]))
}

interface HookResult {
  stations: Station[] | null
  neighborhoods: NeighborhoodFeatureCollection | null
  stationToNeighborhood: Map<string, string>
  error: string | null
  snapshotCount: number
  activity: Map<string, StationActivity>
}

export function useStationActivity(): HookResult {
  const [stations, setStations] = useState<Station[] | null>(null)
  const [neighborhoods, setNeighborhoods] = useState<NeighborhoodFeatureCollection | null>(null)
  const [stationToNeighborhood, setStationToNeighborhood] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [snapshotCount, setSnapshotCount] = useState(0)
  const [activity, setActivity] = useState<Map<string, StationActivity>>(new Map())

  const snapshotsRef = useRef<StatusSnapshot[]>([])

  useEffect(() => {
    let cancelled = false

    function pushSnapshot(snap: StatusSnapshot) {
      const next = [...snapshotsRef.current, snap].slice(-WINDOW_SIZE)
      snapshotsRef.current = next
      setSnapshotCount(next.length)
      setActivity(computeActivity(next))
    }

    Promise.all([fetchStations(), loadNeighborhoods()])
      .then(([s, nbh]) => {
        if (cancelled) return
        setStations(s)
        setNeighborhoods(nbh)
        setStationToNeighborhood(assignStationsToNeighborhoods(s, nbh))
        pushSnapshot(toSnapshot(s))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })

    const id = setInterval(() => {
      fetchStationStatus()
        .then((statuses) => {
          if (cancelled) return
          pushSnapshot(toSnapshot(statuses))
          const statusMap = new Map(statuses.map((s) => [s.station_id, s]))
          setStations((prev) =>
            prev === null
              ? prev
              : prev.map((s) => {
                  const status = statusMap.get(s.station_id)
                  return status ? { ...s, ...status } : s
                }),
          )
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

  return { stations, neighborhoods, stationToNeighborhood, error, snapshotCount, activity }
}
