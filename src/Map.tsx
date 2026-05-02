import { useMemo, useState } from 'react'
import {
  Map as MaplibreMap,
  Source,
  Layer,
  type MapEvent,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre'
import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { layers as protomapsLayers, LIGHT } from '@protomaps/basemaps'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, Point } from 'geojson'
import type { Station } from './types'
import type { StationActivity } from './activity'
import type {
  NeighborhoodActivity,
  NeighborhoodFeatureCollection,
  NeighborhoodProps,
} from './neighborhoods'

const PMTILES_URL = 'https://demo-bucket.protomaps.com/v4.pmtiles'
const NEIGHBORHOOD_ZOOM_MAX = 14
const STATION_ZOOM_MIN = 15
const INITIAL_LON = -73.99
const INITIAL_LAT = 40.74
const INITIAL_ZOOM = 12

type MaplibreWithRegistry = typeof maplibregl & { _pmtilesRegistered?: boolean }
const ml = maplibregl as MaplibreWithRegistry
if (!ml._pmtilesRegistered) {
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  ml._pmtilesRegistered = true
}

const baseStyle: StyleSpecification = {
  version: 8,
  glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
  sources: {
    protomaps: {
      type: 'vector',
      url: `pmtiles://${PMTILES_URL}`,
      attribution:
        '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
    },
  },
  layers: protomapsLayers('protomaps', LIGHT),
}

interface NeighborhoodFillProps extends NeighborhoodProps {
  normalizedScore: number
}

interface MapProps {
  stations: Station[]
  activity: Map<string, StationActivity>
  neighborhoods: NeighborhoodFeatureCollection | null
  neighborhoodActivity: Map<string, NeighborhoodActivity>
  maxNeighborhoodScore: number
}

type Bounds = [number, number, number, number]

function buildNeighborhoodsGeoJson(
  data: NeighborhoodFeatureCollection,
  activity: Map<string, NeighborhoodActivity>,
  maxScore: number,
): FeatureCollection<Feature['geometry'], NeighborhoodFillProps> {
  return {
    type: 'FeatureCollection',
    features: data.features.map((f) => {
      const a = activity.get(f.properties.nta2020)
      const normalizedScore = maxScore > 0 ? (a?.totalScore ?? 0) / maxScore : 0
      return {
        ...f,
        properties: { ...f.properties, normalizedScore },
      }
    }),
  } as FeatureCollection<Feature['geometry'], NeighborhoodFillProps>
}

function buildStationsGeoJson(
  stations: Station[],
  activity: Map<string, StationActivity>,
  bounds: Bounds | null,
): FeatureCollection<Point, { normalizedWeight: number }> {
  let visibleMax = 0
  if (bounds) {
    const [west, south, east, north] = bounds
    for (const s of stations) {
      if (s.lon < west || s.lon > east || s.lat < south || s.lat > north) continue
      const score = activity.get(s.station_id)?.score ?? 0
      if (score > visibleMax) visibleMax = score
    }
  }
  return {
    type: 'FeatureCollection',
    features: stations.map((s) => {
      const score = activity.get(s.station_id)?.score ?? 0
      const normalizedWeight = visibleMax > 0 ? score / visibleMax : 0
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { normalizedWeight },
      }
    }),
  }
}

export function Map({
  stations,
  activity,
  neighborhoods,
  neighborhoodActivity,
  maxNeighborhoodScore,
}: MapProps) {
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [zoom, setZoom] = useState(INITIAL_ZOOM)

  const neighborhoodsGeoJson = useMemo(
    () =>
      neighborhoods
        ? buildNeighborhoodsGeoJson(neighborhoods, neighborhoodActivity, maxNeighborhoodScore)
        : null,
    [neighborhoods, neighborhoodActivity, maxNeighborhoodScore],
  )

  const stationsGeoJson = useMemo(
    () => buildStationsGeoJson(stations, activity, bounds),
    [stations, activity, bounds],
  )

  function handleViewportSync(map: maplibregl.Map) {
    const b = map.getBounds()
    setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    setZoom(map.getZoom())
  }

  const onLoad = (e: MapEvent) => handleViewportSync(e.target)
  const onMoveEnd = (e: ViewStateChangeEvent) => handleViewportSync(e.target)

  const legendText =
    zoom < (NEIGHBORHOOD_ZOOM_MAX + STATION_ZOOM_MIN) / 2
      ? 'Colored neighborhoods = busiest areas city-wide. Zoom in to see hotspots within an area.'
      : 'Hot zones = stations active relative to what’s currently visible. Pan to re-scale.'

  return (
    <>
      <MaplibreMap
        initialViewState={{ longitude: INITIAL_LON, latitude: INITIAL_LAT, zoom: INITIAL_ZOOM }}
        mapStyle={baseStyle}
        onLoad={onLoad}
        onMoveEnd={onMoveEnd}
        style={{ width: '100vw', height: '100vh' }}
      >
        {neighborhoodsGeoJson && (
          <Source id="neighborhoods" type="geojson" data={neighborhoodsGeoJson}>
            <Layer
              id="neighborhoods-fill"
              type="fill"
              paint={{
                'fill-color': [
                  'interpolate',
                  ['linear'],
                  ['coalesce', ['get', 'normalizedScore'], 0],
                  0,
                  '#3b82f6',
                  1,
                  '#ef4444',
                ],
                'fill-opacity': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  NEIGHBORHOOD_ZOOM_MAX,
                  0.55,
                  STATION_ZOOM_MIN,
                  0,
                ],
              }}
            />
            <Layer
              id="neighborhoods-outline"
              type="line"
              paint={{ 'line-color': '#888', 'line-width': 1 }}
            />
          </Source>
        )}
        <Source id="stations" type="geojson" data={stationsGeoJson}>
          <Layer
            id="stations-heat"
            type="heatmap"
            paint={{
              'heatmap-weight': ['coalesce', ['get', 'normalizedWeight'], 0],
              'heatmap-intensity': 1,
              'heatmap-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                NEIGHBORHOOD_ZOOM_MAX,
                20,
                17,
                40,
              ],
              'heatmap-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                NEIGHBORHOOD_ZOOM_MAX,
                0,
                STATION_ZOOM_MIN,
                1,
              ],
            }}
          />
        </Source>
      </MaplibreMap>
      <div className="legend">{legendText}</div>
    </>
  )
}
