# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Citi Bike Hotspot Web App

## Project

Citi Bike hotspot web app. Displays a live map of NYC Citi Bike stations and visualizes hotspots (stations with lots of bikes piling up or running out).

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

## Project Journal
A running log of decisions and changes lives in PROJECT_JOURNAL.md at the project root.
After meaningful changes, append a Build Log entry there.