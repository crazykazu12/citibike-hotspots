// Dev-only globals exposed by useStationActivity for fixture capture.
// All writes are gated behind `import.meta.env.DEV`, so production builds tree-shake them.
import type { Station } from './types'

export interface DumpedFixtures {
  snapshots: Record<string, number>[]
  stations: Station[]
}

declare global {
  interface Window {
    __snapshots?: Map<string, number>[]
    __stations?: Station[]
    __dumpFixtures?: () => DumpedFixtures
    __downloadFixtures?: () => void
  }
}
