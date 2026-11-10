export type CoachHint = { percent: number; tokens?: number }

export type CoachState = {
  /** Prompts submitted in the main loop, slash commands excluded. */
  prompts: number
  /** When the last main-loop turn ended, in clock milliseconds. */
  lastTurnEndAt: number | null
  /** Context percent at the last hint; null before the first. */
  hintedAtPercent: number | null
  /** The hint the band shows, or null. */
  hint: CoachHint | null
  /** Fresh agent spawns this session. */
  agentTotal: number
  /** Fresh workflow agent spawns per run id. */
  runs: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'session-coach': { coach: CoachState }
  }
}
