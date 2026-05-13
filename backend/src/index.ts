import { runAggregation } from './aggregation'
import { getComparison, parseBaseline } from './api/comparison'
import { errorResponse, jsonResponse, preflight } from './api/cors'
import { getCurrent } from './api/current'
import { insertSnapshots, runRetentionCleanup } from './db'
import { fetchSnapshotRows } from './gbfs'

const POLL_CRON = '* * * * *'
const AGGREGATE_CRON = '*/15 * * * *'
const CLEANUP_CRON = '0 3 * * *'

interface Env {
  DB: D1Database
}

async function pollAndWrite(env: Env): Promise<void> {
  const capturedAt = Math.floor(Date.now() / 1000)
  const rows = await fetchSnapshotRows(capturedAt)
  const written = await insertSnapshots(env.DB, rows)
  console.log(`poll ok captured_at=${capturedAt} stations=${rows.length} written=${written}`)
}

async function runCleanup(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const r = await runRetentionCleanup(env.DB, now)
  console.log(
    `cleanup ok now=${now} raw_deleted=${r.rawSnapshotsDeleted} station_buckets_deleted=${r.stationBucketsDeleted} neighborhood_buckets_deleted=${r.neighborhoodBucketsDeleted}`,
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return preflight()
    if (request.method !== 'GET') return errorResponse('Method Not Allowed', 405)

    const url = new URL(request.url)
    try {
      switch (url.pathname) {
        case '/current':
          return jsonResponse(await getCurrent(env.DB))
        case '/comparison': {
          const baseline = parseBaseline(url.searchParams.get('baseline'))
          if (!baseline) {
            return errorResponse(
              'baseline query param required (yesterday|lastweek)',
              400,
            )
          }
          const result = await getComparison(env.DB, baseline)
          if (!result) return errorResponse('no completed buckets yet', 503)
          return jsonResponse(result)
        }
        case '/':
          return jsonResponse({
            ok: true,
            endpoints: ['/current', '/comparison?baseline=yesterday|lastweek'],
          })
        default:
          return errorResponse('Not Found', 404)
      }
    } catch (err) {
      console.error('fetch handler error', err)
      return errorResponse(err instanceof Error ? err.message : String(err), 500)
    }
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    // The poll cron `* * * * *` matches every minute, INCLUDING the :00 / :15 /
    // :30 / :45 minutes when the aggregate cron also fires. Cloudflare delivers
    // both crons on those tick boundaries — handle each in its own branch and
    // don't `else` between POLL_CRON and AGGREGATE_CRON.
    if (controller.cron === POLL_CRON) {
      await pollAndWrite(env)
    } else if (controller.cron === AGGREGATE_CRON) {
      await runAggregation(env.DB, Math.floor(Date.now() / 1000))
    } else if (controller.cron === CLEANUP_CRON) {
      await runCleanup(env)
    } else {
      console.warn(`unknown cron: ${controller.cron}`)
    }
  },
} satisfies ExportedHandler<Env>
