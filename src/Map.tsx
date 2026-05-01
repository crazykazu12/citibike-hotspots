import { useState } from 'react'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMapEvents,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Station } from './types'
import type { StationActivity } from './activity'
import type { NeighborhoodActivity, NeighborhoodFeatureCollection } from './neighborhoods'
import { Heatmap } from './Heatmap'
import { NeighborhoodLayer } from './NeighborhoodLayer'

const INITIAL_ZOOM = 12
const NEIGHBORHOOD_ZOOM_MAX = 14
const STATION_ZOOM_MIN = 15
// Crossfade boundaries align with the threshold zoom levels above
const TRANSITION_ZOOM_START = NEIGHBORHOOD_ZOOM_MAX
const TRANSITION_ZOOM_END = STATION_ZOOM_MIN

interface MapProps {
  stations: Station[]
  activity: Map<string, StationActivity>
  snapshotCount: number
  neighborhoods: NeighborhoodFeatureCollection | null
  neighborhoodActivity: Map<string, NeighborhoodActivity>
  maxNeighborhoodScore: number
}

function formatNet(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`
}

function lerp(value: number, start: number, end: number): number {
  if (end === start) return value >= end ? 1 : 0
  return Math.max(0, Math.min(1, (value - start) / (end - start)))
}

function ZoomTracker({ onChange }: { onChange: (z: number) => void }) {
  const map = useMapEvents({
    zoom: () => onChange(map.getZoom()),
    zoomend: () => onChange(map.getZoom()),
  })
  return null
}

export function Map({
  stations,
  activity,
  snapshotCount,
  neighborhoods,
  neighborhoodActivity,
  maxNeighborhoodScore,
}: MapProps) {
  const [zoom, setZoom] = useState(INITIAL_ZOOM)

  const t = lerp(zoom, TRANSITION_ZOOM_START, TRANSITION_ZOOM_END)
  const fillOpacityMultiplier = 1 - t
  const heatmapOpacity = t

  const hasActivity = snapshotCount >= 2
  let rankedCount = 0
  for (const a of activity.values()) if (a.rank !== null) rankedCount++

  const legendText =
    t < 0.5
      ? 'Colored areas = neighborhood activity. Zoom in for station-level detail.'
      : 'Hot zones = stations with active bike movement, weighted toward popular destinations.'

  return (
    <>
      <MapContainer
        center={[40.74, -73.99]}
        zoom={INITIAL_ZOOM}
        zoomSnap={0}
        zoomDelta={0.25}
        wheelPxPerZoomLevel={20}
        style={{ height: '100vh', width: '100vw' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomTracker onChange={setZoom} />
        {neighborhoods && (
          <NeighborhoodLayer
            data={neighborhoods}
            activity={neighborhoodActivity}
            maxScore={maxNeighborhoodScore}
            fillOpacityMultiplier={fillOpacityMultiplier}
          />
        )}
        {heatmapOpacity > 0 && (
          <Heatmap stations={stations} activity={activity} opacity={heatmapOpacity} />
        )}
        {stations.map((s) => {
          const a = activity.get(s.station_id)
          return (
            <CircleMarker
              key={s.station_id}
              center={[s.lat, s.lon]}
              radius={5}
              pathOptions={{ color: '#1976d2', weight: 1, fillOpacity: 0.7 }}
            >
              <Popup>
                <div className="station-popup">
                  <strong>{s.name}</strong>
                  <div>
                    {s.num_bikes_available} / {s.capacity} bikes available
                  </div>
                  {hasActivity && a ? (
                    <>
                      <div>
                        ↑ {a.bikesIn} bikes in, ↓ {a.bikesOut} bikes out (last 5 min)
                      </div>
                      <div>
                        Net: {formatNet(a.netInbound)} ·{' '}
                        {a.rank !== null
                          ? `Activity rank: #${a.rank} of ${rankedCount}`
                          : 'Not currently active'}
                      </div>
                      <div className="popup-caveat">
                        Based on 30s polling — actual traffic may be higher during busy periods.
                      </div>
                    </>
                  ) : (
                    <div className="popup-gathering">Gathering activity data…</div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          )
        })}
      </MapContainer>
      <div className="legend">{legendText}</div>
    </>
  )
}
