# Where in the Citi? — Project Journal

A living record of the decisions, tradeoffs, and learnings from building this app.
Started: April 2026.

## What this app does

A web app that visualizes real-time hotspots in the NYC Citi Bike network. Pulls
public GBFS data on a 30-second polling interval, computes station activity from
a rolling in-memory window, and renders a zoom-aware visualization: neighborhood-
level activity at city zoom, station-level heat at neighborhood zoom.

No backend. Pure frontend (React + Vite + TypeScript + Leaflet) deployed as a
static site.

---

## Tech stack and why

| Choice | Reason |
|---|---|
| **React + Vite + TypeScript** | Modern, fast dev loop; TypeScript catches mistakes during a rusty re-onramp to coding |
| **MapLibre GL JS + react-map-gl** | Vector tiles, fluid zoom, GPU-accelerated layers, paint-expression-driven style updates. Replaced Leaflet (see decision #8) |
| **Protomaps PMTiles + @protomaps/basemaps** | Free, no API key, no per-request rate limits. Single static file servable from any HTTP host. "Light" theme is intentionally low-contrast under data overlays |
| **MapLibre native `heatmap` layer type** | Replaces `leaflet.heat`; weight + opacity driven by paint expressions, no JS state in the render path |
| **No backend** | GBFS is public + CORS-enabled; can fetch directly from browser |
| **Vercel (planned)** | Free static hosting, GitHub auto-deploy |

**Considered and rejected:**
- Mapbox / Google Maps — required API keys and billing setup for a free project
- Python backend (FastAPI) — unnecessary for v1; would have added scope
- D3 for custom heatmap — MapLibre's native heatmap is faster and simpler

**Initially used, then replaced:**
- Leaflet + react-leaflet + leaflet.heat — see decision #8 for the migration rationale

---

## Build phases (as actually executed)

1. **Scaffolding** — Vite project, Git, GitHub repo, `CLAUDE.md` for context
2. **Data fetching** — typed fetcher merging `station_information` + `station_status` on `station_id`
3. **Map with markers** — Leaflet centered on NYC, ~2,000 markers with click-to-popup
4. **Heatmap with activity model** — the meat of the app; multiple iterations (see below)
5. **Zoom-aware neighborhood layer** — NTA polygons + station→NTA mapping + zoom-thresholded swap
6. **Migration to MapLibre + Protomaps; simplified to hotspot-only view** — full rewrite of the map layer; removed markers, popups, ranking
7. **Polish** — (in progress)
8. **Deploy** — (pending)

---

## Key decisions, in chronological order

### 1. What "hotspot" means — multiple iterations

This was the most iterated-on concept in the project. The model evolved as I
thought harder about what users actually want to see.

| Version | Model | Why we moved on |
|---|---|---|
| v1 (initial proposal) | Static fullness: `bikes / capacity` | Doesn't capture activity — a station that's been full since 6am in a quiet area would look like a hotspot |
| v2 | Net inbound delta: `max(0, sum of deltas)` | Better — captures destinations — but ignores busy pass-through stations |
| v3 | Net inbound + fullness pressure | Brought back fullness as a "frustrated demand" signal for full stations spilling over to neighbors |
| v4 | "Recent fullness" only | Tightened v3 — only count fullness if the station got full *during* the window |
| v5 (current) | Total churn × destination multiplier | Replaced fullness heuristic with a direct measurement; full stations naturally cool when they stop accepting bikes |

**Final formula:**
```
total_churn = sum of |delta| over rolling window
net_inbound = sum of delta over rolling window

destination_multiplier = 1.0 if net_inbound > 0
                        0.3 if net_inbound == 0
                        0.1 if net_inbound < 0

activity_score = total_churn * destination_multiplier
```

### 2. Polling interval and window size

- **Polling: 30s** (matches GBFS feed TTL; balances freshness against request volume)
- **Window: 10 snapshots = 5 minutes** (long enough to smooth noise, short enough to feel real-time)

Both stored as constants for easy tuning.

### 3. Ranking refinements

Initial implementation ranked all 2000 stations by score. Most had score 0
(idle) and got arbitrary ranks based on Map insertion order — meaningless.

**Fix:**
- Exclude stations with `score === 0` from the ranking
- Display rank as "#N of M active" so the denominator is informative
- Tie-break by `bikesIn` descending

### 4. Visualization: from per-station heat to zoom-aware hybrid

**Problem:** Per-station heatmap with power-scaled weights still looked like
identical bullseyes everywhere — users couldn't tell which hotspot was hottest.

**Solution:** Zoom-dependent visualization.
- **Zoom ≤ 14** (city/borough overview): NYC neighborhoods (NTAs) colored by aggregate activity
- **Zoom ≥ 15** (neighborhood-level): station-level heatmap visible
- **Crossfade** between 14 and 15 (fractional zoom enabled, opacity-interpolated)

Markers visible at all zoom levels for click-to-detail.

> Implemented 2026-04-26 — see Build Log. Initial Phase 5 used a hard swap at zoom 13/15; superseded same day by the fractional crossfade described above.

### 5. Power scaling for heatmap contrast

Plain `activity_score` made too many stations glow at similar intensity.
Applying `weight = activity_score ^ HEAT_EXPONENT` (with `HEAT_EXPONENT = 2`)
dramatically increases contrast between top and middle stations without
excluding any from the visualization.

Considered alternatives:
- Top-N filtering (binary cutoff felt arbitrary)
- Rank-based weights (loses magnitude info)
- Quantile binning (interesting; could revisit)

### 6. Stale popup data bug

Found by noticing impossible-looking numbers: "0 bikes available" + "+3 net
inbound." The bug: `num_bikes_available` came from initial fetch state and
wasn't being refreshed; activity numbers from rolling window were fresh.
Symptoms looked like a math bug; was actually a state-synchronization bug.

**Fix:** merge fresh status into stations state on every poll.

**Lesson:** when numbers don't make sense, suspect data flow before suspecting math.

### 7. Deferred: persistent activity history (backend)

Considered building a backend so users get instant data on first load (instead
of waiting ~2 minutes for the rolling window to fill).

**Decided to defer** because:
- The visualization is still evolving — locking in a backend now creates migration debt
- Frontend version is annoying but not broken
- Real user feedback should drive whether/how to build it
- Adding a backend is a major scope expansion (hosting, DB, monitoring, cost)

**Captured for later:** if first-load UX becomes the top complaint after deploy,
a lightweight pattern (GitHub Actions + Cloudflare R2 + a JSON file) avoids
needing a real server. Documented in IDEAS.md.

### 8. Migration to MapLibre + Protomaps; simplification to hotspot-only

**Why migrated off Leaflet:**
- Two phases of fighting `leaflet.heat`: opacity wasn't controllable through any documented API, and the eventual fix reached into the layer's private `_canvas` field. When you're touching `_<thing>` to make a library work, the library has stopped fitting your use case.
- Vector tiles (Protomaps) give fluid zoom natively. Leaflet's raster zoom always felt steppy even with `zoomSnap=0` and a custom `wheelPxPerZoomLevel`.
- MapLibre's native `heatmap` layer renders on the GPU with paint-expression-driven `heatmap-weight` and `heatmap-opacity`. The crossfade between neighborhood polygons and station heat is now declarative — `['interpolate', ['linear'], ['zoom'], 14, 0.55, 15, 0]` re-evaluates per frame without React in the loop.
- `react-map-gl/maplibre` mirrors react-leaflet's component shape (`<Map>`, `<Source>`, `<Layer>`) so the surface area to learn was small.

**Why simplified the product to hotspot-only:**
- Per-station markers + click-popups were the most code-heavy and least frequently-used feature. Visualization is the value; per-station detail is a niche follow-up.
- Bounds-relative heatmap normalization (visible-max instead of city-wide-max) reveals local hotspots in quiet neighborhoods that absolute scaling rendered as flat zero. Pan to Inwood and the locally-active station now glows red, even if its absolute score is dwarfed by Midtown.
- Dropping markers also dropped the `rank`, `category`, `bikesIn`, `bikesOut`, and `category` fields from `StationActivity` — same pass cleaned up `activity.ts` and `NeighborhoodActivity` to just the score-related fields the renderer actually consumes.

**Tradeoffs accepted:**
- Bundle is now larger (1.3 MB vs ~360 KB pre-migration) — MapLibre + the Protomaps theme spec dominates. Code-splitting deferred until it actually matters.
- Protomaps demo PMTiles bucket is a development crutch — not contractually stable, URL has changed across major versions before. Pre-public release: self-host a NYC extract via `pmtiles extract` on R2/S3/GitHub Pages.

---

## Build Log

### 2026-04-26 — Zoom-aware neighborhood layer
- **Changed:** Added `src/neighborhoods.ts` (loader, point-in-polygon assignment, activity aggregation, cool→warm color scale), `src/NeighborhoodLayer.tsx` (GeoJSON polygon layer), zoom tracking + conditional rendering in `src/Map.tsx`, derived neighborhood activity in `src/App.tsx`. New static asset at `public/data/nyc-neighborhoods.geojson` (4.4 MB, NTA 2020). Installed `@turf/boolean-point-in-polygon`.
- **Why:** Implements decision #4 — at low zoom, per-station heat looked like identical bullseyes; neighborhood-level aggregation gives a meaningful overview, station heat returns at high zoom.
- **Notable:** macOS case-insensitive FS treats `Neighborhoods.tsx` and `neighborhoods.ts` as the same file — renamed component to `NeighborhoodLayer.tsx`. Zoom 14 is currently a transitional zone (outlined polygons, no heatmap) because both `NEIGHBORHOOD_ZOOM_MAX = 13` and `STATION_ZOOM_MIN = 15` constants are honored; pull `STATION_ZOOM_MIN` to 14 to remove the gap.

### 2026-04-26 — Fractional zoom + crossfade between layers
- **Changed:** `src/Map.tsx` now uses `zoomSnap={0}` and `zoomDelta={0.25}` for continuous zoom, listens to both `zoom` and `zoomend`, and computes `fillOpacityMultiplier` and `heatmapOpacity` via a `lerp(zoom, 14, 15)`. Bumped `NEIGHBORHOOD_ZOOM_MAX` from 13 → 14 so neighborhood view persists for several zoom levels. Refactored `src/NeighborhoodLayer.tsx` to take `fillOpacityMultiplier` instead of a `mode` enum and apply style imperatively via `eachLayer().setStyle()` so opacity changes don't remount the layer. `src/Heatmap.tsx` accepts a `paneName`; heatmap renders into a custom `<Pane>` whose CSS opacity is updated imperatively via a small `PaneOpacity` helper (react-leaflet v5's `<Pane>` doesn't reactively update its style prop). Added `pane?: string` to the heatmap type shim.
- **Why:** Phase 5's hard swap at integer zoom thresholds left zoom 14 in a dead zone and felt jarring. Continuous zoom + opacity crossfade replaces both problems.
- **Notable:** Outlines stay at constant opacity throughout the transition — only fill is faded — matching the request to keep neighborhood context visible at high zoom. Polygon hover/click is intentionally left enabled at all zoom levels; markers are in `markerPane` (higher z-index than `overlayPane`) so marker clicks aren't intercepted. `NEIGHBORHOOD_ZOOM_MAX` and `TRANSITION_ZOOM_START` are intentionally redundant aliases (TRANSITION_* derives from the named threshold) so both names from the spec stay present in the code.

### 2026-04-26 — Tune scroll-wheel zoom speed
- **Changed:** Added `wheelPxPerZoomLevel={40}` to `MapContainer` in `src/Map.tsx`.
- **Why:** Scroll-wheel zoom felt slow with `zoomDelta=0.25`; this decouples scroll speed from button delta, keeping fine-grained button control while making scroll more responsive.
- **Notable:** Default is 60 — lower = faster scroll. May need further tuning (try 30 if still slow, 50 if it overshoots).

### 2026-04-26 — Lower wheelPxPerZoomLevel to 30
- **Changed:** `wheelPxPerZoomLevel` 40 → 30 in `src/Map.tsx`.
- **Why:** 40 still felt slow; 30 doubles the default scroll speed.

### 2026-04-26 — Lower wheelPxPerZoomLevel to 20
- **Changed:** `wheelPxPerZoomLevel` 30 → 20 in `src/Map.tsx`.
- **Why:** 30 still wasn't fast enough; 20 is 3× the default scroll speed.

### 2026-04-26 — Fix heatmap opacity wiring (canvas-direct)
- **Changed:** Removed the `<Pane name="heat-pane">` + `PaneOpacity` indirection from `src/Map.tsx`. `src/Heatmap.tsx` now takes an `opacity` prop and applies it directly to the canvas element returned by `L.heatLayer` via `(layer as any)._canvas.style.opacity`. Two effects: one creates/destroys the layer when `stations`/`activity` change, the other only updates `canvas.style.opacity` on opacity changes (no re-creation per zoom tick). Removed the now-misleading `pane?` field from `src/leaflet-heat.d.ts` and the `paneName` plumbing from `Heatmap`.
- **Why:** Crossfade between neighborhood and station layers wasn't working — heatmap was rendering at full opacity regardless of zoom. Root cause: leaflet.heat canvas wasn't being placed in our custom pane, so pane-level opacity changes had no effect.
- **Notable:** leaflet.heat 0.2.0 ignores the `pane` option — its `onAdd` hardcodes `map._panes.overlayPane.appendChild(this._canvas)` (verified by reading `node_modules/leaflet.heat/src/HeatLayer.js:54`). Lesson for future Leaflet plugin work: don't assume options documented in the API actually work — verify by inspecting the resulting DOM (or, faster, the plugin source). Reaching into `_canvas` is technically a private field, but stable since 2014.

### 2026-04-26 — Migration to MapLibre + Protomaps; simplified to hotspot-only view
- **Changed:** Replaced Leaflet stack with MapLibre GL JS + Protomaps vector tiles. Removed station markers, popups, and ranking. Heatmap now normalized within visible map bounds (locally relative) at neighborhood zoom; neighborhoods stay absolute at city zoom. Files: `src/Map.tsx` rewritten using `react-map-gl/maplibre` + `pmtiles` + `@protomaps/basemaps` (LIGHT flavor). Deleted `src/Heatmap.tsx`, `src/NeighborhoodLayer.tsx`, `src/leaflet-heat.d.ts`. Stripped `src/activity.ts` to expose only `score` on `StationActivity` (was `bikesIn`/`bikesOut`/`totalChurn`/`netInbound`/`category`/`rank`); stripped `src/neighborhoods.ts` `NeighborhoodActivity` to `totalScore` only and removed the now-unused `neighborhoodFillColor` helper. `src/App.tsx` slimmed; `src/index.css` lost popup rules; `CLAUDE.md` "Stack" and "Architecture" rewritten. Uninstalled `leaflet`, `react-leaflet`, `leaflet.heat`, `@types/leaflet`. Verified zero residual references via `grep -rni 'leaflet'` across `src/`, `public/`, `package.json` (all empty) and `grep -rnE 'L\.[A-Z]'` across `src/` (also empty).
- **Why:** Smoother fluid zoom (vector tiles vs raster), simpler product focus on hotspot visualization, more meaningful local heat scaling so quiet neighborhoods aren't always invisible.
- **Notable:** MapLibre native expressions (`['interpolate', ['linear'], ['zoom'], 14, …, 15, …]`) handle the layer crossfade GPU-side — no React state in the render path. The previous `_canvas` opacity hack was the signal it was time to migrate. Bundle nearly quadrupled (358 KB → 1.3 MB; 111 KB → 357 KB gzip) — MapLibre + the Protomaps theme spec dominates; code-splitting deferred. Protomaps demo PMTiles URL is a development crutch; pre-public-release migration to a self-hosted NYC extract is required. `protomaps-themes-base` is deprecated in favor of `@protomaps/basemaps` (newer API: `layers('source', LIGHT)` instead of `layers('source', 'light')`); installed the maintained one. Bounds-relative normalization fires on `moveend` (not per animation frame) — heat redistributes after the user stops panning, which feels fine in practice.

### 2026-05-02 — Neighborhood interactivity + continuous heat zones
- **Changed:** Added hover tooltip with neighborhood name. Click on a neighborhood now flies the camera to fit it. Heatmap parameters tuned (larger radius, intensity ramp, transparent cold-stop in color gradient) so adjacent active stations blend into continuous hot zones rather than discrete blobs.
- **Why:** Hover gives users a way to identify neighborhoods (replaces the popups we removed). Click-to-zoom turns the city view into a navigation interface. Continuous heat better matches how bike traffic actually moves through space — it spreads and blends, not concentrates at discrete points.
- **Notable:** Cold areas are deliberately transparent (not colored blue) so the basemap shows through quiet regions. `heatmap-radius` tuning is taste-driven — initial values are starting points. Tooltip is hidden at zoom ≥ 15 (heatmap dominant) so it doesn't compete with the station-level view. `interactiveLayerIds` on `<MaplibreMap>` plus a `mapRef.current.getMap().fitBounds(...)` call powers click-to-fit; bbox is computed in JS from feature geometry without pulling in `@turf/bbox`.

### 2026-05-02 — Bump heatmap-radius +30
- **Changed:** `heatmap-radius` zoom-interpolated values 35→65 (zoom 14) and 80→110 (zoom 17) in `src/Map.tsx`.
- **Why:** Adjacent stations weren't blending enough at the smaller radius; +30 widens each station's contribution so neighbors fuse into one continuous warm zone.

### 2026-05-02 — Bump heatmap-radius +50
- **Changed:** `heatmap-radius` 65→115 (zoom 14) and 110→160 (zoom 17) in `src/Map.tsx`.
- **Why:** Still too discrete at +30; pushing further to fully blend clusters.

### 2026-05-02 — Fixture mode for visualization iteration
- **Changed:** Added a development-only fixture mode that loads pre-saved GBFS snapshots instead of polling the live feed. Heatmap renders instantly at full fidelity, enabling rapid iteration on visual parameters without waiting for the rolling window to refill. Implemented across `src/dev-globals.d.ts` (Window augmentation), `src/useStationActivity.ts` (debug globals + fixture short-circuit), `src/gbfs.ts` (`USE_FIXTURES` flag + fixture branch in `fetchStations`), `src/App.tsx` (FIXTURE MODE badge), `src/index.css`, `.env.local.example`, `.gitignore` (explicit `.env.local` entries), and `CLAUDE.md` (Development: Fixture Mode section). Placeholder `src/fixtures/{snapshots,stations}.json` shipped as `[]` until real data is captured.
- **Why:** Tuning heatmap radius, color stops, and zoom thresholds against live data was painful — every change required ~5 min of waiting per reload.
- **Notable:** Controlled by `VITE_USE_FIXTURES` env var, never active in production. Visible badge in UI prevents misinterpreting frozen data as live. Implemented in two phases — debug globals first to enable data capture, then loader code that consumes the captured files. The capture path uses `window.__downloadFixtures()` which Blob-encodes the live state and triggers two file downloads — pasting large fixture JSON into chat got truncated by message length limits, so the in-browser download flow is the only practical capture path. Bundle hygiene: original gating used a re-exported `USE_FIXTURES` const, but Rollup didn't constant-fold across the module boundary, so it emitted a 30-byte orphan `snapshots-*.js` chunk. Inlining `import.meta.env.VITE_USE_FIXTURES === 'true'` directly at the call site lets Vite statically prove the branch dead and eliminate both the branch and its dynamic JSON import. Verified: production `dist/` contains only `index-*.css` and `index-*.js`, and `grep -oE "FIXTURE MODE|__dumpFixtures|fixtures/snapshots"` finds zero hits in the JS bundle.

### 2026-05-02 — Connection corridors as densified heat (replaces line layer)
- **Changed:** Replaced the short-lived `connections-line` MapLibre layer with synthetic heat points sampled along each qualifying station pair, fed into the existing heatmap source. New constants in `src/connections.ts`: `CONNECTION_SAMPLE_SPACING_M = 30` (one synthetic point per ~30m), `CONNECTION_HEAT_MULTIPLIER = 0.4` (corridor weight = `0.4 × mean(endpoint scores)`). Removed `CONNECTION_MAX_WIDTH_PX`. Renamed `computeConnections()` → `computeConnectionPoints()`; returns `HeatPoint[]` (raw `{lon, lat, weight}`) instead of LineString FeatureCollection. `buildStationsGeoJson` → `buildHeatGeoJson`; merges stations + synthetic points into one Point FeatureCollection and computes the bounds-relative max across both sets.
- **Why:** The previous red line layer rendered as a geometric overlay — sharp, angular, unmistakably a CAD-style network diagram — not as heat. Feeding synthetic points into the same heatmap layer makes the corridors render through the same Gaussian kernel as the stations, so they read as continuous tubular heat that flows between adjacent active stations. Same physical mechanism, same visual language.
- **Notable:** Pair-detection (grid bucketing, 9-neighborhood scan, distance + activity threshold) is unchanged from the line-based version. Each pair contributes `round(dist / 30)` interior samples at chunk centers (`t = 0.5/N … (N-0.5)/N`) — endpoints are excluded because the stations themselves are already heatmap features. The `CONNECTION_HEAT_MULTIPLIER = 0.4` keeps corridors visibly weaker than stations so a hot station still reads as a peak rather than vanishing into its own corridors. Bounds-relative normalization now considers both station scores and synthetic point weights inside the visible bbox; in practice the max is always a station (since the multiplier is sub-1), but the merge is correct in case future tuning pushes the multiplier above 1. Dev console log moved to Map.tsx's `connectionPoints` useMemo and now reports `heat points: N stations + M synthetic = T total`. No structural change to the heatmap layer — same paint expressions, same color stops, same radius (40→70 over zoom 14→17).

### 2026-05-02 — Cluster fills replace pairwise corridors for clusters of 3+
- **Changed:** Connection visualization now treats clusters of 3+ active nearby stations as filled hulls instead of N pairwise corridors. Connected-components walk over the eligible-station proximity graph (BFS on the existing grid bucket) yields disjoint clusters; size-2 clusters keep corridor sampling, size-3+ get convex-hull-interior fill (40m grid spacing, capped at 200 points per cluster). New dep: `@turf/convex` (~18KB gzipped — concaveman under the hood). New consts in `src/connections.ts`: `CLUSTER_FILL_SPACING_M = 40`, `CLUSTER_FILL_HEAT_MULTIPLIER = 0.35`, `MAX_CLUSTER_FILL_POINTS = 200`. Return shape changed to `{ corridorPoints, clusterFillPoints, stats: { pairCount, groupCount } }`; Map.tsx concatenates both arrays for the heatmap input and the dev log now reports `heat points: X stations + Y corridor + Z cluster fill (from N clusters: A pairs, B groups)`.
- **Why:** Three mutually-close active stations under the corridor-only model rendered as a triangle of beams with cool space inside the triangle — visually wrong. The user's mental model is "this *area* is hot," not "these *paths between stations* are hot." Hull-fill matches the mental model: the whole region encompassing the cluster reads as one hot zone, with stations still rendering as peaks within it.
- **Notable:** Disjoint partitioning (a station belongs to exactly one cluster) means no double-counting — pairs internal to a 3+ cluster get *no* corridor; only the hull fill replaces them. Bbox-area-based performance cap widens spacing (`spacing × sqrt(naive/MAX)`) on huge hulls so a 10-station mega-cluster degrades gracefully. Fallback path: if `convex()` returns null (collinear or degenerate input — `concaveman` returns ≤ 3 hull points → null per the package's own check), the cluster falls back to pairwise corridor sampling between every connected pair, with a `console.warn` in dev. Convex hull over-fills concave clusters (a thin V-shape gets a triangle including empty space) — accepted for v1, can switch to `@turf/concave` if it becomes a real visual problem. Cluster boundary popping when a station crosses `MIN_CONNECTION_ACTIVITY` is unsmoothed — feels honest to the data. Visual model shifted from "paths between hot points" to "hot regions encompassing clusters."

### 2026-05-02 — Cluster fill polish: solid fills, radial gradient, earlier crossfade
- **Changed:** Three coordinated fixes to the cluster-fill rendering in `src/connections.ts` and `src/Map.tsx`. (1) Tightened fill spacing 60m → **20m** so adjacent heatmap kernels overlap into a continuous fill instead of polka-dots; raised cap `MAX_CLUSTER_FILL_POINTS` 200 → **400** so most clusters render at native spacing before the auto-widen kicks in. (2) Added centroid-radial weighting: each fill point's weight scales by `RADIAL_FLOOR + (1 - RADIAL_FLOOR) × (1 - distNorm)` where `distNorm = dist_from_centroid / max_centroid_to_hull_vertex`. Centroid is the mean of station lat/lons (where the activity actually is), radius is the max distance from centroid to any hull vertex. New const `CLUSTER_FILL_RADIAL_FLOOR = 0.3` and bumped `CLUSTER_FILL_HEAT_MULTIPLIER` 0.35 → **0.5** so centers read as visibly hot peaks. Centers get full base weight; hull edges get 30% of it. (3) Shifted crossfade range 14→15 → **13→14.5** by changing `NEIGHBORHOOD_ZOOM_MAX` from 14 to 13 and `STATION_ZOOM_MIN` from 15 to 14.5. Both opacity expressions and the legend midpoint now use the new range.
- **Why:** (1) The 60m grid + heatmap blur left visible gaps between fill points — the eye perceived a polka-dot pattern, not a solid hot region. (2) Uniform-weight fills made the entire hull look like one flat blob — there was no visual "where exactly is the activity centered?" Radial weighting gives clusters a peak-and-falloff shape that matches how a real heat distribution would look. (3) With the old 14→15 crossfade, cluster fills only appeared after neighborhoods had already disappeared — there was a half-zoom gap where neither layer carried the visualization. The new 13→14.5 range keeps the map continuously informative through the transition.
- **Notable:** Centroid is computed from stations, not hull vertices (stations describe where the data lives; hull vertices describe boundary geometry). The radius is the max centroid-to-hull-vertex distance, which by convexity bounds the max centroid-to-any-interior-point distance — so `distNorm` should be ≤ 1 in theory, but it's defensively clamped to `[0, 1]` against floating-point drift. Guard for `radiusM === 0` falls back to flat weighting. The const shift to 13/14.5 means the heatmap radius and intensity ramps now anchor at zoom 13 (40px / 0.6) instead of 14, ramping to zoom 17 (70px / 1.5) — at zoom 14 radius is now ~47.5px (was 40) and intensity ~0.825 (was 0.6); intentionally softer ramp through the crossfade rather than abrupt appearance.

### 2026-05-02 — Pure-traffic activity score (drop destination weighting)
- **Changed:** Activity score in `src/activity.ts` is now pure total churn (`sum of |delta|` across the rolling window) — destination weighting removed. Previously `score = totalChurn × destination_multiplier` with `multiplier ∈ {1.0, 0.3, 0.1}` based on `sign(netInbound)`. Now `score = totalChurn` flat. Removed the per-station `netInbound` accumulator and the `mult` selection in the loop. Kept `DEST_MULT_POSITIVE`, `DEST_MULT_ZERO`, `DEST_MULT_NEGATIVE` exported but unused (annotated `// Kept for easy revert to destination-weighted scoring`) — restoring the old behavior is a one-block change inside `computeActivity`.
- **Why:** Destination-weighted scoring dimmed net-source stations (commuter origins, stations near subway hubs at AM rush) by 10× relative to net-destinations. We want to see whether pure-traffic visualization surfaces hotspots that the destination-weighted model was hiding — particularly around morning commuter origins. If the result loses meaningful directional contrast or makes the map noisier without surfacing useful patterns, revert is one block of code.
- **Notable:** Doc comment in `activity.ts` updated to reflect the new model. Legend text in `src/Map.tsx` was already direction-neutral ("busiest areas" / "stations active") — no copy change needed. The user prompt mentioned "bikes_in / bikes_out fields stay computed" but those fields don't currently exist in `StationActivity` (only `score`); the original code computes `totalChurn` and `netInbound` as locals inside the loop and discards both, retaining only the score. Keeping the existing structure to avoid scope creep — if a future dev log needs the in/out breakdown, adding it back is a small change.

### 2026-05-02 — Revert to destination-weighted scoring
- **Changed:** Restored `score = totalChurn × destination_multiplier` in `src/activity.ts` with the original multipliers (1.0 net-inbound, 0.3 balanced, 0.1 net-outbound). `MIN_CONNECTION_ACTIVITY` was left at 1 throughout (it was calibrated against this score and never moved), so no further changes needed in `connections.ts`.
- **Why:** The pure-traffic experiment lit up subway-exit stations where commuters *grab* bikes — high churn, but not meaningful "hotspots" in the sense users care about. Destination weighting correctly downweights net-outflow stations (origins) and elevates net-inflow stations (destinations), answering "where are people going?" rather than "where are bikes moving?"
- **Notable:** This validates the original model's design intuition — the destination multiplier isn't just a tuning knob, it's a product decision about what "hotspot" means. Pure traffic scoring is a different visualization (and might be useful for a separate "supply/demand mismatch" view), but it's not the right default. Keeping the doc comment in `activity.ts` updated to call out the directional semantics so the rationale is on-hand at the source. The DEST_MULT constants are now load-bearing again — no longer marked as kept-for-revert.

### 2026-05-02 — Map polish: water color, score-gated neighborhood opacity, click-to-zoom gating
- **Changed:** Three coordinated map polish items in `src/Map.tsx`. (1) Overrode the Protomaps LIGHT theme's water color from `#80deea` (saturated cyan) to `#cad2d3` (muted pale blue-gray) by spreading the imported `LIGHT` flavor into a local `lightFlavor` and replacing the `water` key before passing it to `protomapsLayers()`. (2) Made neighborhood `fill-opacity` data-driven: paint expression now multiplies a zoom-fade factor (1.0 at zoom 13 → 0 at zoom 14.5) by a score-driven base factor (0.05 floor up to `NEIGHBORHOOD_VISIBILITY_THRESHOLD = 0.2`, ramping linearly to 0.55 at score 1.0). New tunable const `NEIGHBORHOOD_VISIBILITY_THRESHOLD`. (3) Added a zoom gate to `onClick`: early-return when `zoom >= STATION_ZOOM_MIN` so clicks on faded-out neighborhoods at high zoom do nothing.
- **Why:** (1) Bright cyan rivers fought the heatmap palette and made the basemap feel like a tourist map rather than a calm canvas. The package author's intentional default isn't always the right one for a data-overlay use case. (2) Uniform-opacity fills washed out the genuinely-hot neighborhoods because cool ones were also colored — the eye couldn't pick out signal from noise. Threshold-gated opacity makes hot zones pop against a near-empty basemap. (3) At high zoom the neighborhood layer is invisible but still interactive, so a stray click could fitBounds the user back out — gating fixes that.
- **Notable:** The water color override is robust against future package updates — we spread `LIGHT` so any new keys flow through automatically; only `water` is replaced. Threshold uses the existing `normalizedScore` feature property (computed in `buildNeighborhoodsGeoJson` against citywide max), so no data plumbing changes — just a paint expression tweak. The opacity expression factors as `zoom_factor × data_factor` rather than nesting case-on-zoom-with-different-stops, which keeps the math obvious and lets MapLibre evaluate both factors GPU-side per frame. Click handler retains the hand-rolled `geometryBbox()` (15 lines, no new dep) — a turf-bbox swap was considered and declined as needless churn. Hover tooltip is unchanged; cursor pointer was already wired via `cursor={hover ? 'pointer' : ''}`.

### 2026-05-02 — Bugfix: invalid `*`-composed paint expression dropped neighborhood-fill layer
- **Bug:** The score-gated opacity expression composed a zoom-fade interpolate and a score-fade interpolate via the `*` math operator (`['*', ['interpolate', ['zoom'], …], ['interpolate', ['get', …], …]]`). MapLibre's style spec disallows `['zoom']` as an argument to math operators — the spec requires `['zoom']` to live at the top level of an `interpolate` or `step` expression (or inside such a top-level expression nested in `let`). MapLibre rejected the entire `neighborhoods-fill` layer at style-load. Three symptoms cleanly cascaded from one cause: no fills visible (layer never registered), no hover tooltips (`interactiveLayerIds: ['neighborhoods-fill']` referenced a layer that didn't exist, so `e.features` was always empty in `onMouseMove`), no click-to-zoom (same — `e.features` empty in `onClick` triggered the early-return).
- **Fix:** Replaced the `*`-composition with a nested-interpolate pattern. Outer `interpolate` over `['zoom']` with two stops: at `NEIGHBORHOOD_ZOOM_MAX` (13) the output value is *itself an inner interpolate over `['get', 'normalizedScore']`* (0.02 floor up to threshold, ramp to 0.55 at score 1.0); at `STATION_ZOOM_MIN` (14.5) the output is `0`. Structurally identical math to the multiplicative form (at zoom 13 the value equals the inner interpolate result; at zoom 14.5 it's 0; in between MapLibre linearly interpolates between the two). Spec-compliant.
- **Notable:** MapLibre's expression spec is stricter than shader math — `['zoom']` cannot appear inside math operators (`+`, `*`, `min`, `max`, etc.). The canonical way to combine zoom-driven and feature-driven values is **nesting**, with `['zoom']` at the outer `interpolate`/`step` and the feature-driven expression as one of the output values. Lesson: when you find yourself reaching for `['*', ['zoom-thing'], ['data-thing']]`, refactor to `['interpolate', ['zoom'], stop1, ['data-thing-as-output'], stop2, …]` instead. Caught the bug only after shipping because the previous tuning iteration changed paint expression values without rerunning the visual smoke test — would've been caught immediately by checking the browser console after the change.

### 2026-05-02 — Revert neighborhood color/opacity tuning to working baseline
- **Changed:** Reverted `fill-color` and `fill-opacity` on the `neighborhoods-fill` layer to the pre-tuning version captured in commit `24940c3`. `fill-color` is back to a 2-stop `interpolate` from `#3b82f6` (blue-500) at score 0 to `#ef4444` (red-500) at score 1; `fill-opacity` is back to a simple zoom-only `interpolate` (0.55 at zoom 13 → 0 at zoom 14.5). Removed the `NEIGHBORHOOD_VISIBILITY_THRESHOLD` constant (no longer referenced anywhere).
- **Why:** The tuning round (visibility threshold → single-hue red → orange-mid stops → various permutations) didn't land where we wanted. Each variant fixed one complaint and introduced two more. The original blue→red gradient with uniform-by-zoom opacity is the right baseline for now — even if it has a muddy purple/pink midpoint, it's at least visually informative across all activity tiers without losing low-activity neighborhoods entirely. Better to ship a working baseline and revisit color theory deliberately later than to keep iterating on a hot path.
- **Notable:** Kept the in-progress wins from the same session: cyan→muted water override on the LIGHT theme (`lightFlavor = { ...LIGHT, water: '#cad2d3' }`) and the click-to-zoom early-return at high zoom (`onClick` returns when `zoom >= STATION_ZOOM_MIN` so faded-out neighborhoods don't intercept clicks). Hover tooltip behavior was untouched throughout. The earlier `*`-composed paint expression bug stays in the journal as a lesson — it surfaced *because* the threshold tuning required composing two interpolates, which is exactly the pattern this revert removes; reverting also eliminates the temptation to retry that pattern without remembering to nest.

### 2026-05-03 — App rename + top header bar with fixture/last-updated indicator
- **Changed:** Added a 56px-tall translucent header bar at the top of the viewport (new `src/Header.tsx`, wired in via `src/App.tsx`). Header contains the app title ("Where in the Citi?"), subtitle ("Real-time Citi Bike activity across NYC"), and a right-side status indicator. In live mode the indicator reads "Updated Xs/m/h ago" (or "just now") and re-renders every 5s via a `setInterval` tick that bumps a dummy state. In fixture mode it reads "Fixture mode — frozen data" with an amber pill style and the interval is skipped (data never changes). Replaced the previous corner `.fixture-badge` with this header-integrated indicator. Map's container `style` switched from `100vh` to `calc(100vh - 56px)` with `marginTop: 56` so it docks below the fixed header. Legend `top` shifted from 12px to 68px so it doesn't overlap the header. Renamed the app from "Citi Bike Hotspots" → "Where in the Citi?" in `index.html` `<title>`, `CLAUDE.md` heading + project blurb, and `PROJECT_JOURNAL.md` heading. Surfaced `lastSnapshotAt: number | null` from `useStationActivity` (set in `pushSnapshot` via `setLastSnapshotAt(Date.now())`) so the header can compute the relative-time string from a single source of truth.
- **Why:** A new visitor landing on a full-screen map had no signal for what they were looking at, whether the data was live, or how recent it was. The header solves all three: name + tagline gives instant context; live-mode timestamp confirms data freshness; fixture-mode pill makes "this is frozen" impossible to miss without parking a bright-orange badge in a corner. Renaming was overdue — "Citi Bike Hotspots" was a placeholder that described the feature, not the product.
- **Notable:** Header is `position: fixed` with `backdrop-filter: blur(8px)` (with `-webkit-backdrop-filter` for Safari) so a hint of the map shows through — feels modern without obscuring data. Reserved space on the right via the `.app-header-right` flex container so the planned theme-picker and other controls drop in without redesign. Mobile breakpoints at 560px (subtitle hides) and 380px (title shrinks, indicator shrinks) keep the header from breaking down to ~375px width. The fixture indicator is a constant-folded conditional on `USE_FIXTURES` (re-exported from `src/gbfs.ts` which itself inlines `import.meta.env.VITE_USE_FIXTURES === 'true'`), so the live-mode "Fixture mode — frozen data" string and the 5s interval setup are tree-shaken out of fixture-disabled builds — verified via `grep "Fixture mode" dist/assets/*.js` after both build modes. The 5s tick uses `forceTick((n) => n + 1)` rather than re-reading `Date.now()` into state because we want the displayed time to recompute on every render against the prop `lastSnapshotAt` — saves any stale-state race when a new snapshot arrives between ticks. Old corner `.fixture-badge` CSS rule deleted; npm package name (`citi-bikes`) intentionally unchanged per the rename note in `CLAUDE.md`.

### 2026-05-04 — All zones / Hot only view-mode toggle
- **Changed:** Added a segmented-control toggle in the header that switches the neighborhood layer between two view modes — `'all'` (existing full-gradient behavior) and `'hot'` (hide everything below `HOT_ONLY_THRESHOLD = 0.5` of citywide max activity). State lives in `src/App.tsx` (`useState<ViewMode>('all')`) and is passed to both `<Header>` (for the toggle UI + state setter) and `<Map>` (for the paint expression switch). New module-scope constants in `src/Map.tsx`: `ALL_ZONES_OPACITY` and `HOT_ONLY_OPACITY`, both typed as `DataDrivenPropertyValueSpecification<number>`. `<Layer>` receives `viewMode === 'hot' ? HOT_ONLY_OPACITY : ALL_ZONES_OPACITY` for `fill-opacity`; react-map-gl applies via `setPaintProperty` on prop change. Hover and click handlers gated on `feature.properties.normalizedScore < HOT_ONLY_THRESHOLD` when `viewMode === 'hot'` so transparent neighborhoods don't intercept events. Legend text is now view-mode-aware at low zoom. New segmented-control CSS: pill container with light gray background, active state has white pill with subtle shadow and bumped weight. Mobile breakpoint at 380px shrinks button padding/font.
- **Why:** Citywide gradient is great for showing relative ranking across all of NYC, but at low zoom even quiet neighborhoods are colored — you can't quickly point at "the busiest places right now" without comparing fill darkness across dozens of polygons. Hot Only mode solves the "where's the action?" question in one glance by clearing everything that isn't actually hot. Two distinct affordances for two distinct questions.
- **Notable:** The `HOT_ONLY_OPACITY` expression is the canonical nested-interpolate pattern (lessons from the earlier `*`-composition bug applied): outer `interpolate ['zoom']` with stops at `NEIGHBORHOOD_ZOOM_MAX` and `STATION_ZOOM_MIN`; the value at the low-zoom stop is a `case` expression that returns either `0` (below threshold) or a feature-driven `interpolate` ramping from `0.4` at the threshold to `0.85` at score `1.0`. `case` is allowed inside an outer zoom-`interpolate`'s output value because `['zoom']` itself stays at the top level. Heatmap and cluster fills are unaffected — they only render at zoom ≥14.5 where the neighborhood layer is fully faded out, so Hot Only is purely a low-zoom visualization filter. Default view mode resets to `'all'` on every page reload (no localStorage persistence, per the spec). Both expressions are module-scope constants rather than per-render `useMemo` because they're true constants — no React state dependencies.

### 2026-05-04 — Light/Dark theme picker
- **Changed:** Added a `Light` / `Dark` segmented control in the header, placed left of the view-mode toggle (final left-to-right order: title — `[Light/Dark]` — `[All zones/Hot only]` — indicator). New module `src/themes.ts` defines a `Theme` interface with three sub-objects: `protomapsFlavor` (basemap colors), `overlays` (neighborhood color scale, heatmap color stops, polygon outline color), and `ui` (header bg/text/border, toggle bg/text states, indicator + fixture indicator colors, legend, tooltip). `THEMES: Record<ThemeId, Theme>` exports both light (current values, no visual change) and dark (DARK basemap with `water: '#1a2733'` deep blue-gray override; cyan→red neighborhood gradient; cyan→teal→yellow→orange→red heatmap palette; dark glass header with light text; **inverted** tooltip — white bg, dark text — to stand out against the dark basemap). State lives in `App.tsx` (`useState<ThemeId>(detectInitialTheme)` reads `prefers-color-scheme: dark` once on mount; no persistence). On theme change a `useEffect` syncs `document.documentElement.dataset.theme` and writes every `theme.ui` key as a CSS custom property (camelCase → kebab-case via regex). All chrome CSS rules in `src/index.css` were converted to `var(--name, fallback)` so light values still work even when JS hasn't yet set the vars. Map.tsx accepts a `theme` prop, replaces the module-scope `lightFlavor` + `baseStyle` with a `buildBaseStyle(theme)` factory wrapped in a `useMemo`, and derives `fillColorExpr` and `heatmapColorExpr` from `theme.overlays.*` via `useMemo`. The neighborhood outline `line-color` reads `theme.overlays.neighborhoodOutline` directly. Smooth 200ms `background-color` / `color` / `border-color` / `box-shadow` transitions on header, legend, tooltip, indicator, toggle pills + buttons; map style swap is instant per MapLibre's `setStyle` semantics (acceptable, called out in spec).
- **Why:** The page was permanently bright daytime; users in dark environments or on dark-themed OSes experienced eye strain from the bright basemap competing with the heatmap. Adding a structured theme system *now* — before adding more themes (sepia, synthwave) later — forces us to factor color out of the rendering layer cleanly so we never have to retro-fit a one-off theme switch into hardcoded paint expressions.
- **Notable:** Confirmed `DARK` is a named export from `@protomaps/basemaps@5.7.2` (alongside `LIGHT`, `WHITE`, `BLACK`, `GRAYSCALE`); the `Flavor` type is also exported, so `Theme.protomapsFlavor` is typed as `Flavor` rather than `Record<string, string>` — `Flavor` has nested objects (`pois`, `landcover?`) that wouldn't satisfy a flat string-record. The heatmap-color paint expression types as `ExpressionSpecification` (no data-driven, only `heatmap-density`) while fill-color is `DataDrivenPropertyValueSpecification<string>` — different MapLibre types; the heatmap one needed an `as unknown as ExpressionSpecification` cast since spreading `[number, string]` tuples into the array widens the type beyond what the spec's intersection accepts. CSS-var fallback values (`var(--header-bg, rgba(255, 255, 255, 0.85))`) are intentional: pre-mount the JS hasn't yet set vars, so the page renders in the light defaults rather than transparent/black until the effect runs. Tooltip inversion on dark (white bg, dark text) is a deliberate readability choice — a dark-on-dark tooltip washes into the basemap. The amber fixture indicator pill keeps its hue across themes (it's the established "frozen data" cue) but bumps to `#fbbf24` text on a brighter `rgba(245, 158, 11, 0.25)` background in dark for contrast. OS preference detected once on first mount via `window.matchMedia('(prefers-color-scheme: dark)').matches`; not subscribed to live changes — if a user flips system appearance mid-session they need to reload. Explicit user choice not persisted across sessions (matches view-mode-toggle pattern).

### 2026-05-05 — Backend Session 1: Cloudflare Workers + D1 scaffold + raw GBFS ingestion
- **Changed:** Added a self-contained `backend/` subfolder at the repo root: `src/index.ts` (scheduled handler dispatching by `controller.cron`), `src/gbfs.ts` (`fetchSnapshotRows(capturedAt)`), `src/db.ts` (`insertSnapshots()`, `deleteOlderThan()`), `schema.sql` (`raw_snapshots` table with composite PK `(station_id, captured_at)` and a separate index on `captured_at`), `wrangler.toml`, `tsconfig.json` (Workers preset, strict, noUnused*), `package.json` (devDeps only — `wrangler@3.114`, `@cloudflare/workers-types`, `typescript`), `.gitignore`, and a `README.md` covering local dev / deploy / inspect / logs. Created a D1 database `where-in-the-citi-data` (id `3ec86814-…`, region ENAM), applied schema, deployed the Worker to `where-in-the-citi-backend.kazumasa-umemoto.workers.dev`. Two crons live: `* * * * *` polls the GBFS `station_status.json` and writes ~2400 rows per poll via a single `db.batch()` transaction with `INSERT OR IGNORE`; `0 3 * * *` runs nightly at 03:00 UTC to delete rows with `captured_at < now − 24h`. Verified end-to-end: two consecutive polls landed exactly 60s apart at unix 1778287317 and 1778287377, 2406 rows each, on minute boundaries.
- **Why:** The frontend currently fetches GBFS directly from each user's browser, which means (a) every visitor independently rebuilds the rolling-window from scratch over ~5 minutes (slow first paint), and (b) we can't show any history that predates the user's session. A backend that polls continuously and stores history solves both. Cloudflare Workers + D1 chosen for: free/cheap tier suitable for a hobby project, scheduled cron support without managing servers, a serverless SQLite database with a familiar query surface, Wrangler CLI for one-command deploy, and TypeScript end-to-end with zero glue.
- **Notable:** Session 1 scope is intentionally narrow — scaffold + raw ingestion only. Activity computation, the API endpoints the frontend will call, and the frontend swap to read from this backend instead of GBFS direct all live in Sessions 2-4. **Cadence chosen at 1 poll/min, not 30s** — 60 snapshots per 15-min bucket vs 30 isn't a meaningful precision difference for our aggregation, and starting cheap (~2.88M writes/day vs 5.76M) keeps Session 1 well inside expected D1 budget; can revisit if visibly worse activity scores warrant the extra writes. **`captured_at` is the Worker's `Math.floor(Date.now()/1000)` at fetch time, NOT GBFS's per-station `last_reported`** — gives us a uniform per-snapshot timestamp suitable for `GROUP BY captured_at` aggregation downstream. **The `scheduled()` handler param is `ScheduledController`, not `ScheduledEvent`** (initial typing mistake; CF Workers types differ from the older Service Worker API). **`db.batch()` runs ~2400 statements as a single transaction**, so each poll is one round trip from the Worker to D1. **24-hour retention on raw snapshots** is intentional — the 7-day historical view will live in 15-minute aggregates added in Session 2, not in raw data; keeping raw beyond a day is wasted storage. The `[[d1_databases]]` `database_id` had to land in `wrangler.toml` after `wrangler d1 create` ran (Cloudflare emits the UUID server-side), so the create step couldn't be a single atomic `wrangler deploy`.

### 2026-05-05 — Backend Session 2: Wrangler 4 upgrade + 15-min activity aggregation pipeline
- **Changed:** Pre-step in strict isolation: bumped `wrangler@^3.80` → `^4.0.0` (resolved to 4.86.0), reinstalled, redeployed with no other changes — verified poll cron continued firing (15→16 polls, latest `captured_at` advanced 60s) before any Session 2 work touched the codebase. Then added the aggregation pipeline: three new tables in `backend/schema.sql` (`station_buckets`, `neighborhood_buckets`, `stations_neighborhoods`) all with composite/single-column PKs and `bucket_start` indexes. New module `backend/src/aggregation.ts` with `bucketStartFor(now) = floor(now/900)*900 - 900` (always names the previous-completed boundary), `computeStationBuckets(rows, bucketStart)` (single-pass over `ORDER BY station_id, captured_at` rows, mirroring `src/activity.ts` exactly — same `DEST_MULT_POSITIVE=1.0`/`ZERO=0.3`/`NEGATIVE=0.1`, same `delta = curr - prev` arithmetic, same skip-if-no-deltas semantics), and `runAggregation()` orchestrating the SELECT → in-memory compute → batch INSERT OR REPLACE → neighborhood SQL aggregation. The neighborhood query is a single `INSERT OR REPLACE INTO neighborhood_buckets … SELECT … FROM stations_neighborhoods sn LEFT JOIN station_buckets sb …` — runs server-side in D1, no Worker-side loop, so the per-bucket NTA aggregation is a single round trip. New cron `*/15 * * * *` added to `wrangler.toml` triggers; `index.ts` dispatches on `controller.cron === '*/15 * * * *'`. `db.ts` got `runRetentionCleanup()` that deletes `raw_snapshots > 24h`, `station_buckets > 7d`, `neighborhood_buckets > 7d` in a single `db.batch()`. New script `backend/scripts/populate-stations-neighborhoods.ts` (run via `npm run setup:stations`) fetches `station_information.json`, point-in-polygons each station against `backend/data/nyc-neighborhoods.geojson` (copied from frontend's `public/data/`), and `INSERT OR REPLACE`s 2299 (`station_id`, `neighborhood_id`, `capacity`) rows in 200-row SQL-file batches via shell-out to `wrangler d1 execute --remote --file=…`. Added devDeps: `tsx`, `@turf/boolean-point-in-polygon`, `@turf/helpers`. Verified end-to-end: first aggregation cron landed at `bucket_start=1778288400`, wrote 2406 station_buckets rows + 125 neighborhood_buckets rows; top neighborhoods by `total_activity` are `MN0303`/`MN0401`/`MN0302` (Midtown), `BK0102`/`BK0104` (Williamsburg), `MN0202`/`MN0203` (Lower Manhattan) — geographically correct.
- **Why:** The frontend's rolling-window activity model only works while a tab is open and only against ~5 minutes of data. Backend aggregation gives us (a) per-bucket history we can replay or chart, (b) any visitor sees correct numbers on first paint instead of waiting 5 minutes for the window to fill, and (c) per-neighborhood totals computed once server-side instead of recomputed in every browser. The 15-minute granularity is the unit of long-term storage; raw snapshots stay 24h only and serve as the source for fresh bucket aggregation.
- **Notable:** **Wrangler 4 upgrade was clean** — no breaking changes hit our setup; the deprecation warnings I'd been seeing went away. **Activity formula porting validated by output shape**: 2406 station_buckets rows from a bucket where ~2400 stations have ≥1 valid delta (matches expected GBFS station count); per-station avg score 0.6, max 28.8, total sum 1442.4 — distribution matches the "most stations idle, a few busy" pattern the frontend produces. **Sum delta between station-level and neighborhood-level totals (1442.4 vs 1420.9, 1.5%)** comes from ~107 stations that exist in `raw_snapshots` but not in `stations_neighborhoods` — stations added to the GBFS feed since the populator last ran, or stations whose lat/lon falls outside any NTA polygon; they get scored but don't roll up. Re-running `npm run setup:stations` periodically closes this gap. **Idempotency via `INSERT OR REPLACE` on both bucket tables** means re-runs of the same bucket (cron drift, manual re-trigger) produce a clean rewrite, not a stale cached version. **Empty-bucket guard**: `runAggregation` short-circuits if either the SELECT returns 0 rows OR the in-memory compute produces 0 station_buckets (e.g., all rows were single-snapshot orphans) — neither table receives writes, so a Worker outage doesn't pollute storage with zero-rows-everywhere. **Sparse-bucket handling matches frontend exactly**: deltas are computed only between adjacent rows for the same station; a station with 3 of 15 expected snapshots produces 2 deltas across whatever time gaps exist, no interpolation. **Cron simultaneity**: `* * * * *` and `*/15 * * * *` both fire on the :00/:15/:30/:45 minutes — Cloudflare delivers two separate `scheduled()` invocations on those ticks, each carrying its own `controller.cron` string, so the dispatch is `if/else if/else if` (not `else`) and both run independently. **The shell-out approach for the populator script** (`execFileSync('npx', ['wrangler', 'd1', 'execute', …])` with batched temp SQL files) avoids plumbing a Cloudflare API token into local Node config; trades startup latency (~1s per batch) for zero auth surface and is fine for a script that runs maybe once a month. **Quoting/escaping**: station_id values are GBFS-controlled UUIDs, so SQL-injection risk is zero in practice, but the script still escapes single quotes (`'` → `''`) defensively. Frontend cross-check (running `src/activity.ts`'s `computeActivity` on the same window of raw snapshots and asserting score equality) is deferred to Session 3 where the frontend starts consuming the API anyway — at that point the comparison is the integration test itself.

---

## What I'd do differently

### Things to keep doing

- **Plan mode in Claude Code.** Reading the plan before approving caught issues
  early and was the main way I re-learned patterns I'd forgotten.
- **Iterating on the activity model in conversation, not in code.** Five
  versions of the formula evolved purely through discussion. Cheaper than
  five rewrites.
- **Asking "does this match my intuition?"** when I saw the map. The screenshot
  showing identical bullseyes was a turning point — I trusted what I saw and
  redesigned, rather than tuning constants forever.
- **Small, frequent commits.** Each phase or fix got its own commit.

### Things to do differently next time

- **I should have written `CLAUDE.md` earlier and more completely.** I kept
  pasting context into prompts. `CLAUDE.md` would've shortened them all.
- **I should have audited code more often instead of trusting plans matched
  implementation.** The popup bug would have been caught earlier if I'd read
  `activity.ts` once it was written. The plan said one thing; the code did
  another. (Specifically: rank logic worked correctly but had collisions I
  didn't anticipate from reading the plan alone.)
- **I should have set up the Git PATH fix once and stopped fighting Homebrew.**
  I worked around the libcurl issue with `/usr/bin/git push` rather than fixing
  it. Works, but every push is now a small papercut. (Real fix: edit `~/.zshrc`
  to put `/usr/bin` ahead of `/opt/homebrew/bin` for git.)
- **I should have known what GBFS does and doesn't provide before designing
  the activity model.** I asked partway through if GBFS provides historical
  data. The answer is no, and that constraint should have been clear from the
  start. Would have saved one or two iterations of the model.
- **Starting with Leaflet was probably right; staying on it past phase 6 was
  not.** Leaflet was familiar and got us to a working app five phases in. But
  by the time I was reaching into `leaflet.heat`'s private `_canvas` field to
  control opacity and the crossfade *still* felt steppy because raster zoom
  doesn't truly interpolate, the signal was clear. The lesson isn't "should
  have started with MapLibre" — it's "notice when you're working *against* a
  library instead of with it, and migrate then, not three workarounds later."

### Things I learned about the work, not just the project

- **Product thinking > code thinking.** The best moves in this project were
  product decisions (zoom-aware viz, neighborhood aggregation, what "hotspot"
  means). The code to implement them was the easy part.
- **State synchronization bugs are sneaky.** They look like math bugs.
- **AI pair programming works best when you read what it produces.** Every
  time I just trusted the plan, something later didn't behave as expected. The
  diff is the source of truth.
- **Premature backend is the most expensive premature optimization.** Adding
  a backend doubles the project's surface area; deferring kept everything
  shippable.

---

## Glossary of concepts I learned/relearned

- **GBFS (General Bikeshare Feed Specification):** standard real-time format
  for bikeshare systems. Public, no auth. Snapshot-only — no historical data.
- **Rolling window:** fixed-size buffer of recent snapshots; oldest dropped as
  newest added. The basis of all activity calculations here.
- **Net inbound vs. total churn:** net = arrivals − departures (direction
  matters); churn = arrivals + departures (direction doesn't). Different
  signals for different questions.
- **Power scaling:** transforming weights with `x^n` to amplify contrast
  between high and low values. Useful when normalization (1.0 max) flattens
  the visual signal.
- **Choropleth:** map where regions (here, neighborhoods) are colored by a
  data value. The neighborhood layer in this app is a choropleth.
- **Point-in-polygon:** geometric test for whether a coordinate is inside a
  shape. Used to assign each station to a neighborhood. Should be cached, not
  recomputed.
- **Crossfade vs. hard swap:** crossfade = both layers visible at varying
  opacity during a transition; hard swap = instant on/off. Crossfade feels
  smoother; hard swap is simpler.
- **NTA (Neighborhood Tabulation Area):** NYC's official ~200-neighborhood
  boundary set, published as GeoJSON on NYC Open Data.
- **`useRef` vs. `useState`:** `useState` triggers re-renders; `useRef`
  doesn't. Snapshot history goes in `useRef` because we don't want to re-render
  on every poll, only when computed values change.

---

## Open questions and future ideas

- **Backend for instant first-load.** Pattern: GitHub Actions polls GBFS every
  30s → writes JSON to Cloudflare R2 / S3 → frontend fetches on load to seed
  the window.
- **Time-of-day baselines.** "This neighborhood is hotter than usual for a
  Tuesday morning" — requires historical data. Backend prerequisite.
- **Departure hotspots.** Currently we de-emphasize net-source stations. A
  toggle for "where are people leaving from?" would be a different lens.
- **Mobile UX.** Pinch-zoom transitions, popup sizing, touch targets.
- **Trail / direction visualization.** Could show inferred flow between
  neighborhoods based on cross-snapshot comparisons. Probably interesting
  but hard to do well.
- **Crossfade on zoom transition.** Polish for when hard swap feels jarring.

---

## Tools and environment notes for future me

- **Node.js 24 LTS** (current Active LTS as of April 2026)
- **Apple Git via `/usr/bin/git`** for pushes (Homebrew Git has libcurl issue
  on this machine; permanent fix via PATH was deferred)
- **Vite dev server** at `localhost:5173`
- **GBFS endpoints** (no auth):
  - `https://gbfs.citibikenyc.com/gbfs/en/station_information.json`
  - `https://gbfs.citibikenyc.com/gbfs/en/station_status.json`
  - `https://gbfs.citibikenyc.com/gbfs/gbfs.json` (discovery)

---

*This journal is a snapshot in time. Update it when you make a meaningful
decision or learn something worth remembering.*