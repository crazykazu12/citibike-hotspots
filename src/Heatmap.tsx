import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import type { Station } from './types'
import type { StationActivity } from './activity'

const HEAT_EXPONENT = 2

interface HeatmapProps {
  stations: Station[]
  activity: Map<string, StationActivity>
  opacity: number
}

// leaflet.heat 0.2.0 hardcodes its canvas into overlayPane and ignores options.pane,
// so we control opacity by setting it directly on the canvas the layer creates.
type HeatLayerWithCanvas = L.HeatLayer & { _canvas?: HTMLCanvasElement }

export function Heatmap({ stations, activity, opacity }: HeatmapProps) {
  const map = useMap()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const points: [number, number, number][] = stations.flatMap((s) => {
      const a = activity.get(s.station_id)
      if (!a || a.score <= 0) return []
      const weight = Math.pow(a.score, HEAT_EXPONENT)
      return [[s.lat, s.lon, weight]]
    })

    const layer = L.heatLayer(points, { radius: 35, blur: 25, maxZoom: 16 }).addTo(map)
    const canvas = (layer as HeatLayerWithCanvas)._canvas ?? null
    canvasRef.current = canvas
    if (canvas) canvas.style.opacity = String(opacity)

    return () => {
      layer.remove()
      canvasRef.current = null
    }
    // opacity intentionally omitted from deps — we don't want to re-create the
    // layer on every opacity change. The opacity-only effect below handles that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, stations, activity])

  useEffect(() => {
    if (canvasRef.current) canvasRef.current.style.opacity = String(opacity)
  }, [opacity])

  return null
}
