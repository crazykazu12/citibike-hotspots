# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

**Name:** Where in the Citi?
**Tagline:** Real-time Citi Bike activity across NYC

A real-time visualization of NYC Citi Bike activity hotspots. Shows where bike traffic is concentrated using citywide neighborhood views (zoomed out) and station-level cluster fills (zoomed in). Backend computes 15-minute aggregates for historical day-over-day and week-over-week comparisons (planned). Frontend renders via MapLibre + Protomaps vector tiles.

The app was previously named "Citi Bike Hotspots"; the npm package name (`citi-bikes`) is the repo identifier and is intentionally unchanged.

## Architecture

Single repo, two top-level apps with separate `package.json` files and dependencies:

- **Frontend** — `/src` — React + Vite + TypeScript + MapLibre GL JS + Protomaps vector tiles + `react-map-gl`. Entry: `index.html` → `src/main.tsx` → `src/App.tsx`.
- **Backend** — `/backend` — Cloudflare Workers + D1 database. Entry: `backend/src/index.ts`.

**Deployment** (everything on the same Cloudflare account):
- Frontend: Cloudflare Pages at `https://where-in-the-citi.pages.dev`. Project name `where-in-the-citi`. **Manual deploy** — see the Gotcha below; pushes to `main` do NOT auto-deploy the frontend.
- Backend: Cloudflare Workers at `where-in-the-citi-backend.kazumasa-umemoto.workers.dev`. Deployed via `cd backend && npx wrangler deploy`; also manual, not auto-on-push.
- Basemap tiles: Cloudflare R2 bucket `where-in-the-citi-tiles` (public r2.dev URL), serving an NYC PMTiles extract at `https://pub-1e4794524da64a1aa8c1dc2c9e85cc47.r2.dev/nyc.pmtiles`. The frontend's `PMTILES_URL` constant in `src/Map.tsx` points here. See "Regenerating the NYC tile extract" below.

Build artifact `dist/` is gitignored (`.gitignore` line `dist`) — Cloudflare Pages builds nothing on its own with the current setup, so `npm run build` must happen locally before `wrangler pages deploy dist`.

**Data flow (post-Session 3):** the frontend fetches from the backend's `/current` endpoint every 30s and renders the pre-computed activity. It no longer calls GBFS directly. The activity formula in `src/activity.ts` is fixture-mode-only and tree-shakes out of production builds.

## Data Sources

Public Citi Bike GBFS feed, no auth required:
- Station info (static): `https://gbfs.citibikenyc.com/gbfs/en/station_information.json`
- Station status (live): `https://gbfs.citibikenyc.com/gbfs/en/station_status.json`
- Discovery endpoint: `https://gbfs.citibikenyc.com/gbfs/gbfs.json`

Merge `station_information` and `station_status` on `station_id`. Status updates roughly every 30 seconds upstream.

NYC neighborhoods: NTA2020 polygons from NYC Open Data. The same file is checked into both apps:
- Frontend: `public/data/nyc-neighborhoods.geojson`
- Backend: `backend/data/nyc-neighborhoods.geojson` (intentional duplicate so each app is self-contained)

The `neighborhood_id` used everywhere is the GeoJSON `properties.nta2020` code (e.g., `MN0502`, `BK0103`).

## Activity Formula (the heart of the system)

The same formula is implemented in both `src/activity.ts` (frontend, sliding window) and `backend/src/aggregation.ts` (backend, fixed 15-min buckets). **They must stay in sync.**

For each station within a 15-minute window:

```
bikes_in       = sum of positive deltas across consecutive snapshots
bikes_out      = sum of |negative deltas|
total_churn    = bikes_in + bikes_out
net_inbound    = bikes_in - bikes_out

destination_multiplier =
  1.0 if net_inbound > 0    (popular destination)
  0.3 if net_inbound == 0   (balanced pass-through)
  0.1 if net_inbound < 0    (popular origin/source)

activity_score = total_churn × destination_multiplier
```

The destination multiplier is intentional: it's a product decision about what "hotspot" means. Pure-traffic scoring (no multiplier) lights up subway-exit stations where commuters grab bikes — high churn, but those are origins, not destinations. Net-inflow weighting answers "where are people going?"

