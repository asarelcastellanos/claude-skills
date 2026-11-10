export type AgentStatus = 'running' | 'done' | 'failed' | 'denied'

export type AgentRow = {
  /** Unique row key. Starts as the spawn's tool_use_id plus a counter, then stays. */
  key: string
  /** The engine's agent id, once the spawn resolved. */
  id?: string
  description: string
  type: string
  /** Resolved model id or alias. */
  model?: string
  /** Workflow agent index, when a workflow script started the agent. */
  workflowIndex?: number
  status: AgentStatus
  startedAt: number
  endedAt?: number
  tools: number
  lastTool?: string
  tokens: number
}

export type UsageSnapshot = {
  startedAt: number
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  limits: { kind: string; percent: number; resetsAt?: number }[]
  costUsd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-monitor': {
      agents: Shaped<AgentRow[]>
      usage: Shaped<UsageSnapshot | null>
      now: number
    }
  }
}
