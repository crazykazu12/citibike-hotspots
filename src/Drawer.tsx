import { useEffect, useRef, useState } from 'react'
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
}

// Per-category POI swatch color — must match the corresponding marker color
// in src/Map.tsx (BAR_COLOR). Kept in sync by being a separate const here so
// the legend swatch always shows what the user will see on the map.
const BARS_SWATCH = '#a78bfa'

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
          <label className="poi-toggle">
            <input
              type="checkbox"
              checked={barsEnabled}
              onChange={(e) => onBarsChange(e.target.checked)}
            />
            <span
              className="poi-swatch"
              style={{ background: BARS_SWATCH }}
              aria-hidden="true"
            />
            <span className="poi-toggle-label">Bars</span>
          </label>
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