### Edge cases

- Stations with **no valid deltas** in the window are not emitted (don't write `activity_score = 0`).
- **Empty buckets** (no source data) are skipped without writing anything.
- **Sparse buckets** compute deltas only between adjacent available snapshots; no interpolation.

## Window Sizes (Standardized at 15 Minutes)

- **Frontend live view:** rolling 15-minute window of 30-second snapshots.
- **Backend bucket aggregates:** fixed 15-minute boundaries (xx:00, xx:15, xx:30, xx:45).
- **Polling cadence:** frontend 30s, backend 60s. Sparse-insert filter (only write rows whose `bikes_available` changed since the last stored value) drops ~80-90% of writes vs naive dense inserts, keeping 1-min polling within the 50M/month included D1 write allowance (~11.6M/month observed).

## Visualization Model

Zoom-aware crossfade between two views:

- **City zoom (zoom ≤ 13):** Neighborhood polygons colored by absolute citywide activity. Quiet neighborhoods near-transparent so hot zones pop. Hover shows neighborhood name. Click zooms in to fit the neighborhood (smooth `fitBounds` with ~40px padding).
- **Neighborhood zoom (zoom ≥ 14.5):** Station-level activity rendered as cluster fills. Connected components of nearby active stations (within 300m, score ≥ threshold) get convex hulls filled with a radial gradient (centers hot, edges cool). Pair corridors for active station pairs that aren't part of larger clusters. Heatmap normalization is **bounds-relative** — pan to a quiet area and its local hotspots become visible.
- **Crossfade:** zoom 13 → 14.5 with opacity interpolation. Fractional zoom enabled (`zoomSnap=0`).

## Frontend UI Features

- **Header:** title "Where in the Citi?", subtitle, theme picker (Light/Dark), view-mode toggle (All zones / Hot only), last-updated indicator (or fixture-mode badge).
- **Theme picker:** OS preference (`prefers-color-scheme`) detected on first load. No persistence across sessions — explicit choice resets on reload.
- **View mode "Hot only":** filters out neighborhoods below 0.35 of citywide max activity; only top tier visible.
- **Initial view:** centered on NYC at zoom ~9, all five boroughs visible. `minZoom` locked to the initial zoom; `maxBounds` constrains panning to the NYC area.
- **Hover tooltips:** show neighborhood name in any view mode (even invisible-in-Hot-Only neighborhoods — the polygon is still hit-tested).
- **Click-to-zoom:** click a neighborhood at low zoom → smooth `fitBounds` animation. Gated by zoom level (no-op when already zoomed in).

## Frontend Development: Fixture Mode

Set `VITE_USE_FIXTURES=true` in `.env.local` to load `src/fixtures/current.json` instead of polling the backend. Use for visual iteration without round-trips. **Never enable in production builds.**

When enabled, the app one-shot-loads the fixture, sets state once, and skips all subsequent polling. A "Fixture mode — frozen data" pill appears in the header indicator slot.

**Capture new fixtures** in DevTools (in non-fixture mode):
```js
await window.__downloadFixtures()
```
A `current.json` file downloads; move it into `src/fixtures/` (overwriting).

**Production safety:** the `VITE_USE_FIXTURES` check is a Vite env var inlined as a string literal at build time. When `false`/unset, the entire fixture branch — including the dynamic JSON import — is dead-coded out of the bundle. The dev-global `window.__downloadFixtures` is gated behind `import.meta.env.DEV` and tree-shakes out of production.

The fixture file is a saved `/current` API response, so fixture mode and live mode share the same downstream code path post-fetch — fixture mode genuinely tests production rendering.

## Backend Architecture

### Tables (D1)

```
raw_snapshots          -- live data, retained 24h
station_buckets        -- 15-min aggregates per station, retained 7d
neighborhood_buckets   -- 15-min aggregates per neighborhood, retained 7d
stations_neighborhoods -- station→neighborhood mapping with capacity
```

### Crons

| Cron | Purpose |
|---|---|
| `* * * * *` | Polls GBFS, fetches all ~2,300 stations, writes only the ~50-500 with a changed `bikes_available` value (sparse-insert filter in `pollAndWrite`) via `db.batch()` |
| `*/15 * * * *` | Aggregates the just-completed bucket into `station_buckets` and `neighborhood_buckets` |
| `0 3 * * *` | Daily cleanup: `raw_snapshots > 24h`, bucket tables `> 7 days` |

The poll and aggregate crons co-fire on `:00`/`:15`/`:30`/`:45` minutes — Cloudflare delivers each as a separate `scheduled()` invocation with its own `controller.cron` string. The dispatch is `if / else if / else if`, not `if / else`.

### Idempotency

All bucket writes use `INSERT OR REPLACE`. Re-runs of any aggregation (cron drift, manual re-trigger) produce a clean rewrite. Raw snapshots use `INSERT OR IGNORE` as belt-and-suspenders for retries on the same `(station_id, captured_at)`.

### Database Operations

- **Database name:** `where-in-the-citi-data` (id `3ec86814-5e8e-4d0e-8ce6-f62b2d2584d7`, ENAM region)
- `cd backend && npm run db:count` — row count + min/max captured_at
- `cd backend && npm run tail` — stream Worker logs
- `cd backend && npm run setup:stations` — re-populate station→neighborhood mapping. Periodic; ~1-5% gap accumulates as new stations join GBFS.
- Use `db.batch()` for multi-row inserts (~2,300 rows per poll).

## Conventions

### Code style

- Use named constants at the top of files for tunable values. No magic numbers.
- Comment **why**, not **what**. Code shows what; comments add context.

### Workflow

- **Plan before implementing** for non-trivial changes. Propose a plan with open questions and tradeoffs, wait for approval, then implement.
- **Append a Build Log entry to `PROJECT_JOURNAL.md`** after meaningful changes — date, what changed, why, and notable details/gotchas.

### Git

- Push to main using `/usr/bin/git push` (Apple Git, not Homebrew Git — see Gotchas).
- Commit messages: short, imperative ("Add header with theme picker", not "Added header").

## Gotchas (Hard-Won Lessons)

### MapLibre paint expressions: `['zoom']` cannot be inside a math operator

`['zoom']` cannot appear inside `*`, `+`, `min`, `max`, etc. To combine zoom-driven and feature-driven values, use **nested interpolate**: outer `interpolate` over `['zoom']`, inner `interpolate` over feature properties as the output value.

```ts
// ❌ Wrong — silently drops the entire layer at style-load time,
// breaking fills, hover, AND click handlers all at once.
['*',
  ['interpolate', ['linear'], ['zoom'], 13, 1, 14.5, 0],
  ['interpolate', ['linear'], ['get', 'score'], 0, 0.05, 1, 0.55]]

// ✅ Right — same math, spec-compliant.
['interpolate', ['linear'], ['zoom'],
  13, ['interpolate', ['linear'], ['get', 'score'], 0, 0.05, 1, 0.55],
  14.5, 0]
```

### Cloudflare Workers: scheduled handler type

The `scheduled()` handler parameter type is `ScheduledController`, **not** `ScheduledEvent` (the older Service Worker spec). TypeScript catches this pre-deploy. Easy to miss because most CF Workers tutorials still show the old type.

### Homebrew Git on macOS

Homebrew's Git build has a libcurl mismatch (`Symbol not found: _curl_global_trace`) that kills `git push`. Workaround: `/usr/bin/git push` (Apple's bundled Git, slightly older but works).

