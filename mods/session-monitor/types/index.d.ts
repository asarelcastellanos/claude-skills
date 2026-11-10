export type AgentStatus = 'running' | 'done' | 'failed' | 'denied' | 'untracked'

/** A path and how many tool calls touched it. */
export type PathCount = [path: string, count: number]

/** What one agent, or the main session, has done with its tools. */
export type Activity = {
  tools: number
  lastTool?: string
  /** The last few tool names, oldest first. */
  recent: string[]
  /** Files edited, relative to the session folder when inside it. */
  edits: PathCount[]
  /** Files read, and folders searched (a path ending in a slash). */
  reads: PathCount[]
  /** Tool calls on paths past the cap on distinct paths. */
  morePaths: number
}

export type AgentRow = Activity & {
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
  /** The session's working directory. */
  cwd?: string
  /** True when the working directory belongs to a linked git worktree. */
  isWorktree: boolean
  /** Friendly model name of the main loop. */
  model?: string
  /** When git last ran, in clock milliseconds. 0 before the first run. */
  gitAt: number
}

/**
 * The two session values of the model-policy mod that the Policy section reads.
 * The declaration is local on purpose: listing model-policy under `dependencies`
 * would make this mod need it, and the pane works without it. The full contract
 * is mods/model-policy/types/index.d.ts.
 */
declare module 'claude-code' {
  interface PluginState {
    'session-monitor': {
      agents: Shaped<AgentRow[]>
      usage: Shaped<UsageSnapshot | null>
      now: number
      env: Shaped<EnvInfo | null>
      /** The main session's tool activity. */
      main: Shaped<Activity>
      /** Keys of the rows the person expanded: agent row keys, `main` and `header`. */
      open: string[]
    }
    'model-policy': {
      /** False after `/model-policy off`. Unset means on. */
      enabled: boolean
      /** Per model family: input + output tokens, and cache read + creation tokens. */
      usage: Record<string, { tokens: number; cache: number }>
    }
  }
}
