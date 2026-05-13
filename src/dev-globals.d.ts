// Dev-only globals exposed by useStationActivity for fixture capture.
// Gated behind `import.meta.env.DEV`, so production builds tree-shake them.

declare global {
  interface Window {
    __downloadFixtures?: () => Promise<void>
  }
}

export {}
