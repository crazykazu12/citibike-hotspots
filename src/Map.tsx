import { useMemo, useRef, useState } from 'react'
import {
  Map as MaplibreMap,
  Source,
  Layer,
  AttributionControl,
  Popup,
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
// Per-baseline saturation cap for the comparison diverging color scale. Values
// beyond ±cap clamp to the boundary color via MapLibre's interpolate; the hover
// tooltip continues to show the unclamped raw deltaPercent. Peak color alpha
// lives in theme.overlays.comparisonColors (set to 0.55 so peaks render at the
// same softness as Now-mode's ALL_ZONES_OPACITY=0.55 rather than fully opaque).
//
//   1hour:    tuned 2026-05-22 against 110 live samples — IQR was [-31%, +44%],
//             p90 ≈ +148%; cap=100 makes typical movement clearly colored while
//             leaving ~19% of neighborhoods to saturate as outliers.
//   yesterday: PROVISIONAL — tune once 24h of data exists (~2026-05-23 18:00 UTC).
//   lastweek:  PROVISIONAL — tune once 7d of data exists (~2026-05-29 18:00 UTC).
const COMPARISON_CAPS: Record<Exclude<ComparisonMode, 'none'>, number> = {
  '1hour': 100,
  yesterday: 75,
  lastweek: 100,
}

const PMTILES_URL = 'https://pub-1e4794524da64a1aa8c1dc2c9e85cc47.r2.dev/nyc.pmtiles'
const NEIGHBORHOOD_ZOOM_MAX = 13
const STATION_ZOOM_MIN = 14.5
const HOT_ONLY_THRESHOLD = 0.35
const HOVER_TOOLTIP_MAX_ZOOM = 15
const FIT_BOUNDS_PADDING = 40
const FIT_BOUNDS_DURATION_MS = 1000
const INITIAL_CENTER: [number, number] = [-73.94, 40.73]
// Both are floors. MapLibre auto-clamps the effective minimum zoom upward on
// wider viewports to keep MAX_BOUNDS contained — see _constrainCamera() — so
// on screens wider than ~817 px the actual minimum will be higher than 10.
const INITIAL_ZOOM = 10
const MIN_ZOOM = 10
const MAX_ZOOM = 18
// Inset slightly from the R2 tile extract's bbox (-74.30/40.45/-73.65/40.95)
// so the viewport never reaches an edge where the extract has no tile data.
// Without this, panning past the bbox reveals MapLibre's empty background as
// gray. This is the actual fix for the "gray on pan" symptom; the prior
// page-layout fixes (position:fixed, overflow:hidden, overscroll-behavior,
// pinned html/body in src/index.css) are correct hardening but were not the
// cause — see PROJECT_JOURNAL.md 2026-05-22 entries.
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-74.28, 40.47],
  [-73.67, 40.93],
]
// POI layer IDs are referenced unconditionally — MapLibre silently ignores
// layer IDs that don't exist (so referencing them while a source is unmounted
// is harmless). When a category is loaded, click events route to the popup /
// cluster-zoom branches; otherwise these IDs are no-ops. Branching uses the
// '-clusters'/'-points' suffix so adding a new point category is a one-line
// change to the helper-component instances and INTERACTIVE_LAYER_IDS.
const INTERACTIVE_LAYER_IDS = [
  'neighborhoods-fill',
  'bars-clusters', 'bars-points',
  'coffee-clusters', 'coffee-points',
  'food-clusters', 'food-points',
  'parks-fill',
]

// POI category colors. Each is distinct from the cyan→yellow→red bike-activity
// gradient AND from UI-chrome colors like --accent (focus outlines).
const BAR_COLOR = '#a78bfa'    // violet-400
const COFFEE_COLOR = '#a16207' // yellow-700 (browner amber; clear of the heatmap's hot-end orange)
const FOOD_COLOR = '#ec4899'   // pink-500
// Parks use baked-alpha rgba so a single POI_ZOOM_FADE interpolate can act as
// a 0→1 opacity multiplier without separate fill/outline fade constants.
// At full zoom: fill 30%, outline 65%. Bumped slightly so the overlay reads
// as clearly more saturated than the Protomaps dark-theme ambient park-green.
const PARKS_FILL_COLOR = 'rgba(34, 197, 94, 0.30)'    // #22c55e @ 30%
const PARKS_OUTLINE_COLOR = 'rgba(34, 197, 94, 0.65)' // #22c55e @ 65%

