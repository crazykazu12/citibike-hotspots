# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Citi Bike Hotspot Web App

## Project

Citi Bike hotspot web app. Displays a live map of NYC Citi Bike stations and visualizes hotspots (stations with lots of bikes piling up or running out).

## Stack

React + Vite + TypeScript, Leaflet (via react-leaflet), leaflet.heat for heatmaps.

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

`leaflet.heat` has no `@types` package — a local `src/leaflet-heat.d.ts` declaration file is needed before importing it.

Leaflet requires its CSS to be imported explicitly; add `import 'leaflet/dist/leaflet.css'` before using any map components.
