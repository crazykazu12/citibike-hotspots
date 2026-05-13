import { useEffect, useState } from 'react'
import { Map, type ViewMode } from './Map'
import { Header } from './Header'
import { useStationActivity } from './useStationActivity'
import { USE_FIXTURES } from './api'
import { THEMES, type ThemeId } from './themes'

function detectInitialTheme(): ThemeId {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function App() {
  const {
    stations,
    neighborhoods,
    error,
    activity,
    neighborhoodActivity,
    maxNeighborhoodScore,
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

  if (error) return <p>Error loading activity data: {error}</p>
  if (!stations) return <p>Loading…</p>

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
      {USE_FIXTURES && import.meta.env.DEV && null /* fixture pill is in the header */}
    </>
  )
}

export default App