// POI zoom-fade — mirrors the heatmap's opacity interpolate exactly. POIs are
// invisible at city zoom (≤13), fade in over 13→14.5, fully visible at 14.5+.
// Used uniformly across all four POI categories so toggle behavior is
// consistent: every layer is hidden when zoomed out and fades in at the same
// zoom level as the station heatmap.
const POI_ZOOM_FADE: DataDrivenPropertyValueSpecification<number> = [
  'interpolate',
  ['linear'],
  ['zoom'],
  13, // NEIGHBORHOOD_ZOOM_MAX
  0,
  14.5, // STATION_ZOOM_MIN
  1,
]

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
  // POI overlay — bars (Phase 2 pattern-setter for the four POI categories).
  // barsData is null until the user first toggles on; once loaded, stays.
  // Visibility flips via the layer-level `visibility` prop so the source
  // and cluster index aren't torn down on every toggle.
  barsEnabled: boolean
  // FeatureCollection per category. Loose typing matches the hook's default
  // return — narrowing here would force generic plumbing for no payoff.
  // null until the user first toggles the category on; stays cached after.
  barsData: FeatureCollection | null
  coffeeEnabled: boolean
  coffeeData: FeatureCollection | null
  foodEnabled: boolean
  foodData: FeatureCollection | null
  parksEnabled: boolean
  parksData: FeatureCollection | null
}

