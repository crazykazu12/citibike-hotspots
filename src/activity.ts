export const WINDOW_SIZE = 10
export const POLL_INTERVAL_MS = 30_000

export const DEST_MULT_POSITIVE = 1.0
export const DEST_MULT_ZERO = 0.3
export const DEST_MULT_NEGATIVE = 0.1

export type StatusSnapshot = Map<string, number>

export interface StationActivity {
  score: number
}

// Score = total churn × destination multiplier across the rolling window.
// Destination weighting answers "where are people going" rather than "where
// are bikes moving" — net-outflow stations (e.g. subway exits during AM rush)
// are commute origins, not hotspots. |delta| is a lower-bound estimate of
// real churn since simultaneous arrivals/departures within a 30s poll cancel
// out.
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
    let totalChurn = 0
    let netInbound = 0
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1].get(id)
      const curr = snapshots[i].get(id)
      if (prev === undefined || curr === undefined) continue
      const delta = curr - prev
      totalChurn += Math.abs(delta)
      netInbound += delta
    }
    const mult =
      netInbound > 0
        ? DEST_MULT_POSITIVE
        : netInbound < 0
          ? DEST_MULT_NEGATIVE
          : DEST_MULT_ZERO
    result.set(id, { score: totalChurn * mult })
  }
  return result
}
