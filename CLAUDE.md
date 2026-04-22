# Citi Bike Hotspot Web App

## Project

Citi Bike hotspot web app. Displays a live map of NYC Citi Bike stations and visualizes hotspots (stations with lots of bikes piling up or running out).

## Stack

React + Vite + TypeScript, Leaflet (via react-leaflet), leaflet.heat for heatmaps.

## Data Source

Public Citi Bike GBFS feed, no auth required.

- Station info (static): https://gbfs.citibikenyc.com/gbfs/en/station_information.json
- Station status (live): https://gbfs.citibikenyc.com/gbfs/en/station_status.json
- Discovery: https://gbfs.citibikenyc.com/gbfs/gbfs.json

Merge on `station_id`. Status updates roughly every 30 seconds.
