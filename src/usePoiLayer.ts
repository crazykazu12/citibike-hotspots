import { useEffect, useState } from 'react'
import type { FeatureCollection } from 'geojson'

// Lazy-load a static POI GeoJSON file from R2. Returns null until the first
// time `enabled` is true; once fetched, the data stays cached for the lifetime
// of the component — subsequent off→on toggles are instant and re-use the
// already-loaded data. The Map renders the layer at all times once data is
// present; visibility flips via layer-level `visibility: visible|none` so
// MapLibre's internal source + cluster index isn't torn down on every toggle.
export function usePoiLayer(url: string, enabled: boolean): FeatureCollection | null {
  const [data, setData] = useState<FeatureCollection | null>(null)

  useEffect(() => {
    if (!enabled || data) return
    let cancelled = false
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`POI fetch ${url} → ${r.status}`)
        return r.json() as Promise<FeatureCollection>
      })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err: unknown) => {
        // Logged-only for v1 — user-facing error UI is a Phase-3 followup.
        console.error('POI fetch failed', url, err)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, data, url])

  return data
}
