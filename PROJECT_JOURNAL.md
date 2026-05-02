# Citi Bike Hotspots — Project Journal

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