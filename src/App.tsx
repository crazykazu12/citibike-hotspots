import { useEffect, useState } from 'react'
import { Map, type ViewMode } from './Map'
import { Header } from './Header'
import { useStationActivity } from './useStationActivity'
import { THEMES, type ThemeId } from './themes'
import type { ComparisonMode } from './types'

function detectInitialTheme(): ThemeId {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [themeId, setThemeId] = useState<ThemeId>(detectInitialTheme)
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('none')

  const {
    stations,
    neighborhoods,
    error,
    activity,
    neighborhoodActivity,
    maxNeighborhoodScore,
    lastSnapshotAt,
    noBaselineData,
  } = useStationActivity({ comparisonMode })

  const theme = THEMES[themeId]

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = themeId
    for (const [k, v] of Object.entries(theme.ui)) {
      root.style.setProperty(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v)
    }
  }, [themeId, theme])

  // Hot Only is meaningless in any comparison mode — force All Zones on entry.
  // On exit (comparison → now) we don't restore the prior state; user can
  // re-pick Hot Only if they want it.
  useEffect(() => {
    if (comparisonMode !== 'none') setViewMode('all')
  }, [comparisonMode])

  if (error) return <p>Error loading activity data: {error}</p>
  if (!stations) return <p>Loading…</p>

  const showNoBaselineBanner = comparisonMode !== 'none' && noBaselineData

  return (
    <>
      <Header
        lastSnapshotAt={lastSnapshotAt}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        themeId={themeId}
        onThemeChange={setThemeId}
        comparisonMode={comparisonMode}
        onComparisonChange={setComparisonMode}
      />
      <Map
        stations={stations}
        activity={activity}
        neighborhoods={neighborhoods}
        neighborhoodActivity={neighborhoodActivity}
        maxNeighborhoodScore={maxNeighborhoodScore}
        viewMode={viewMode}
        comparisonMode={comparisonMode}
        theme={theme}
      />
      {showNoBaselineBanner && (
        <div className="comparison-status-banner">
          Comparison data not yet available — comes online once enough polling history has accumulated.
        </div>
      )}
    </>
  )
}

export default App
