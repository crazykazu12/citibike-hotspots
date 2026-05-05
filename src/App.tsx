import { useMemo, useState } from 'react'
import { Map, type ViewMode } from './Map'
import { Header } from './Header'
import { useStationActivity } from './useStationActivity'
import { WINDOW_SIZE } from './activity'
import { computeNeighborhoodActivity } from './neighborhoods'
import { USE_FIXTURES } from './gbfs'

function App() {
  const {
    stations,
    neighborhoods,
    stationToNeighborhood,
    error,
    snapshotCount,
    activity,
    lastSnapshotAt,
  } = useStationActivity()

  const [viewMode, setViewMode] = useState<ViewMode>('all')

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
      <Header
        lastSnapshotAt={lastSnapshotAt}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      <Map
        stations={stations}
        activity={activity}
        neighborhoods={neighborhoods}
        neighborhoodActivity={neighborhoodActivity}
        maxNeighborhoodScore={maxNeighborhoodScore}
        viewMode={viewMode}
      />
      {snapshotCount < 2 && !USE_FIXTURES && (
        <div className="gathering-banner">
          Gathering activity data… ({snapshotCount} / {WINDOW_SIZE} snapshots)
        </div>
      )}
    </>
  )
}

export default App