interface PoiPopupState {
  lon: number
  lat: number
  name: string
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
      if (comparisonMode !== 'none') {
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
): FeatureCollection<Point, { normalizedWeight: number }> {
  // Citywide-max normalization (basis = max station score OR connection-point
  // weight across the full dataset). Previously this was viewport-relative
  // (visible-only max) and re-run on every moveend; that crashed all other
  // bubbles' normalized weight below the heatmap-color visible-density floor
  // whenever a hot station entered the viewport. The original "feels fine"
  // bounds-relative design (2026-04-26 migration journal entry) did not hold
  // up on live data — see PROJECT_JOURNAL 2026-05-22 "switched to global
  // station-max normalization" entry. Tradeoff: outer-borough heat is dimmer
  // relative to citywide hotspots; revisit with quantile normalization if it
  // becomes a problem.
  let globalMax = 0
  for (const s of stations) {
    const score = activity.get(s.station_id)?.score ?? 0
    if (score > globalMax) globalMax = score
  }
  for (const p of connectionPoints) {
    if (p.weight > globalMax) globalMax = p.weight
  }
  const features: FeatureCollection<Point, { normalizedWeight: number }>['features'] = []
  for (const s of stations) {
    const score = activity.get(s.station_id)?.score ?? 0
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { normalizedWeight: globalMax > 0 ? score / globalMax : 0 },
    })
  }
  for (const p of connectionPoints) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { normalizedWeight: globalMax > 0 ? p.weight / globalMax : 0 },
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
  barsEnabled,
  barsData,
  coffeeEnabled,
  coffeeData,
  foodEnabled,
  foodData,
  parksEnabled,
  parksData,
}: MapProps) {
  const [poiPopup, setPoiPopup] = useState<PoiPopupState | null>(null)
  const comparisonActive = comparisonMode !== 'none'

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
    () => {
      // 'none' fallback is unreachable in practice (this expression isn't
      // selected when comparisonActive is false), but the type narrows.
      const cap = comparisonMode !== 'none' ? COMPARISON_CAPS[comparisonMode] : 100
      const { cold, mid, hot } = theme.overlays.comparisonColors
      return [
        'case',
        ['!', ['coalesce', ['get', 'hasBaseline'], false]],
        'rgba(0,0,0,0)',
        [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'deltaPercent'], 0],
          -cap,
          cold,
          0,
          mid,
          cap,
          hot,
        ],
      ]
    },
    [theme, comparisonMode],
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
    () => buildHeatGeoJson(stations, activity, connectionPoints),
    [stations, activity, connectionPoints],
  )

  function handleZoomSync(map: maplibregl.Map) {
    setZoom(map.getZoom())
  }

  const onLoad = (e: MapEvent) => handleZoomSync(e.target)
  const onMoveEnd = (e: ViewStateChangeEvent) => handleZoomSync(e.target)

  const onMouseMove = (e: MapLayerMouseEvent) => {
    if (e.target.getZoom() >= HOVER_TOOLTIP_MAX_ZOOM) {
      if (hover) setHover(null)
      return
    }
    // Filter to neighborhood features only — POI layers are also in
    // INTERACTIVE_LAYER_IDS for click handling, but they don't drive the
    // hover tooltip (which reads NeighborhoodFillProps). A bar marker as the
    // first hit would crash on .ntaname.
    const f = e.features?.find((x) => x.layer?.id === 'neighborhoods-fill')
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
    const map = mapRef.current?.getMap()
    if (!map) return
    // POI layers handled first — at high zoom they're the only interactive
    // thing (neighborhood click-to-zoom is intentionally disabled when
    // zoomed in past STATION_ZOOM_MIN). The '-clusters'/'-points'/'parks-fill'
    // suffix matching lets a single branch handle all four POI categories.
    const features = e.features ?? []
    const cluster = features.find((x) => x.layer?.id?.endsWith('-clusters'))
    if (cluster && cluster.layer?.id) {
      const sourceId = cluster.layer.id.replace(/-clusters$/, '')
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
      const cid = cluster.properties?.cluster_id as number | undefined
      if (src && cid !== undefined && cluster.geometry.type === 'Point') {
        const [lon, lat] = cluster.geometry.coordinates as [number, number]
        src.getClusterExpansionZoom(cid).then((zoom) => {
          map.easeTo({ center: [lon, lat], zoom, duration: 500 })
        }).catch((err) => console.error('cluster expansion failed', err))
      }
      return
    }
    const poi = features.find((x) => x.layer?.id?.endsWith('-points'))
    if (poi && poi.geometry.type === 'Point') {
      const [lon, lat] = poi.geometry.coordinates as [number, number]
      const name = (poi.properties?.name as string | undefined) ?? 'Unnamed'
      setPoiPopup({ lon, lat, name })
      return
    }
    const park = features.find((x) => x.layer?.id === 'parks-fill')
    if (park) {
      // Parks are polygons — popup at click point (not centroid) so the popup
      // appears where the user clicked instead of jumping to the polygon's
      // mean for large parks like Central Park.
      const name = (park.properties?.name as string | undefined) ?? 'Unnamed park'
      setPoiPopup({ lon: e.lngLat.lng, lat: e.lngLat.lat, name })
      return
    }
    // Fall through to neighborhood click-to-zoom (existing behavior, unchanged).
    if (e.target.getZoom() >= STATION_ZOOM_MIN) return
    const f = features.find((x) => x.layer?.id === 'neighborhoods-fill')
    if (!f) return
    const props = f.properties as NeighborhoodFillProps
    if (viewMode === 'hot' && (props.normalizedScore ?? 0) < HOT_ONLY_THRESHOLD) return
    const geom = f.geometry
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return
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
  const comparisonBaselineLabel =
    comparisonMode === '1hour'
      ? '1 hour ago'
      : comparisonMode === 'lastweek'
        ? 'this time last week'
        : 'yesterday at this time'
  const legendText = comparisonActive
    ? lowZoom
      ? `Change vs. ${comparisonBaselineLabel}. Red = busier, blue = quieter, transparent = no data or unchanged.`
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
        style={{ position: 'fixed', top: 56, left: 0, right: 0, bottom: 0 }}
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
        {/* POI overlays. Each category's Source mounts only after first
            toggle-on (when its data becomes non-null) and stays mounted
            thereafter; per-layer visibility flips with the enabled flag so
            MapLibre's cluster index isn't torn down on every toggle.
            clusterMaxZoom is deliberately ABOVE the 13→14.5 fade band so the
            cluster→individual transition fires at full opacity, not mid-fade.
            Food clusters one zoom-level longer (16 vs 15) because it's 8×
            denser than bars/coffee — keeps zoom-17 viewports readable instead
            of a pin-blanket. */}
        <PoiPointLayer
          sourceId="bars"
          data={barsData}
          color={BAR_COLOR}
          enabled={barsEnabled}
          clusterMaxZoom={15}
          clusterRadius={50}
        />
        <PoiPointLayer
          sourceId="coffee"
          data={coffeeData}
          color={COFFEE_COLOR}
          enabled={coffeeEnabled}
          clusterMaxZoom={15}
          clusterRadius={50}
        />
        <PoiPointLayer
          sourceId="food"
          data={foodData}
          color={FOOD_COLOR}
          enabled={foodEnabled}
          clusterMaxZoom={16}
          clusterRadius={60}
        />
        <PoiPolygonLayer
          sourceId="parks"
          data={parksData}
          fillColor={PARKS_FILL_COLOR}
          outlineColor={PARKS_OUTLINE_COLOR}
          enabled={parksEnabled}
        />
        {poiPopup && (
          <Popup
            longitude={poiPopup.lon}
            latitude={poiPopup.lat}
            anchor="bottom"
            offset={10}
            closeButton
            closeOnClick={false}
            onClose={() => setPoiPopup(null)}
            className="poi-popup"
          >
            {poiPopup.name}
          </Popup>
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

// Renders a clustered point category (bars, coffee, food). Source mounts when
// `data` is non-null (i.e. after the user first toggles the category on) and
// stays mounted for the lifetime of the Map so visibility toggles are cheap.
// Layer IDs follow the `${sourceId}-{clusters,cluster-count,points}` pattern
// matched by the generic onClick branching.
function PoiPointLayer({
  sourceId,
  data,
  color,
  enabled,
  clusterMaxZoom,
  clusterRadius,
}: {
  sourceId: string
  data: FeatureCollection | null
  color: string
  enabled: boolean
  clusterMaxZoom: number
  clusterRadius: number
}) {
  if (!data) return null
  const vis = enabled ? 'visible' : 'none'
  return (
    <Source
      id={sourceId}
      type="geojson"
      data={data}
      cluster
      clusterRadius={clusterRadius}
      clusterMaxZoom={clusterMaxZoom}
    >
      <Layer
        id={`${sourceId}-clusters`}
        type="circle"
        filter={['has', 'point_count']}
        layout={{ visibility: vis }}
        paint={{
          'circle-color': color,
          'circle-opacity': POI_ZOOM_FADE,
          'circle-stroke-color': 'rgba(255, 255, 255, 0.85)',
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': POI_ZOOM_FADE,
          'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 22],
        }}
      />
      <Layer
        id={`${sourceId}-cluster-count`}
        type="symbol"
        filter={['has', 'point_count']}
        layout={{
          visibility: vis,
          'text-field': '{point_count_abbreviated}',
          'text-size': 11,
          'text-font': ['Noto Sans Regular'],
          'text-allow-overlap': true,
        }}
        paint={{
          'text-color': '#ffffff',
          'text-opacity': POI_ZOOM_FADE,
        }}
      />
      <Layer
        id={`${sourceId}-points`}
        type="circle"
        filter={['!', ['has', 'point_count']]}
        layout={{ visibility: vis }}
        paint={{
          'circle-color': color,
          'circle-opacity': POI_ZOOM_FADE,
          'circle-radius': 5,
          'circle-stroke-color': 'rgba(255, 255, 255, 0.85)',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': POI_ZOOM_FADE,
        }}
      />
    </Source>
  )
}

// Renders a polygon category (parks). No clustering — clusters are
// meaningless for polygons. The geometry-type filter drops the handful of
// stray Point-tagged "parks" in the source (OSM label markers that aren't
// real polygon areas). Alpha baked into the color so POI_ZOOM_FADE acts as a
// simple 0→1 opacity multiplier matching the point-category fade.
function PoiPolygonLayer({
  sourceId,
  data,
  fillColor,
  outlineColor,
  enabled,
}: {
  sourceId: string
  data: FeatureCollection | null
  fillColor: string
  outlineColor: string
  enabled: boolean
}) {
  if (!data) return null
  const vis = enabled ? 'visible' : 'none'
  const polygonOnly: ExpressionSpecification = ['!=', ['geometry-type'], 'Point']
  return (
    <Source id={sourceId} type="geojson" data={data}>
      <Layer
        id={`${sourceId}-fill`}
        type="fill"
        filter={polygonOnly}
        layout={{ visibility: vis }}
        paint={{
          'fill-color': fillColor,
          'fill-opacity': POI_ZOOM_FADE,
        }}
      />
      <Layer
        id={`${sourceId}-outline`}
        type="line"
        filter={polygonOnly}
        layout={{ visibility: vis }}
        paint={{
          'line-color': outlineColor,
          'line-opacity': POI_ZOOM_FADE,
          'line-width': 1,
        }}
      />
    </Source>
  )
}

function formatHover(h: HoverState): string {
  if (h.deltaPercent === undefined) return h.name
  if (h.deltaPercent === null) return `${h.name} · no data`
  const rounded = Math.round(h.deltaPercent)
  const sign = rounded > 0 ? '+' : ''
  return `${h.name} · ${sign}${rounded}%`
}
