import { useMemo, useRef, useState } from 'react'
import {
  Map as MaplibreMap,
  Source,
  Layer,
  type MapEvent,
  type MapLayerMouseEvent,
  type MapRef,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre'
import maplibregl, {
  type DataDrivenPropertyValueSpecification,
  type StyleSpecification,
} from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { layers as protomapsLayers, LIGHT } from '@protomaps/basemaps'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'
import type { Station } from './types'
import type { StationActivity } from './activity'
import { computeConnectionPoints, type HeatPoint } from './connections'
import type {
  NeighborhoodActivity,
  NeighborhoodFeatureCollection,
  NeighborhoodProps,
} from './neighborhoods'

export type ViewMode = 'all' | 'hot'

const PMTILES_URL = 'https://demo-bucket.protomaps.com/v4.pmtiles'
const NEIGHBORHOOD_ZOOM_MAX = 13
const STATION_ZOOM_MIN = 14.5
const HOT_ONLY_THRESHOLD = 0.35
const HOVER_TOOLTIP_MAX_ZOOM = 15
const FIT_BOUNDS_PADDING = 40
const FIT_BOUNDS_DURATION_MS = 1000
const INITIAL_CENTER: [number, number] = [-73.94, 40.73]
const INITIAL_ZOOM = 8.25
const MIN_ZOOM = 8.25
const MAX_ZOOM = 18
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-74.7, 40.2],
  [-73.2, 41.2],
]
const INTERACTIVE_LAYER_IDS = ['neighborhoods-fill']

type MaplibreWithRegistry = typeof maplibregl & { _pmtilesRegistered?: boolean }
const ml = maplibregl as MaplibreWithRegistry
if (!ml._pmtilesRegistered) {
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  ml._pmtilesRegistered = true
}

// LIGHT.water is #80deea (saturated cyan) in @protomaps/basemaps@5.7.2;
// override to a muted pale blue-gray that doesn't compete with the heatmap.
const lightFlavor = { ...LIGHT, water: '#cad2d3' }

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
  layers: protomapsLayers('protomaps', lightFlavor),
}

const ALL_ZONES_OPACITY: DataDrivenPropertyValueSpecification<number> = [
  'interpolate',
  ['linear'],
  ['zoom'],
  NEIGHBORHOOD_ZOOM_MAX,
  0.55,
  STATION_ZOOM_MIN,
  0,
]

const HOT_ONLY_OPACITY: DataDrivenPropertyValueSpecification<number> = [
  'interpolate',
  ['linear'],
  ['zoom'],
  NEIGHBORHOOD_ZOOM_MAX,
  [
    'case',
    ['<', ['coalesce', ['get', 'normalizedScore'], 0], HOT_ONLY_THRESHOLD],
    0,
    [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'normalizedScore'], 0],
      HOT_ONLY_THRESHOLD,
      0.4,
      1,
      0.85,
    ],
  ],
  STATION_ZOOM_MIN,
  0,
]

interface NeighborhoodFillProps extends NeighborhoodProps {
  normalizedScore: number
}

interface MapProps {
  stations: Station[]
  activity: Map<string, StationActivity>
  neighborhoods: NeighborhoodFeatureCollection | null
  neighborhoodActivity: Map<string, NeighborhoodActivity>
  maxNeighborhoodScore: number
  viewMode: ViewMode
}

interface HoverState {
  x: number
  y: number
  name: string
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

function buildHeatGeoJson(
  stations: Station[],
  activity: Map<string, StationActivity>,
  connectionPoints: HeatPoint[],
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
    for (const p of connectionPoints) {
      if (p.lon < west || p.lon > east || p.lat < south || p.lat > north) continue
      if (p.weight > visibleMax) visibleMax = p.weight
    }
  }
  const features: FeatureCollection<Point, { normalizedWeight: number }>['features'] = []
  for (const s of stations) {
    const score = activity.get(s.station_id)?.score ?? 0
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { normalizedWeight: visibleMax > 0 ? score / visibleMax : 0 },
    })
  }
  for (const p of connectionPoints) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { normalizedWeight: visibleMax > 0 ? p.weight / visibleMax : 0 },
    })
  }
  return { type: 'FeatureCollection', features }
}

function geometryBbox(geom: Polygon | MultiPolygon): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat()
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return [minX, minY, maxX, maxY]
}

