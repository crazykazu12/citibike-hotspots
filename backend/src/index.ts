import { fetchSnapshotRows } from './gbfs'
import { deleteOlderThan, insertSnapshots } from './db'

const POLL_CRON = '* * * * *'
const CLEANUP_CRON = '0 3 * * *'
const RETENTION_SECONDS = 24 * 3600

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
  const cutoff = Math.floor(Date.now() / 1000) - RETENTION_SECONDS
  const deleted = await deleteOlderThan(env.DB, cutoff)
  console.log(`cleanup ok cutoff=${cutoff} deleted=${deleted}`)
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === POLL_CRON) {
      await pollAndWrite(env)
    } else if (controller.cron === CLEANUP_CRON) {
      await runCleanup(env)
    } else {
      console.warn(`unknown cron: ${controller.cron}`)
    }
  },
} satisfies ExportedHandler<Env>
