# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Where in the Citi?

## Project

"Where in the Citi?" — a real-time visualization of NYC Citi Bike activity. Displays a live map of stations and surfaces hotspots (areas with lots of bikes piling up or running out). The app was previously named "Citi Bike Hotspots"; the npm package name (`citi-bikes`) is the repo identifier and is intentionally unchanged.

## Stack

React + Vite + TypeScript. MapLibre GL JS (via `react-map-gl/maplibre`) for the map, Protomaps PMTiles + `@protomaps/basemaps` for the basemap, MapLibre's native heatmap layer for hotspot visualization.

## Commands

```bash
npm run dev      # start dev server at http://localhost:5173
npm run build    # type-check + production build (tsc -b && vite build)
npm run lint     # ESLint
npm run preview  # serve the production build locally
```

No test runner is configured yet.

## Data Source

Public Citi Bike GBFS feed, no auth required.

- Station info (static): https://gbfs.citibikenyc.com/gbfs/en/station_information.json
- Station status (live): https://gbfs.citibikenyc.com/gbfs/en/station_status.json
- Discovery: https://gbfs.citibikenyc.com/gbfs/gbfs.json

Merge on `station_id`. Status updates roughly every 30 seconds.

## Architecture

Entry point: `index.html` → `src/main.tsx` → `src/App.tsx`.

MapLibre requires its CSS — `import 'maplibre-gl/dist/maplibre-gl.css'` is in `src/Map.tsx`.

PMTiles is registered as a custom protocol once at module scope in `src/Map.tsx` so MapLibre can resolve `pmtiles://` URLs. Guard against double-registration if HMR re-runs the module.

Crossfade between neighborhood polygons (low zoom) and station heatmap (high zoom) uses MapLibre paint expressions — `['interpolate', ['linear'], ['zoom'], 14, …, 15, …]`. The map re-evaluates these every frame; no React state involved in the actual fade.

Heatmap weight is normalized within the currently visible map bounds, recomputed in the React layer on `moveend`. Neighborhood color uses absolute (city-wide) score normalization.

Tiles come from the Protomaps demo PMTiles bucket — fine for development, needs self-hosting before any public release.

## Development: Fixture Mode

For iterating on visualization parameters without waiting for the rolling window to refill (~5 min on live data), the app supports a fixture mode that replays pre-saved GBFS snapshots.

**Enable** by setting `VITE_USE_FIXTURES=true` in `.env.local` (see `.env.local.example`). Restart `npm run dev`. The app loads `src/fixtures/stations.json` and `src/fixtures/snapshots.json` on startup, fills the rolling window instantly, and skips all subsequent polling so the heatmap stays frozen for stable visual comparison. A "FIXTURE MODE — frozen data" badge appears in the top-left so it's impossible to forget you're not on live data.

**Capture new fixture data** by running the live app (no env var), waiting for the rolling window to fill (10 snapshots, ~5 min), then in DevTools:
```js
window.__downloadFixtures()
```
Two files (`snapshots.json`, `stations.json`) download to your machine; move them into `src/fixtures/` (overwriting the existing files).

**Production safety**: the `VITE_USE_FIXTURES` check uses a Vite env var that becomes a string literal at build time. When unset, the entire fixture-loading branch (including the dynamic JSON imports) is dead-coded out of the production bundle — verified by `grep` against `dist/` after `npm run build`. The fixture JSON files are never included in production builds.

The dev-globals (`window.__snapshots`, `window.__stations`, `window.__dumpFixtures`, `window.__downloadFixtures`) are also gated behind `import.meta.env.DEV` and tree-shake out of production.

## Project Journal
A running log of decisions and changes lives in PROJECT_JOURNAL.md at the project root.
After meaningful changes, append a Build Log entry there.