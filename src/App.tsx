import { useEffect, useState } from 'react'
import { Map, type ViewMode } from './Map'
import { Header } from './Header'
import { Drawer } from './Drawer'
import { useStationActivity } from './useStationActivity'
import { usePoiLayer } from './usePoiLayer'
import { BARS_URL, COFFEE_URL, FOOD_URL, PARKS_URL } from './api'
import { THEMES } from './themes'
import type { ComparisonMode } from './types'

// Theme is hardcoded to dark. The light theme definition remains in
// src/themes.ts as dead-but-available code so a user-facing toggle (and
// OS-preference detection) can be reinstated without restoring infrastructure.
const theme = THEMES.dark

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('none')
  // POI layer toggles — off by default. usePoiLayer fetches once on first
  // toggle-on and caches; subsequent toggles just flip layer visibility on
  // the already-loaded source.
  const [barsEnabled, setBarsEnabled] = useState(false)
  const [coffeeEnabled, setCoffeeEnabled] = useState(false)
  const [foodEnabled, setFoodEnabled] = useState(false)
  const [parksEnabled, setParksEnabled] = useState(false)
  const barsData = usePoiLayer(BARS_URL, barsEnabled)
  const coffeeData = usePoiLayer(COFFEE_URL, coffeeEnabled)
  const foodData = usePoiLayer(FOOD_URL, foodEnabled)
  const parksData = usePoiLayer(PARKS_URL, parksEnabled)

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

  useEffect(() => {
    // Module-scope `theme` is a constant — this effect runs once on mount and
    // pins the dark theme's CSS variables. No re-run needed.
    const root = document.documentElement
    root.dataset.theme = theme.id
    for (const [k, v] of Object.entries(theme.ui)) {
      root.style.setProperty(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v)
    }
  }, [])

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
      <Header />
      <Map
        stations={stations}
        activity={activity}
        neighborhoods={neighborhoods}
        neighborhoodActivity={neighborhoodActivity}
        maxNeighborhoodScore={maxNeighborhoodScore}
        viewMode={viewMode}
        comparisonMode={comparisonMode}
        theme={theme}
        barsEnabled={barsEnabled}
        barsData={barsData}
        coffeeEnabled={coffeeEnabled}
        coffeeData={coffeeData}
        foodEnabled={foodEnabled}
        foodData={foodData}
        parksEnabled={parksEnabled}
        parksData={parksData}
      />
      <Drawer
        lastSnapshotAt={lastSnapshotAt}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        comparisonMode={comparisonMode}
        onComparisonChange={setComparisonMode}
        barsEnabled={barsEnabled}
        onBarsChange={setBarsEnabled}
        coffeeEnabled={coffeeEnabled}
        onCoffeeChange={setCoffeeEnabled}
        foodEnabled={foodEnabled}
        onFoodChange={setFoodEnabled}
        parksEnabled={parksEnabled}
        onParksChange={setParksEnabled}
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
