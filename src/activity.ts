export const WINDOW_SIZE = 10
export const POLL_INTERVAL_MS = 30_000

export const DEST_MULT_POSITIVE = 1.0
export const DEST_MULT_ZERO = 0.3
export const DEST_MULT_NEGATIVE = 0.1

export type StatusSnapshot = Map<string, number>

export type ActivityCategory = 'destination' | 'pass-through' | 'source' | 'idle'

export interface StationActivity {
  bikesIn: number
  bikesOut: number
  totalChurn: number
  netInbound: number
  score: number
  category: ActivityCategory
  rank: number | null
}

// bikesIn/bikesOut (and therefore totalChurn) are LOWER-BOUND estimates of
// true traffic: within one 30s polling interval, simultaneous arrivals and
// departures cancel out in the bikes_available delta. Higher polling
// frequency tightens the bound.
export function computeActivity(
  snapshots: StatusSnapshot[],
): Map<string, StationActivity> {
  const result = new Map<string, StationActivity>()
  if (snapshots.length < 2) return result

  const stationIds = new Set<string>()
  for (const snap of snapshots) {
    for (const id of snap.keys()) stationIds.add(id)
  }

  for (const id of stationIds) {
    let bikesIn = 0
    let bikesOut = 0
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1].get(id)
      const curr = snapshots[i].get(id)
      if (prev === undefined || curr === undefined) continue
      const delta = curr - prev
      if (delta > 0) bikesIn += delta
      else if (delta < 0) bikesOut += -delta
    }
    const totalChurn = bikesIn + bikesOut
    const netInbound = bikesIn - bikesOut
    const mult =
      netInbound > 0
        ? DEST_MULT_POSITIVE
        : netInbound < 0
          ? DEST_MULT_NEGATIVE
          : DEST_MULT_ZERO
    const score = totalChurn * mult
    const category: ActivityCategory =
      totalChurn === 0
        ? 'idle'
        : netInbound > 0
          ? 'destination'
          : netInbound < 0
            ? 'source'
            : 'pass-through'
    result.set(id, {
      bikesIn,
      bikesOut,
      totalChurn,
      netInbound,
      score,
      category,
      rank: null, // filled in below for score > 0 only
    })
  }

  const sorted = [...result.entries()]
    .filter(([, act]) => act.score > 0)
    .sort((a, b) => {
      if (b[1].score !== a[1].score) return b[1].score - a[1].score
      return b[1].bikesIn - a[1].bikesIn
    })
  sorted.forEach(([id, act], idx) => {
    result.set(id, { ...act, rank: idx + 1 })
  })

  return result
}
