import { useEffect, useState } from 'react'
import { USE_FIXTURES } from './gbfs'
import type { ViewMode } from './Map'
import type { ThemeId } from './themes'

const TICK_INTERVAL_MS = 5000

interface HeaderProps {
  lastSnapshotAt: number | null
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  themeId: ThemeId
  onThemeChange: (id: ThemeId) => void
}

function formatRelative(deltaMs: number): string {
  if (deltaMs < 5000) return 'Updated just now'
  const s = Math.floor(deltaMs / 1000)
  if (s < 60) return `Updated ${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `Updated ${m}m ago`
  const h = Math.floor(m / 60)
  return `Updated ${h}h ago`
}

export function Header({
  lastSnapshotAt,
  viewMode,
  onViewModeChange,
  themeId,
  onThemeChange,
}: HeaderProps) {
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (USE_FIXTURES) return
    const id = setInterval(() => forceTick((n) => n + 1), TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  const indicator = USE_FIXTURES
    ? 'Fixture mode — frozen data'
    : lastSnapshotAt === null
      ? 'Waiting for data…'
      : formatRelative(Date.now() - lastSnapshotAt)

  return (
    <header className="app-header">
      <div className="app-header-left">
        <h1 className="app-title">Where in the Citi?</h1>
        <p className="app-subtitle">Real-time Citi Bike activity across NYC</p>
      </div>
      <div className="app-header-right">
        <div className="view-toggle theme-picker" role="tablist" aria-label="Theme">
          <button
            type="button"
            role="tab"
            aria-selected={themeId === 'light'}
            className={themeId === 'light' ? 'active' : ''}
            onClick={() => onThemeChange('light')}
          >
            Light
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={themeId === 'dark'}
            className={themeId === 'dark' ? 'active' : ''}
            onClick={() => onThemeChange('dark')}
          >
            Dark
          </button>
        </div>
        <div className="view-toggle" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'all'}
            className={viewMode === 'all' ? 'active' : ''}
            onClick={() => onViewModeChange('all')}
          >
            All zones
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'hot'}
            className={viewMode === 'hot' ? 'active' : ''}
            onClick={() => onViewModeChange('hot')}
          >
            Hot only
          </button>
        </div>
        <span className={USE_FIXTURES ? 'updated-indicator fixture' : 'updated-indicator'}>
          {indicator}
        </span>
      </div>
    </header>
  )
}
