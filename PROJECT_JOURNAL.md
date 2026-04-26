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
| **Leaflet + react-leaflet** | Free, no API key, mature; OpenStreetMap tiles |
| **leaflet.heat** | Drop-in heatmap layer for Leaflet |
| **No backend** | GBFS is public + CORS-enabled; can fetch directly from browser |
| **Vercel (planned)** | Free static hosting, GitHub auto-deploy |

**Considered and rejected:**
- Mapbox / Google Maps — required API keys and billing setup for a free project
- Python backend (FastAPI) — unnecessary for v1; would have added scope
- D3 for custom heatmap — leaflet.heat handles it well enough

---

## Build phases (as actually executed)

1. **Scaffolding** — Vite project, Git, GitHub repo, `CLAUDE.md` for context
2. **Data fetching** — typed fetcher merging `station_information` + `station_status` on `station_id`
3. **Map with markers** — Leaflet centered on NYC, ~2,000 markers with click-to-popup
4. **Heatmap with activity model** — the meat of the app; multiple iterations (see below)
5. **Polish** — (in progress)
6. **Deploy** — (pending)

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
- **Zoom ≤ 13** (city overview): NYC neighborhoods (NTAs) colored by aggregate activity
- **Zoom ≥ 15** (neighborhood-level): station-level heatmap visible
- **Hard swap** at the threshold (deferred crossfade as future polish)

Markers visible at all zoom levels for click-to-detail.

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