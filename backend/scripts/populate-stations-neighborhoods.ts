// One-time-ish script: fetches GBFS station_information, maps each station to
// its NYC NTA via point-in-polygon, and INSERT-OR-REPLACES into D1's
// stations_neighborhoods table along with the station's capacity.
//
// Runs as a local Node script (not in the Worker). Writes to the remote D1
// database by shelling out to `wrangler d1 execute --remote --file=…`.
// Pre-req: `wrangler login` already run (Session 1).
//
// Usage:  npm run setup:stations

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'

const STATION_INFO_URL = 'https://gbfs.citibikenyc.com/gbfs/en/station_information.json'
const DB_NAME = 'where-in-the-citi-data'
const GEOJSON_PATH = fileURLToPath(new URL('../data/nyc-neighborhoods.geojson', import.meta.url))
const BATCH_SIZE = 200 // SQL statements per shell-out (avoid command-line length limits)

interface RawStationInfo {
  station_id: string
  lat: number
  lon: number
  capacity?: number
}

interface NeighborhoodProps {
  nta2020: string
  ntaname: string
}

interface StationInfoFeed {
  data: { stations: RawStationInfo[] }
}

function escape(s: string): string {
  return s.replace(/'/g, "''")
}

async function main(): Promise<void> {
  console.log(`fetching ${STATION_INFO_URL}…`)
  const res = await fetch(STATION_INFO_URL)
  if (!res.ok) throw new Error(`GBFS fetch failed: ${res.status}`)
  const feed = (await res.json()) as StationInfoFeed
  const stations = feed.data.stations
  console.log(`got ${stations.length} stations`)

  console.log(`reading ${GEOJSON_PATH}…`)
  const geo = JSON.parse(readFileSync(GEOJSON_PATH, 'utf8')) as FeatureCollection<
    Polygon | MultiPolygon,
    NeighborhoodProps
  >
  console.log(`got ${geo.features.length} neighborhood features`)

  const mapped: Array<{ station_id: string; neighborhood_id: string; capacity: number }> = []
  let unmatched = 0
  for (const s of stations) {
    const pt = point([s.lon, s.lat])
    let match: Feature<Polygon | MultiPolygon, NeighborhoodProps> | null = null
    for (const f of geo.features) {
      if (booleanPointInPolygon(pt, f)) {
        match = f
        break
      }
    }
    if (!match) {
      unmatched++
      continue
    }
    mapped.push({
      station_id: s.station_id,
      neighborhood_id: match.properties.nta2020,
      capacity: s.capacity ?? 0,
    })
  }
  console.log(`mapped ${mapped.length}; unmatched ${unmatched}`)
  if (mapped.length === 0) throw new Error('no stations mapped — refusing to clobber')

  // Batch the INSERTs into multiple SQL files; each fed to wrangler d1 execute.
  const tmp = mkdtempSync(join(tmpdir(), 'witc-stations-'))
  let totalApplied = 0
  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const slice = mapped.slice(i, i + BATCH_SIZE)
    const lines = slice.map(
      (m) =>
        `INSERT OR REPLACE INTO stations_neighborhoods (station_id, neighborhood_id, capacity) VALUES ('${escape(m.station_id)}', '${escape(m.neighborhood_id)}', ${Math.floor(m.capacity)});`,
    )
    const file = join(tmp, `batch-${i}.sql`)
    writeFileSync(file, lines.join('\n'))
    execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', `--file=${file}`], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    totalApplied += slice.length
    console.log(`applied ${totalApplied}/${mapped.length}`)
  }
  rmSync(tmp, { recursive: true, force: true })
  console.log(`done — ${totalApplied} rows upserted`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
