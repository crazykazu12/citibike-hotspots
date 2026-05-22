import { useMemo, useRef, useState } from 'react'
import {
  Map as MaplibreMap,
  Source,
  Layer,
  AttributionControl,
  type MapEvent,
  type MapLayerMouseEvent,
  type MapRef,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre'
import maplibregl, {
  type DataDrivenPropertyValueSpecification,
  type ExpressionSpecification,
  type StyleSpecification,
} from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { layers as protomapsLayers } from '@protomaps/basemaps'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'
import type { ComparisonMode, Station } from './types'
import type { StationActivity } from './activity'
import { computeConnectionPoints, type HeatPoint } from './connections'
import type { Theme } from './themes'
import type {
  NeighborhoodActivity,
  NeighborhoodFeatureCollection,
  NeighborhoodProps,
} from './neighborhoods'

export type ViewMode = 'all' | 'hot'

// NYC extract self-hosted on R2 (same Cloudflare account as the Worker + Pages
// project). Built from build.protomaps.com/20260522.pmtiles with bbox covering
// the 5 boroughs + JC/Hoboken (-74.30,40.45,-73.65,40.95) and maxzoom=15.
// Regenerate via the steps in CLAUDE.md ("Regenerating the NYC tile extract").
const PMTILES_URL = 'https://pub-1e4794524da64a1aa8c1dc2c9e85cc47.r2.dev/nyc.pmtiles'
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

// LIGHT.water in @protomaps/basemaps@5.7.2 defaults to a saturated cyan; the
// theme objects spread the flavor and override `water` (and any future keys).
function buildBaseStyle(theme: Theme): StyleSpecification {
  return {
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
    layers: protomapsLayers('protomaps', theme.protomapsFlavor),
  }
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

// Comparison mode: simple zoom-fade. The fill-color expression carries alpha
// (transparent at 0% delta and for null-baseline neighborhoods), so opacity
// here is purely zoom-driven and doesn't read any feature properties.
const COMPARISON_OPACITY: DataDrivenPropertyValueSpecification<number> = [
  'interpolate',
  ['linear'],
  ['zoom'],
  NEIGHBORHOOD_ZOOM_MAX,
  1,
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
      0.3,
      1,
      0.65,
    ],
  ],
  STATION_ZOOM_MIN,
  0,
]

interface NeighborhoodFillProps extends NeighborhoodProps {
  normalizedScore: number
  // Present only in yesterday mode. deltaPercent is unclamped (paint clamps
  // via interpolate boundaries); hasBaseline drives the case branch for the
  // "no data → transparent" path.
  deltaPercent?: number
  hasBaseline?: boolean
}

interface MapProps {
  stations: Station[]
  activity: Map<string, StationActivity>
  neighborhoods: NeighborhoodFeatureCollection | null
  neighborhoodActivity: Map<string, NeighborhoodActivity>
  maxNeighborhoodScore: number
  viewMode: ViewMode
  comparisonMode: ComparisonMode
  theme: Theme
}

interface HoverState {
  x: number
  y: number
  name: string
  // undefined → 'now' mode (no comparison context).
  // null      → 'yesterday' mode, neighborhood had no baseline data.
  // number    → 'yesterday' mode, unclamped delta percent.
  deltaPercent?: number | null
}

type Bounds = [number, number, number, number]

