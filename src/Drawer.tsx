import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { USE_FIXTURES } from './api'
import type { ViewMode } from './Map'
import type { ComparisonMode } from './types'

const TICK_INTERVAL_MS = 5000

interface DrawerProps {
  lastSnapshotAt: number | null
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  comparisonMode: ComparisonMode
  onComparisonChange: (mode: ComparisonMode) => void
  barsEnabled: boolean
  onBarsChange: (enabled: boolean) => void
  coffeeEnabled: boolean
  onCoffeeChange: (enabled: boolean) => void
  foodEnabled: boolean
  onFoodChange: (enabled: boolean) => void
  parksEnabled: boolean
  onParksChange: (enabled: boolean) => void
}

// Per-category POI swatch colors — kept in sync by mirroring the marker color
// constants in src/Map.tsx (BAR_COLOR, COFFEE_COLOR, FOOD_COLOR, PARKS_*_COLOR).
// The swatch is the user's legend for "this dot color = this category."
const BARS_SWATCH = '#a78bfa'
const COFFEE_SWATCH = '#a16207'
const FOOD_SWATCH = '#ec4899'
const PARKS_SWATCH = '#22c55e'

function formatRelative(deltaMs: number): string {
  if (deltaMs < 5000) return 'Updated just now'
  const s = Math.floor(deltaMs / 1000)
  if (s < 60) return `Updated ${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `Updated ${m}m ago`
  const h = Math.floor(m / 60)
  return `Updated ${h}h ago`
}

export function Drawer({
  lastSnapshotAt,
  viewMode,
  onViewModeChange,
  comparisonMode,
  onComparisonChange,
  barsEnabled,
  onBarsChange,
  coffeeEnabled,
  onCoffeeChange,
  foodEnabled,
  onFoodChange,
  parksEnabled,
  onParksChange,
}: DrawerProps) {
  const [open, setOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const comparisonActive = comparisonMode !== 'none'

  // 5s tick so the "Updated Xs ago" text re-evaluates against a fresh
  // Date.now() on each render. Suppressed in fixture mode where data is frozen.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (USE_FIXTURES) return
    const id = setInterval(() => forceTick((n) => n + 1), TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // Click-outside + Escape, only active while open. The tab is inside
  // drawerRef (just absolutely positioned outside the panel's visual box),
  // so contains() returns true for tab clicks — no special-casing needed.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onMouseDown = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [open])

  const indicator = USE_FIXTURES
    ? 'Fixture mode — frozen data'
    : lastSnapshotAt === null
      ? 'Waiting for data…'
      : formatRelative(Date.now() - lastSnapshotAt)

  return (
    <div ref={drawerRef} className={open ? 'drawer open' : 'drawer'}>
      <aside className="drawer-panel" aria-label="Controls" aria-hidden={!open}>
        {!USE_FIXTURES && (
          <label className="comparison-select">
            <span className="comparison-select-label">Compare:</span>
            <select
              value={comparisonMode}
              onChange={(e) => onComparisonChange(e.target.value as ComparisonMode)}
              aria-label="Compare to"
            >
              <option value="none">Now</option>
              <option value="1hour">1 hour ago</option>
              <option value="yesterday">Yesterday</option>
              <option value="lastweek">1 week ago</option>
            </select>
          </label>
        )}
        <div className="view-toggle" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'all'}
            className={viewMode === 'all' ? 'active' : ''}
            onClick={() => onViewModeChange('all')}
            disabled={comparisonActive}
            title={comparisonActive ? 'Not available in comparison mode' : undefined}
          >
            All zones
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'hot'}
            className={viewMode === 'hot' ? 'active' : ''}
            onClick={() => onViewModeChange('hot')}
            disabled={comparisonActive}
            title={comparisonActive ? 'Not available in comparison mode' : undefined}
          >
            Hot only
          </button>
        </div>
        <div className="drawer-layers">
          <div className="drawer-section-label">Layers</div>
          <LayerRow
            label="Bars"
            color={BARS_SWATCH}
            checked={barsEnabled}
            onChange={onBarsChange}
          />
          <LayerRow
            label="Coffee shops"
            color={COFFEE_SWATCH}
            checked={coffeeEnabled}
            onChange={onCoffeeChange}
          />
          <LayerRow
            label="Food"
            color={FOOD_SWATCH}
            checked={foodEnabled}
            onChange={onFoodChange}
          />
          <LayerRow
            label="Parks"
            color={PARKS_SWATCH}
            checked={parksEnabled}
            onChange={onParksChange}
          />
        </div>
        <div className="drawer-indicator">
          <span className={USE_FIXTURES ? 'updated-indicator fixture' : 'updated-indicator'}>
            {indicator}
          </span>
        </div>
      </aside>
      <button
        type="button"
        className="drawer-tab"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? 'Close controls' : 'Open controls'}
      >
        <span className="drawer-tab-icon" aria-hidden="true">≡</span>
      </button>
    </div>
  )
}

// One row in the drawer's Layers section: a color swatch + label on the left,
// an iOS-style sliding toggle on the right. The toggle is a real
// <input type="checkbox"> with `appearance: none` and pseudo-element styling
// (see .layer-toggle-switch in src/index.css), so keyboard nav and screen
// readers behave as if it were a stock checkbox. The category's swatch color
// is passed through to CSS via the --switch-on-color custom property so the
// "on" track is tinted with the same hue the user sees on the map.
function LayerRow({
  label,
  color,
  checked,
  onChange,
}: {
  label: string
  color: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const switchStyle = { '--switch-on-color': color } as CSSProperties
  return (
    <label className="layer-row">
      <span className="layer-row-label">
        <span className="poi-swatch" style={{ background: color }} aria-hidden="true" />
        {label}
      </span>
      <input
        type="checkbox"
        className="layer-toggle-switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={switchStyle}
      />
    </label>
  )
}
