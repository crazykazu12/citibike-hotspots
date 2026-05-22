import { DARK, LIGHT, type Flavor } from '@protomaps/basemaps'

export type ThemeId = 'light' | 'dark'

export interface ThemeOverlays {
  // Stops for the neighborhood `fill-color` interpolate over normalizedScore (0..1).
  neighborhoodColorScale: Array<[number, string]>
  // Stops for the `heatmap-color` interpolate over heatmap-density (0..1). Drives
  // both station heat and synthetic cluster-fill points (same source).
  heatmapColorStops: Array<[number, string]>
  // Color of the thin neighborhood polygon outlines.
  neighborhoodOutline: string
  // Diverging scale colors for comparison mode. Theme owns colors only — the
  // saturation cap (where these colors are reached) lives per-baseline in
  // COMPARISON_CAPS in Map.tsx, since it's a baseline concern, not a theme
  // concern. The 0.55 alpha on the endpoints matches Now-mode's
  // ALL_ZONES_OPACITY=0.55 so comparison peaks render at the same softness as
  // Now-mode peaks rather than fully opaque.
  comparisonColors: { cold: string; mid: string; hot: string }
}

export interface ThemeUi {
  headerBg: string
  headerText: string
  headerSubtext: string
  headerBorder: string
  toggleBg: string
  toggleText: string
  toggleActiveBg: string
  toggleActiveText: string
  indicatorText: string
  fixtureIndicatorBg: string
  fixtureIndicatorText: string
  legendBg: string
  legendText: string
  legendBorder: string
  tooltipBg: string
  tooltipText: string
}

export interface Theme {
  id: ThemeId
  label: string
  // Spread-and-override of @protomaps/basemaps flavor (LIGHT / DARK / etc).
  protomapsFlavor: Flavor
  overlays: ThemeOverlays
  ui: ThemeUi
}

export const THEMES: Record<ThemeId, Theme> = {
  light: {
    id: 'light',
    label: 'Light',
    protomapsFlavor: { ...LIGHT, water: '#cad2d3' },
    overlays: {
      neighborhoodColorScale: [
        [0, '#3b82f6'],
        [1, '#ef4444'],
      ],
      heatmapColorStops: [
        [0, 'rgba(0, 0, 0, 0)'],
        [0.1, 'rgba(33, 102, 172, 0.4)'],
        [0.3, 'rgba(103, 169, 207, 0.6)'],
        [0.5, 'rgba(253, 219, 199, 0.8)'],
        [0.7, 'rgba(244, 109, 67, 0.75)'],
        [1, 'rgba(178, 24, 43, 0.7)'],
      ],
      neighborhoodOutline: '#888',
      comparisonColors: {
        cold: 'rgba(30, 64, 175, 0.55)', // #1e40af @ 55%
        mid: 'rgba(0, 0, 0, 0)',
        hot: 'rgba(220, 38, 38, 0.55)', // #dc2626 @ 55%
      },
    },
    ui: {
      headerBg: 'rgba(255, 255, 255, 0.85)',
      headerText: '#08060d',
      headerSubtext: '#6b6375',
      headerBorder: 'rgba(0, 0, 0, 0.08)',
      toggleBg: 'rgba(0, 0, 0, 0.06)',
      toggleText: '#6b6375',
      toggleActiveBg: '#fff',
      toggleActiveText: '#08060d',
      indicatorText: '#6b6375',
      fixtureIndicatorBg: 'rgba(245, 158, 11, 0.18)',
      fixtureIndicatorText: '#92400e',
      legendBg: 'rgba(255, 255, 255, 0.92)',
      legendText: '#222',
      legendBorder: 'rgba(0, 0, 0, 0.15)',
      tooltipBg: 'rgba(0, 0, 0, 0.82)',
      tooltipText: '#fff',
    },
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    protomapsFlavor: { ...DARK, water: '#1a2733' },
    overlays: {
      neighborhoodColorScale: [
        [0, '#22d3ee'],
        [1, '#ef4444'],
      ],
      heatmapColorStops: [
        [0, 'rgba(0, 0, 0, 0)'],
        [0.1, 'rgba(34, 211, 238, 0.35)'],
        [0.3, 'rgba(132, 225, 188, 0.55)'],
        [0.5, 'rgba(253, 224, 71, 0.7)'],
        [0.7, 'rgba(251, 146, 60, 0.85)'],
        [1, 'rgba(239, 68, 68, 0.9)'],
      ],
      neighborhoodOutline: 'rgba(255, 255, 255, 0.5)',
      comparisonColors: {
        cold: 'rgba(30, 64, 175, 0.55)', // #1e40af @ 55%
        mid: 'rgba(0, 0, 0, 0)',
        hot: 'rgba(220, 38, 38, 0.55)', // #dc2626 @ 55%
      },
    },
    ui: {
      headerBg: 'rgba(20, 22, 28, 0.85)',
      headerText: '#f3f4f6',
      headerSubtext: '#9ca3af',
      headerBorder: 'rgba(255, 255, 255, 0.08)',
      toggleBg: 'rgba(255, 255, 255, 0.08)',
      toggleText: '#d1d5db',
      toggleActiveBg: '#2e303a',
      toggleActiveText: '#f9fafb',
      indicatorText: '#9ca3af',
      fixtureIndicatorBg: 'rgba(245, 158, 11, 0.25)',
      fixtureIndicatorText: '#fbbf24',
      legendBg: 'rgba(20, 22, 28, 0.92)',
      legendText: '#e5e7eb',
      legendBorder: 'rgba(255, 255, 255, 0.15)',
      tooltipBg: 'rgba(255, 255, 255, 0.92)',
      tooltipText: '#08060d',
    },
  },
}
