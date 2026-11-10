export type AgentStatus = 'running' | 'done' | 'failed' | 'denied' | 'untracked'

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

export type EnvInfo = {
  /** Last path segment of the session's working directory. */
  folder?: string
  /** Branch name, or a short hash when detached. Absent outside a git repo. */
  branch?: string
  dirty: boolean
  /** Friendly model name of the main loop. */
  model?: string
  /** When git last ran, in clock milliseconds. 0 before the first run. */
  gitAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-monitor': {
      agents: Shaped<AgentRow[]>
      usage: Shaped<UsageSnapshot | null>
      now: number
      env: Shaped<EnvInfo | null>
    }
  }
}