function buildNeighborhoodsGeoJson(
  data: NeighborhoodFeatureCollection,
  activity: Map<string, NeighborhoodActivity>,
  maxScore: number,
  comparisonMode: ComparisonMode,
): FeatureCollection<Feature['geometry'], NeighborhoodFillProps> {
  return {
    type: 'FeatureCollection',
    features: data.features.map((f) => {
      const a = activity.get(f.properties.nta2020)
      const normalizedScore = maxScore > 0 ? (a?.totalScore ?? 0) / maxScore : 0
      const properties: NeighborhoodFillProps = {
        ...f.properties,
        normalizedScore,
      }
      if (comparisonMode === 'yesterday') {
        const dp = a?.deltaPercent
        properties.hasBaseline = dp !== null && dp !== undefined
        // Pass the raw value through — the interpolate paint expression
        // naturally clamps at its boundary stops, and the hover tooltip
        // shows the unclamped value for accuracy.
        properties.deltaPercent = dp ?? 0
      }
      return { ...f, properties }
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
  comparisonMode,
  theme,
}: MapProps) {
  const comparisonActive = comparisonMode === 'yesterday'

  const baseStyle = useMemo(() => buildBaseStyle(theme), [theme])
  const sequentialFillColorExpr = useMemo<DataDrivenPropertyValueSpecification<string>>(
    () => [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'normalizedScore'], 0],
      ...theme.overlays.neighborhoodColorScale.flat(),
    ],
    [theme],
  )
  const comparisonFillColorExpr = useMemo<DataDrivenPropertyValueSpecification<string>>(
    () => [
      'case',
      ['!', ['coalesce', ['get', 'hasBaseline'], false]],
      'rgba(0,0,0,0)',
      [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'deltaPercent'], 0],
        ...theme.overlays.comparisonColorScale.flat(),
      ],
    ],
    [theme],
  )
  const fillColorExpr = comparisonActive ? comparisonFillColorExpr : sequentialFillColorExpr
  // In comparison mode, fill-color carries the alpha (transparent at 0 delta
  // and for null baselines), so the opacity expression just needs to fade
  // with zoom — no data dependency.
  const fillOpacityExpr: DataDrivenPropertyValueSpecification<number> = comparisonActive
    ? COMPARISON_OPACITY
    : viewMode === 'hot'
      ? HOT_ONLY_OPACITY
      : ALL_ZONES_OPACITY

  const heatmapColorExpr = useMemo<ExpressionSpecification>(
    () =>
      [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        ...theme.overlays.heatmapColorStops.flat(),
      ] as unknown as ExpressionSpecification,
    [theme],
  )
  const mapRef = useRef<MapRef>(null)
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [hover, setHover] = useState<HoverState | null>(null)

  const neighborhoodsGeoJson = useMemo(
    () =>
      neighborhoods
        ? buildNeighborhoodsGeoJson(
            neighborhoods,
            neighborhoodActivity,
            maxNeighborhoodScore,
            comparisonMode,
          )
        : null,
    [neighborhoods, neighborhoodActivity, maxNeighborhoodScore, comparisonMode],
  )

  const connectionPoints = useMemo(() => {
    // Heatmap + cluster fills are hidden in comparison mode — short-circuit
    // the expensive cluster detection (BFS over ~2000 stations) to nothing.
    if (comparisonActive) return []
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
  }, [stations, activity, comparisonActive])

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
      const props = f.properties as NeighborhoodFillProps
      const next: HoverState = { x: e.point.x, y: e.point.y, name: props.ntaname }
      if (comparisonActive) {
        next.deltaPercent = props.hasBaseline ? (props.deltaPercent ?? 0) : null
      }
      setHover(next)
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

  const lowZoom = zoom < (NEIGHBORHOOD_ZOOM_MAX + STATION_ZOOM_MIN) / 2
  const legendText = comparisonActive
    ? lowZoom
      ? 'Change vs. yesterday at this time. Red = busier, blue = quieter, transparent = no data or unchanged.'
      : 'Comparison mode shows neighborhood-level change only. Zoom out for the citywide view.'
    : lowZoom
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
        attributionControl={false}
        style={{ position: 'absolute', top: 56, left: 0, right: 0, bottom: 0 }}
      >
        {/* Compact ⓘ control bottom-right. `© OpenStreetMap` in the source's
            `attribution` field is required for ODbL compliance — do not remove. */}
        <AttributionControl compact={true} />
        {neighborhoodsGeoJson && (
          <Source id="neighborhoods" type="geojson" data={neighborhoodsGeoJson}>
            <Layer
              id="neighborhoods-fill"
              type="fill"
              paint={{
                'fill-color': fillColorExpr,
                'fill-opacity': fillOpacityExpr,
              }}
            />
          </Source>
        )}
        {!comparisonActive && (
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
              'heatmap-color': heatmapColorExpr,
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
        )}
        {neighborhoodsGeoJson && (
          <Layer
            id="neighborhoods-outline"
            type="line"
            source="neighborhoods"
            paint={{ 'line-color': theme.overlays.neighborhoodOutline, 'line-width': 1 }}
          />
        )}
      </MaplibreMap>
      {hover && (
        <div className="nbh-tooltip" style={{ left: hover.x, top: hover.y }}>
          {formatHover(hover)}
        </div>
      )}
      <div className="legend">{legendText}</div>
    </>
  )
}

function formatHover(h: HoverState): string {
  if (h.deltaPercent === undefined) return h.name
  if (h.deltaPercent === null) return `${h.name} · no data`
  const rounded = Math.round(h.deltaPercent)
  const sign = rounded > 0 ? '+' : ''
  return `${h.name} · ${sign}${rounded}%`
}