export function Map({
  stations,
  activity,
  neighborhoods,
  neighborhoodActivity,
  maxNeighborhoodScore,
  viewMode,
}: MapProps) {
  const mapRef = useRef<MapRef>(null)
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [hover, setHover] = useState<HoverState | null>(null)

  const neighborhoodsGeoJson = useMemo(
    () =>
      neighborhoods
        ? buildNeighborhoodsGeoJson(neighborhoods, neighborhoodActivity, maxNeighborhoodScore)
        : null,
    [neighborhoods, neighborhoodActivity, maxNeighborhoodScore],
  )

  const connectionPoints = useMemo(() => {
    const result = computeConnectionPoints(stations, activity)
    if (import.meta.env.DEV) {
      const { pairCount, groupCount } = result.stats
      console.log(
        `heat points: ${stations.length} stations + ${result.corridorPoints.length} corridor + ${result.clusterFillPoints.length} cluster fill (from ${
          pairCount + groupCount
        } clusters: ${pairCount} pairs, ${groupCount} groups)`,
      )
    }
    return [...result.corridorPoints, ...result.clusterFillPoints]
  }, [stations, activity])

  const stationsGeoJson = useMemo(
    () => buildHeatGeoJson(stations, activity, connectionPoints, bounds),
    [stations, activity, connectionPoints, bounds],
  )

  function handleViewportSync(map: maplibregl.Map) {
    const b = map.getBounds()
    setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    setZoom(map.getZoom())
  }

  const onLoad = (e: MapEvent) => handleViewportSync(e.target)
  const onMoveEnd = (e: ViewStateChangeEvent) => handleViewportSync(e.target)

  const onMouseMove = (e: MapLayerMouseEvent) => {
    if (e.target.getZoom() >= HOVER_TOOLTIP_MAX_ZOOM) {
      if (hover) setHover(null)
      return
    }
    const f = e.features?.[0]
    if (f) {
      const props = f.properties as NeighborhoodProps
      setHover({ x: e.point.x, y: e.point.y, name: props.ntaname })
    } else if (hover) {
      setHover(null)
    }
  }

  const onMouseLeave = () => {
    if (hover) setHover(null)
  }

  const onClick = (e: MapLayerMouseEvent) => {
    if (e.target.getZoom() >= STATION_ZOOM_MIN) return
    const f = e.features?.[0]
    if (!f) return
    const props = f.properties as NeighborhoodFillProps
    if (viewMode === 'hot' && (props.normalizedScore ?? 0) < HOT_ONLY_THRESHOLD) return
    const geom = f.geometry
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return
    const map = mapRef.current?.getMap()
    if (!map) return
    const [w, s, ee, n] = geometryBbox(geom as Polygon | MultiPolygon)
    map.fitBounds(
      [
        [w, s],
        [ee, n],
      ],
      { padding: FIT_BOUNDS_PADDING, duration: FIT_BOUNDS_DURATION_MS },
    )
    setHover(null)
  }

  const legendText =
    zoom < (NEIGHBORHOOD_ZOOM_MAX + STATION_ZOOM_MIN) / 2
      ? viewMode === 'hot'
        ? 'Showing only the busiest neighborhoods citywide. Click one to zoom in.'
        : 'Colored neighborhoods = busiest areas city-wide. Click one to zoom in.'
      : 'Hot zones = stations active relative to what’s currently visible. Pan to re-scale.'

  return (
    <>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: INITIAL_CENTER[0],
          latitude: INITIAL_CENTER[1],
          zoom: INITIAL_ZOOM,
        }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={MAX_BOUNDS}
        mapStyle={baseStyle}
        interactiveLayerIds={INTERACTIVE_LAYER_IDS}
        cursor={hover ? 'pointer' : ''}
        onLoad={onLoad}
        onMoveEnd={onMoveEnd}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        style={{ width: '100vw', height: 'calc(100vh - 56px)', marginTop: 56 }}
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
                'fill-opacity': viewMode === 'hot' ? HOT_ONLY_OPACITY : ALL_ZONES_OPACITY,
              }}
            />
          </Source>
        )}
        <Source id="stations" type="geojson" data={stationsGeoJson}>
          <Layer
            id="stations-heat"
            type="heatmap"
            paint={{
              'heatmap-weight': ['coalesce', ['get', 'normalizedWeight'], 0],
              'heatmap-intensity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                NEIGHBORHOOD_ZOOM_MAX,
                0.6,
                17,
                1.2,
              ],
              'heatmap-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                NEIGHBORHOOD_ZOOM_MAX,
                40,
                17,
                140,
              ],
              'heatmap-color': [
                'interpolate',
                ['linear'],
                ['heatmap-density'],
                0,
                'rgba(0, 0, 0, 0)',
                0.1,
                'rgba(33, 102, 172, 0.4)',
                0.3,
                'rgba(103, 169, 207, 0.6)',
                0.5,
                'rgba(253, 219, 199, 0.8)',
                0.7,
                'rgba(244, 109, 67, 0.75)',
                1,
                'rgba(178, 24, 43, 0.7)',
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
        {neighborhoodsGeoJson && (
          <Layer
            id="neighborhoods-outline"
            type="line"
            source="neighborhoods"
            paint={{ 'line-color': '#888', 'line-width': 1 }}
          />
        )}
      </MaplibreMap>
      {hover && (
        <div className="nbh-tooltip" style={{ left: hover.x, top: hover.y }}>
          {hover.name}
        </div>
      )}
      <div className="legend">{legendText}</div>
    </>
  )
}
