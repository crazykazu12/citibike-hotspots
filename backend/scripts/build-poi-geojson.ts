// One-shot pre-processing: fetches four POI categories (coffee, food, bars,
// parks) from OpenStreetMap via the public Overpass API, converts to stripped
// GeoJSON, simplifies park polygons, writes to backend/data/, and uploads each
// to the same R2 bucket that hosts the basemap PMTiles.
//
// POI data is essentially static (cafes turn over slowly; parks almost never),
// so the frontend will load these files once from R2 and cache them. Regenerate
// quarterly (or sooner if visibly stale). See CLAUDE.md "Regenerating POI data".
//
// Runs as a local Node script via tsx; pre-req: `wrangler login` already done.
//
// Usage:  npm run setup:poi

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import osmtogeojson from 'osmtogeojson'
import simplify from '@turf/simplify'
import type { Feature, FeatureCollection, Geometry } from 'geojson'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const USER_AGENT = 'where-in-the-citi/dev (contact: kazumasa.umemoto@gmail.com)'
// south,west,north,east — Overpass bbox order. Matches basemap extract.
const BBOX = '40.45,-74.30,40.95,-73.65'
const R2_BUCKET = 'where-in-the-citi-tiles'
const R2_PUBLIC_BASE = 'https://pub-1e4794524da64a1aa8c1dc2c9e85cc47.r2.dev'
// Be polite to the public Overpass endpoint — one query at a time with a
// pause between. The public mirror is shared with many users.
const DELAY_BETWEEN_QUERIES_MS = 5_000
const SIMPLIFY_TOLERANCE_DEG = 0.0002 // ≈22m at NYC latitude
const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url))

type Slug = 'cafe' | 'food' | 'bars' | 'parks'

interface CategorySpec {
  slug: Slug
  query: string
  // OSM tag keys to retain in the stripped output. Everything else is dropped.
  // The OSM id is preserved on the GeoJSON Feature's top-level `id` field
  // separately (GeoJSON convention), not in properties.
  keepTags: readonly string[]
  simplifyGeometry: boolean
}

function pointQuery(selectors: readonly string[]): string {
  const lines: string[] = []
  for (const sel of selectors) {
    for (const t of ['node', 'way', 'relation']) {
      lines.push(`  ${t}${sel}(${BBOX});`)
    }
  }
  // out center collapses way/relation to a single centroid point.
  return `[out:json][timeout:120];\n(\n${lines.join('\n')}\n);\nout center;\n`
}

function polygonQuery(selector: string): string {
  // out geom emits the full coordinate array inline for ways, plus per-member
  // geometry for relations — needed for osmtogeojson to assemble multipolygons.
  return [
    '[out:json][timeout:120];',
    '(',
    `  way${selector}(${BBOX});`,
    `  relation${selector}(${BBOX});`,
    ');',
    'out geom;',
    '',
  ].join('\n')
}

const CATEGORIES: readonly CategorySpec[] = [
  {
    slug: 'cafe',
    query: pointQuery(['[amenity=cafe]']),
    keepTags: ['name'],
    simplifyGeometry: false,
  },
  {
    slug: 'food',
    // amenity is kept so the frontend can split restaurant vs fast_food
    // (e.g. for a sub-filter). cuisine + brand may help with labels.
    query: pointQuery(['[amenity=restaurant]', '[amenity=fast_food]']),
    keepTags: ['name', 'amenity', 'cuisine', 'brand'],
    simplifyGeometry: false,
  },
  {
    slug: 'bars',
    query: pointQuery(['[amenity=bar]', '[amenity=pub]']),
    keepTags: ['name', 'amenity'],
    simplifyGeometry: false,
  },
  {
    slug: 'parks',
    query: polygonQuery('[leisure=park]'),
    keepTags: ['name'],
    simplifyGeometry: true,
  },
]

async function runOverpass(query: string): Promise<unknown> {
  const start = Date.now()
  const body = new URLSearchParams({ data: query }).toString()
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Overpass returned ${res.status}: ${text.slice(0, 300)}\n(If rate-limited, retry later or use a mirror like https://overpass.kumi.systems/api/interpreter)`,
    )
  }
  const json = await res.json()
  console.log(`  → response in ${((Date.now() - start) / 1000).toFixed(1)}s`)
  return json
}