### Map serialization

The frontend's snapshot rolling window uses `Map` objects. `JSON.stringify(map)` produces `{}`. Always convert with `Array.from(map)` (→ tuple array) or `Object.fromEntries(map)` (→ plain object) before serializing. The fixture download flow uses `Object.fromEntries(map)`.

### Protomaps default theme has cyan water

`@protomaps/basemaps`'s `LIGHT` theme defines `water: '#80deea'` (saturated cyan) — fine for tourist maps, wrong for a data overlay. Override via theme spread:
```ts
const lightFlavor = { ...LIGHT, water: '#cad2d3' }
```

### MapLibre style swap on theme change

Use the `mapStyle` prop on `<Map>` to swap themes — react-map-gl calls `setStyle` and re-attaches our source/layer JSX after `style.load`. **Don't use a `key` prop** to force remount: that loses zoom/center state. The style swap is instant (no crossfade — MapLibre limitation), but chrome elements transition smoothly via CSS for a polished feel.

### D1 batch inserts

~2,300 rows per poll. Always use `db.batch()` with prepared statements — individual inserts would be ~2,300 round-trips and would fail. Use `INSERT OR IGNORE` (raw snapshots) or `INSERT OR REPLACE` (bucket aggregates) for idempotency.

### Don't pin the Protomaps demo PMTiles URL

