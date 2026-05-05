import { useEffect, useMemo, useState } from 'react'
import { Map, type ViewMode } from './Map'
import { Header } from './Header'
import { useStationActivity } from './useStationActivity'
import { WINDOW_SIZE } from './activity'
import { computeNeighborhoodActivity } from './neighborhoods'
import { USE_FIXTURES } from './gbfs'
import { THEMES, type ThemeId } from './themes'

function detectInitialTheme(): ThemeId {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

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
  const [themeId, setThemeId] = useState<ThemeId>(detectInitialTheme)
  const theme = THEMES[themeId]

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = themeId
    for (const [k, v] of Object.entries(theme.ui)) {
      root.style.setProperty(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v)
    }
  }, [themeId, theme])

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
        themeId={themeId}
        onThemeChange={setThemeId}
      />
      <Map
        stations={stations}
        activity={activity}
        neighborhoods={neighborhoods}
        neighborhoodActivity={neighborhoodActivity}
        maxNeighborhoodScore={maxNeighborhoodScore}
        viewMode={viewMode}
        theme={theme}
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
