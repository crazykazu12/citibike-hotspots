import { useMemo } from 'react'
import { Map } from './Map'
import { useStationActivity } from './useStationActivity'
import { WINDOW_SIZE } from './activity'
import { computeNeighborhoodActivity } from './neighborhoods'

function App() {
  const { stations, neighborhoods, stationToNeighborhood, error, snapshotCount, activity } =
    useStationActivity()

  const neighborhoodActivity = useMemo(
    () => computeNeighborhoodActivity(activity, stationToNeighborhood),
    [activity, stationToNeighborhood],
  )

  const maxNeighborhoodScore = useMemo(() => {
    let max = 0
    for (const a of neighborhoodActivity.values()) {
      if (a.totalScore > max) max = a.totalScore
    }
    return max
  }, [neighborhoodActivity])

  if (error) return <p>Error loading stations: {error}</p>
  if (!stations) return <p>Loading stations…</p>

  return (
    <>
      <Map
        stations={stations}
        activity={activity}
        neighborhoods={neighborhoods}
        neighborhoodActivity={neighborhoodActivity}
        maxNeighborhoodScore={maxNeighborhoodScore}
      />
      {snapshotCount < 2 && (
        <div className="gathering-banner">
          Gathering activity data… ({snapshotCount} / {WINDOW_SIZE} snapshots)
        </div>
      )}
    </>
  )
}

export default App
