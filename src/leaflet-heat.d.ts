// Module augmentation — the `import type` line makes this file a module, so
// `declare module 'leaflet'` below augments Leaflet's real types instead of
// replacing them.
import type * as L from 'leaflet'

declare module 'leaflet.heat' {
  // Side-effect only: attaches `heatLayer` to the global `L` namespace.
}

declare module 'leaflet' {
  type HeatLatLng = [number, number, number?]

  interface HeatLayerOptions {
    minOpacity?: number
    maxZoom?: number
    max?: number
    radius?: number
    blur?: number
    gradient?: Record<number, string>
    // No `pane` option: leaflet.heat 0.2.0 hardcodes its canvas to overlayPane
    // and ignores any pane passed in options. Opacity is set on the canvas directly.
  }

  interface HeatLayer extends L.Layer {
    setLatLngs(latlngs: HeatLatLng[]): this
    addLatLng(latlng: HeatLatLng): this
    setOptions(options: HeatLayerOptions): this
    redraw(): this
  }

  function heatLayer(latlngs: HeatLatLng[], options?: HeatLayerOptions): HeatLayer
}
