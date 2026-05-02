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
      if (import.meta.env.DEV) {
        window.__snapshots = next
      }
    }

    if (import.meta.env.DEV) {
      window.__dumpFixtures = () => ({
        snapshots: (window.__snapshots ?? []).map((m) => Object.fromEntries(m)),
        stations: window.__stations ?? [],
      })
      window.__downloadFixtures = () => {
        const dump = window.__dumpFixtures!()
        const trigger = (filename: string, body: unknown) => {
          const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = filename
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(url)
        }
        trigger('snapshots.json', dump.snapshots)
        // Stagger so the browser doesn't drop the second download as a duplicate.
        setTimeout(() => trigger('stations.json', dump.stations), 250)
      }
    }

    Promise.all([fetchStations(), loadNeighborhoods()])
      .then(async ([s, nbh]) => {
        if (cancelled) return
        setStations(s)
        if (import.meta.env.DEV) {
          window.__stations = s
        }
        setNeighborhoods(nbh)
        setStationToNeighborhood(assignStationsToNeighborhoods(s, nbh))

        if (import.meta.env.VITE_USE_FIXTURES === 'true') {
          // Replay the captured snapshot window so the rolling buffer is full instantly.
          // No subsequent polls — the heatmap stays frozen for stable visual comparison.
          // Dynamic import is inlined here (not exported from a separate module) so
          // the entire branch + its JSON chunk dead-code-eliminates in production builds.
          const data = await import('./fixtures/snapshots.json')
          const fixtureSnaps = data.default as Record<string, number>[]
          for (const snap of fixtureSnaps) {
            if (cancelled) return
            pushSnapshot(new Map(Object.entries(snap)))
          }
        } else {
          pushSnapshot(toSnapshot(s))
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })

    if (import.meta.env.VITE_USE_FIXTURES === 'true') {
      return () => {
        cancelled = true
      }
    }

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