The original `src/Map.tsx` pointed at `https://demo-bucket.protomaps.com/v4.pmtiles` (the public demo bucket). That URL was 404'd by Protomaps without notice between development and the first production deploy (2026-05-22), breaking the basemap on the live site. The fix was to self-host an NYC extract on R2 — same Cloudflare account, no rate limits, no third-party URL stability risk. The lesson is general: any time the code references an "example" / "demo" / "public test" URL, treat it as a borrowed asset and move to a self-hosted version before going public. Decision #8 in `PROJECT_JOURNAL.md` and the 2026-04-26 migration entry both flagged this exact risk — the lesson here is that flagged-but-unfixed pre-launch items must be cleared before the launch, not after.

The fonts glyph URL (`https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf` in `src/Map.tsx`) is the same shape of borrowed asset — still working at the time of writing, but worth self-hosting alongside the tiles if it ever breaks (it's small, ~5-10 MB of `.pbf` font files; upload the whole `basemaps-assets/fonts/` directory to R2 and swap the URL).

### Regenerating the NYC tile extract

The basemap PMTiles file in R2 freezes OSM data at the build date. Regenerate every 6-12 months (or sooner if streets/landmarks change visibly):

```bash
# 1. Find the most recent planet build (build.protomaps.com has no directory
#    index; HEAD-probe today's date and walk back if needed).
curl -sI https://build.protomaps.com/$(date -u +%Y%m%d).pmtiles | head -1   # → 200 OK

# 2. Extract the NYC bbox (covers 5 boroughs + JC/Hoboken/Weehawken).
#    maxzoom=15 is the chosen detail level; MapLibre overzooms above 15.
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles /tmp/nyc.pmtiles \
  --bbox=-74.30,40.45,-73.65,40.95 --maxzoom=15

# 3. Upload to R2, overwriting the existing object.
cd backend && npx wrangler r2 object put where-in-the-citi-tiles/nyc.pmtiles \
  --file=/tmp/nyc.pmtiles --content-type=application/octet-stream --remote
```

Current extract: ~106 MB, 4,323 tiles, built from `20260522.pmtiles`. No frontend change needed — the URL is stable. R2 CORS rules (allowed origins `https://where-in-the-citi.pages.dev` and `http://localhost:5173`, GET/HEAD with `Range`) are stored on the bucket; re-apply via `npx wrangler r2 bucket cors set where-in-the-citi-tiles --file=<rules.json> --force` if they ever get cleared.

### Attribution is a real licensing requirement

The Protomaps tilesets are a "Produced Work" of OpenStreetMap and inherit OSM's ODbL license. The map MUST visibly credit `© OpenStreetMap` somewhere. The attribution is wired via the `attribution` field on the `protomaps` vector source in `src/Map.tsx` (`<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>`); `react-map-gl`'s `<MaplibreMap>` adds a default `AttributionControl` that renders it bottom-right. If you ever set `attributionControl={false}` or add a custom map UI that hides the default control, you must surface the OSM credit elsewhere on the page.

### Frontend deploy is manual — `git push` is NOT enough

There is no CI hook between this repo and Cloudflare Pages. Pushing to `main` updates GitHub but does NOT publish the frontend. To ship a frontend change:

```bash
npm run build                                                    # locally produce dist/
npx wrangler pages deploy dist --project-name=where-in-the-citi  # upload to Pages
```

The Pages project lives on the same Cloudflare account as the Worker (`where-in-the-citi`, production branch `main`, no Git integration configured). If you skip the build step, you'll redeploy whatever stale assets are in `dist/`. The 2026-05-22 audit caught the same class of bug for the backend (uncommitted-and-undeployed for 10 days) — the frontend deploy story is the same shape: deploy is an explicit step, never assumed.

Future option: connect Cloudflare Pages → GitHub for auto-deploy on push, or add a GitHub Action calling `wrangler pages deploy`.

## Backend Operations Reference

```bash
cd backend

# Latest poll status
npx wrangler d1 execute where-in-the-citi-data --remote \
  --command="SELECT COUNT(*), MAX(captured_at) FROM raw_snapshots"

# Latest aggregated bucket
npx wrangler d1 execute where-in-the-citi-data --remote \
  --command="SELECT bucket_start, COUNT(*), SUM(activity_score) FROM station_buckets GROUP BY bucket_start ORDER BY bucket_start DESC LIMIT 5"

# Top hot neighborhoods in latest bucket
npx wrangler d1 execute where-in-the-citi-data --remote \
  --command="SELECT neighborhood_id, total_activity FROM neighborhood_buckets WHERE bucket_start = (SELECT MAX(bucket_start) FROM neighborhood_buckets) ORDER BY total_activity DESC LIMIT 10"

# Stream live logs
npm run tail

# Force re-run of station→neighborhood mapping
npm run setup:stations
```

## Build Phases Completed

1. Vite + React + TypeScript scaffolding
2. GBFS data fetch + merge (`station_information` × `station_status`)
3. Station markers on Leaflet map *(later removed in Phase 7)*
4. Activity model with destination weighting + heatmap visualization
5. Cluster fills, neighborhood layer, zoom-aware crossfade
6. Polish (header, theme picker, view-mode toggle, framing, hover tooltips, click-to-zoom)
7. Migration from Leaflet → MapLibre + Protomaps
8. Connection layer (corridors → densified heat points → cluster hulls)
9. Convex hull cluster fills with radial gradient
10. **Backend Session 1:** Cloudflare Workers + D1 scaffolding, GBFS polling cron
11. **Backend Session 2:** Wrangler 4 upgrade, 15-min activity aggregation, station→neighborhood mapping
12. **Backend Session 3:** Read API (`/current`, `/comparison`) + frontend integration. (The commit subject mentioned "Vercel deploy" but no Vercel deploy ever happened — frontend was first shipped to Cloudflare Pages on 2026-05-22.)
13. **Backend Session 4:** Comparison-mode UI (today vs yesterday)
14. **Backend Session 5:** Sparse-insert poll handler + seed-row aggregation query (shipped 2026-05-22)

## What's Next

- **Data collection is active** (1-min sparse polling). `backend/wrangler.toml` `[triggers].crons = ["* * * * *", "*/15 * * * *", "0 3 * * *"]`. The 2026-05-12 "pause" documented in `PROJECT_JOURNAL.md` was never actually deployed (working-tree-only); see the 2026-05-22 correction entry for the full timeline.
- **Backend Session 3:** *(done)* Read API + frontend integration. (Frontend deployed to Cloudflare Pages 2026-05-22, not Vercel as the original commit subject suggested.)
- **Backend Session 4:** *(done)* Comparison-mode UI (today vs yesterday).
- **Backend Session 5:** *(done, deployed 2026-05-22)* Sparse-insert poll handler + seed-row aggregation query. Sparse-insert verified live (~50-500 rows/poll vs ~2,300 dense). Seed-row aggregation structurally working; first post-deploy bucket activity is transiently inflated until ~03:00 UTC cleanup removes stale 2026-05-12 seed rows.
- **Future:** Deeper time comparisons (`lastweek`), mobile responsive layout, custom themes beyond light/dark.

## Project Journal

A running log of decisions, tradeoffs, and learnings lives in `PROJECT_JOURNAL.md` at the project root. After meaningful changes, append a Build Log entry there.