function stripProperties(fc: FeatureCollection, keepTags: readonly string[]): FeatureCollection {
  const features: Feature[] = []
  for (const f of fc.features) {
    const props: Record<string, unknown> = {}
    const src = f.properties ?? {}
    for (const key of keepTags) {
      const v = (src as Record<string, unknown>)[key]
      if (v !== undefined && v !== null && v !== '') props[key] = v
    }
    features.push({
      type: 'Feature',
      id: f.id, // GeoJSON convention: stable identifier at top-level (osmtogeojson sets it to e.g. "node/12345")
      geometry: f.geometry,
      properties: props,
    })
  }
  return { type: 'FeatureCollection', features }
}

function countVertices(g: Geometry | null): number {
  if (!g) return 0
  switch (g.type) {
    case 'Point':
      return 1
    case 'MultiPoint':
    case 'LineString':
      return g.coordinates.length
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates.flat().length
    case 'MultiPolygon':
      return g.coordinates.flat(2).length
    case 'GeometryCollection':
      return g.geometries.reduce((a, b) => a + countVertices(b), 0)
  }
}

function totalVertices(fc: FeatureCollection): number {
  let n = 0
  for (const f of fc.features) n += countVertices(f.geometry)
  return n
}

async function processCategory(spec: CategorySpec): Promise<{ rawKB: number; gzKB: number; features: number; url: string }> {
  console.log(`\n[${spec.slug}]  fetching from Overpass…`)
  const raw = await runOverpass(spec.query)

  console.log(`  → converting to GeoJSON…`)
  // osmtogeojson is loosely-typed; cast both sides for the boundary.
  const fc = osmtogeojson(raw as never) as FeatureCollection
  console.log(`  → ${fc.features.length} features`)

  let stripped = stripProperties(fc, spec.keepTags)

  if (spec.simplifyGeometry) {
    const before = totalVertices(stripped)
    // highQuality:true uses pure Douglas–Peucker (slower, more faithful). For
    // ~3,000 polygons it takes a couple of seconds — fine for a one-shot run.
    stripped = simplify(stripped as never, {
      tolerance: SIMPLIFY_TOLERANCE_DEG,
      highQuality: true,
    }) as FeatureCollection
    const after = totalVertices(stripped)
    console.log(
      `  → simplified polygons: ${before} → ${after} vertices (${Math.round(100 * (1 - after / before))}% reduction)`,
    )
  }

  const json = JSON.stringify(stripped)
  const outPath = join(DATA_DIR, `nyc-${spec.slug}.geojson`)
  writeFileSync(outPath, json)
  const rawKB = json.length / 1024
  const gzKB = gzipSync(json).length / 1024
  console.log(`  → wrote ${outPath}`)
  console.log(`  → size: ${rawKB.toFixed(0)} KB raw / ${gzKB.toFixed(0)} KB gzipped`)

  console.log(`  → uploading to R2 (${R2_BUCKET})…`)
  execFileSync(
    'npx',
    [
      'wrangler',
      'r2',
      'object',
      'put',
      `${R2_BUCKET}/nyc-${spec.slug}.geojson`,
      `--file=${outPath}`,
      '--content-type=application/geo+json',
      '--remote',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )

  const url = `${R2_PUBLIC_BASE}/nyc-${spec.slug}.geojson`
  console.log(`  → ✓ ${url}`)
  return { rawKB, gzKB, features: stripped.features.length, url }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true })
  const summary: Array<{ slug: Slug; rawKB: number; gzKB: number; features: number; url: string }> = []
  for (let i = 0; i < CATEGORIES.length; i++) {
    if (i > 0) {
      console.log(`\n(sleeping ${DELAY_BETWEEN_QUERIES_MS / 1000}s before next query — be polite to the public endpoint)`)
      await delay(DELAY_BETWEEN_QUERIES_MS)
    }
    const c = CATEGORIES[i]
    const r = await processCategory(c)
    summary.push({ slug: c.slug, ...r })
  }
  console.log('\n=== Summary ===')
  for (const s of summary) {
    console.log(
      `${s.slug.padEnd(7)} ${String(s.features).padStart(6)} features  ${s.rawKB.toFixed(0).padStart(5)} KB raw  ${s.gzKB.toFixed(0).padStart(5)} KB gzip  ${s.url}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
