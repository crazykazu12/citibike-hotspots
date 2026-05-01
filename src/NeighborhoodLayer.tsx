import { useCallback, useEffect, useRef } from 'react'
import { GeoJSON } from 'react-leaflet'
import type { Feature } from 'geojson'
import L, { type Layer, type PathOptions } from 'leaflet'
import {
  type NeighborhoodActivity,
  type NeighborhoodFeatureCollection,
  type NeighborhoodProps,
  neighborhoodFillColor,
} from './neighborhoods'

const BASE_FILL_OPACITY = 0.55
const OUTLINE_COLOR = '#888'
const OUTLINE_WEIGHT = 1

interface NeighborhoodLayerProps {
  data: NeighborhoodFeatureCollection
  activity: Map<string, NeighborhoodActivity>
  maxScore: number
  fillOpacityMultiplier: number
}

function styleForFeature(
  feature: Feature | undefined,
  activity: Map<string, NeighborhoodActivity>,
  maxScore: number,
  fillOpacityMultiplier: number,
): PathOptions {
  if (!feature) {
    return { color: OUTLINE_COLOR, weight: OUTLINE_WEIGHT, fillOpacity: 0 }
  }
  const props = feature.properties as NeighborhoodProps
  const a = activity.get(props.nta2020)
  return {
    color: OUTLINE_COLOR,
    weight: OUTLINE_WEIGHT,
    fillColor: neighborhoodFillColor(a?.totalScore ?? 0, maxScore),
    fillOpacity: BASE_FILL_OPACITY * fillOpacityMultiplier,
  }
}

export function NeighborhoodLayer({
  data,
  activity,
  maxScore,
  fillOpacityMultiplier,
}: NeighborhoodLayerProps) {
  const layerRef = useRef<L.GeoJSON | null>(null)

  // Initial style at mount — captures activity/maxScore at that moment
  const initialStyle = useCallback(
    (feature?: Feature): PathOptions =>
      styleForFeature(feature, activity, maxScore, fillOpacityMultiplier),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const onEachFeature = useCallback(
    (feature: Feature, layer: Layer) => {
      const props = feature.properties as NeighborhoodProps
      const a = activity.get(props.nta2020)
      const popupHtml = `
        <div class="neighborhood-popup">
          <strong>${props.ntaname}</strong>
          <div>${props.boroname}</div>
          ${
            a
              ? `<div>${a.activeStationCount} of ${a.stationCount} stations active</div>
                 <div>Total churn: ${a.totalChurn} · Net: ${a.netInbound >= 0 ? '+' : ''}${a.netInbound}</div>`
              : '<div>No activity data yet</div>'
          }
        </div>
      `
      layer.bindPopup(popupHtml)
      layer.on({
        mouseover: (e) => {
          const target = e.target as { setStyle?: (s: PathOptions) => void }
          target.setStyle?.({ weight: 2 })
        },
        mouseout: (e) => {
          const target = e.target as { setStyle?: (s: PathOptions) => void }
          target.setStyle?.({ weight: OUTLINE_WEIGHT })
        },
      })
    },
    [activity],
  )

  // Imperatively re-apply style when fillOpacityMultiplier, activity, or maxScore change.
  // react-leaflet's <GeoJSON> only reads `style` at mount, so we walk children and call setStyle.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.eachLayer((subLayer) => {
      const path = subLayer as L.Path & { feature?: Feature }
      if (!path.feature) return
      path.setStyle(styleForFeature(path.feature, activity, maxScore, fillOpacityMultiplier))
    })
  }, [fillOpacityMultiplier, activity, maxScore])

  return <GeoJSON ref={layerRef} data={data} style={initialStyle} onEachFeature={onEachFeature} />
}
