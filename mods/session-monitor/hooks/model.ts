import type { AgentRow, EnvInfo, UsageSnapshot } from '../types'

/** Rows kept in state. Running rows are never dropped. */
export const MAX_KEPT = 30

export type Severity = 'ok' | 'warn' | 'crit'

export type Spawned = {
  key: string
  description: string
  type: string
  model?: string
  workflowIndex?: number
  now: number
}

export const spawned = (rows: AgentRow[], s: Spawned): AgentRow[] =>
  trim([
    ...rows,
    {
      key: s.key,
      description: s.description,
      type: s.type,
      model: s.model,
      workflowIndex: s.workflowIndex,
      status: 'running',
      startedAt: s.now,
      tools: 0,
      tokens: 0,
    },
  ])

const placeholder = (id: string, now: number): AgentRow => ({
  key: `id:${id}`,
  id,
  description: 'agent',
  type: 'agent',
  status: 'running',
  startedAt: now,
  tools: 0,
  tokens: 0,
})

/** Change the row for an agent id, creating a stand-in when events beat the spawn result. */
const touch = (
  rows: AgentRow[],
  id: string,
  now: number,
  fn: (row: AgentRow) => AgentRow,
): AgentRow[] =>
  rows.some(r => r.id === id)
    ? rows.map(r => (r.id === id ? fn(r) : r))
    : [...rows, fn(placeholder(id, now))]

/** The spawn resolved: attach the agent id and the resolved model to the pending row. */
export const resolved = (
  rows: AgentRow[],
  key: string,
  agentId: string | undefined,
  model: string | undefined,
  now = 0,
): AgentRow[] => {
  // No agent id: no turn.complete can ever match, so the row cannot stay running.
  if (agentId === undefined) {
    return rows.map(r =>
      r.key === key
        ? { ...r, model: model ?? r.model, status: 'untracked', endedAt: now }
        : r,
    )
  }
  const early = rows.find(r => r.id === agentId && r.key !== key)
  return rows
    .filter(r => r !== early)
    .map(r => {
      if (r.key !== key) return r
      const base = { ...r, id: agentId, model: model ?? r.model }
      if (early === undefined) return base
      return {
        ...base,
        tools: base.tools + early.tools,
        tokens: base.tokens + early.tokens,
        lastTool: early.lastTool ?? base.lastTool,
        status: early.status,
        endedAt: early.endedAt,
      }
    })
}

/** A resumed agent runs again: keep its counters and start time, drop the end. */
export const resumed = (
  rows: AgentRow[],
  id: string,
  s: Omit<Spawned, 'key'>,
): AgentRow[] =>
  rows.some(r => r.id === id)
    ? rows.map(r =>
        r.id === id
          ? { ...r, status: 'running', endedAt: undefined, lastTool: undefined }
          : r,
      )
    : trim([
        ...rows,
        { ...placeholder(id, s.now), ...stripKey(s), status: 'running' },
      ])

const stripKey = (s: Omit<Spawned, 'key'>) => ({
  description: s.description,
  type: s.type,
  model: s.model,
  workflowIndex: s.workflowIndex,
})

export const denied = (rows: AgentRow[], key: string, now: number): AgentRow[] =>
  rows.map(r =>
    r.key === key ? { ...r, status: 'denied', endedAt: now } : r,
  )

export const toolCalled = (
  rows: AgentRow[],
  id: string,
  tool: string,
  now: number,
): AgentRow[] =>
  touch(rows, id, now, r => ({ ...r, tools: r.tools + 1, lastTool: tool }))

export const completed = (
  rows: AgentRow[],
  id: string,
  reason: 'answer' | 'aborted' | 'refusal' | 'error',
  tokens: number,
  now: number,
): AgentRow[] =>
  trim(
    touch(rows, id, now, r => ({
      ...r,
      status: reason === 'answer' ? 'done' : 'failed',
      endedAt: now,
      tokens: r.tokens + tokens,
      lastTool: undefined,
    })),
  )

export const hasRunning = (rows: readonly AgentRow[]): boolean =>
  rows.some(r => r.status === 'running')

/** Running rows first (newest start first), then finished rows (newest end first). */
export const order = (rows: readonly AgentRow[]): AgentRow[] =>
  [...rows].sort((a, b) => {
    const ar = a.status === 'running'
    const br = b.status === 'running'
    if (ar !== br) return ar ? -1 : 1
    if (ar) return b.startedAt - a.startedAt
    return (b.endedAt ?? 0) - (a.endedAt ?? 0)
  })

/** Keep every running row and the newest finished rows, up to MAX_KEPT in all. */
export const trim = (rows: AgentRow[], max = MAX_KEPT): AgentRow[] => {
  if (rows.length <= max) return rows
  const running = rows.filter(r => r.status === 'running').length
  const room = Math.max(0, max - running)
  const keep = new Set(
    rows
      .filter(r => r.status !== 'running')
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .slice(0, room),
  )
  return rows.filter(r => r.status === 'running' || keep.has(r))
}

/** The rows that fit `lines` terminal lines at `perRow` lines each, in display order. */
export const visible = (
  rows: readonly AgentRow[],
  lines: number,
  perRow: number,
): { shown: AgentRow[]; hidden: number } => {
  const ordered = order(rows)
  const count = Math.max(0, Math.min(ordered.length, Math.floor(lines / perRow)))
  return { shown: ordered.slice(0, count), hidden: ordered.length - count }
}

export const family = (model: string | undefined): string => {
  if (model === undefined) return '?'
  const m = model.toLowerCase()
  for (const f of ['opus', 'sonnet', 'haiku', 'fable']) if (m.includes(f)) return f
  return m.length > 10 ? m.slice(0, 10) : m
}

export const formatDuration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

/** Time until a reset, coarse: "2h 14m", "5m", "3d 4h". */
export const formatReset = (resetsAt: number | undefined, now: number): string => {
  if (resetsAt === undefined) return ''
  const mins = Math.max(0, Math.ceil((resetsAt - now) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ${String(mins % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export const formatTokens = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const k = Math.round(n / 100) / 10
    return k >= 1000 ? '1.0M' : `${k.toFixed(1)}k`
  }
  return `${(Math.round(n / 100_000) / 10).toFixed(1)}M`
}

export const bar = (percent: number, width: number): string => {
  const w = Math.max(0, Math.floor(width))
  const clamped = Math.min(100, Math.max(0, percent))
  const filled = Math.round((clamped / 100) * w)
  return '#'.repeat(filled) + '-'.repeat(w - filled)
}

export const severity = (percent: number | undefined): Severity =>
  percent === undefined ? 'ok' : percent >= 90 ? 'crit' : percent >= 70 ? 'warn' : 'ok'

export const truncate = (text: string, width: number): string =>
  width <= 0
    ? ''
    : text.length <= width
      ? text
      : width === 1
        ? text.slice(0, 1)
        : `${text.slice(0, width - 1)}~`

export const limitLabel = (kind: string): string =>
  kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind.replace(/_/g, ' ')

const pct = (n: number): string => `${Math.round(n)}%`

export type GitInfo = { branch: string; dirty: boolean }

/** Minimum gap between two git runs, in milliseconds. */
export const GIT_MIN_GAP_MS = 5000

/**
 * Parse `git status --porcelain=v2 --branch`. Returns undefined when git failed
 * (not a repository) or printed no branch header.
 */
export const parseGitStatus = (
  exitCode: number,
  stdout: string,
): GitInfo | undefined => {
  if (exitCode !== 0) return undefined
  let head: string | undefined
  let oid: string | undefined
  let dirty = false
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice(14).trim()
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim()
    else if (/^[12u?] /.test(line)) dirty = true
  }
  if (head === undefined || head === '') return undefined
  if (head === '(detached)') {
    const hash = oid === undefined || oid === '(initial)' ? '' : oid.slice(0, 7)
    return hash === '' ? undefined : { branch: hash, dirty }
  }
  return { branch: head, dirty }
}

const MODEL_NAMES: Record<string, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
}

const titleCase = (s: string): string => `${s.slice(0, 1).toUpperCase()}${s.slice(1)}`

/** claude-opus-5-5 becomes "Opus 5.5". Unknown ids pass through. */
export const friendlyModel = (id: string): string => {
  const clean = id.replace(/\[[^\]]*\]$/, '').trim()
  const lower = clean.toLowerCase()
  const fam = /(opus|sonnet|haiku|fable)/.exec(lower)?.[1]
  if (fam === undefined) return id
  const name = MODEL_NAMES[fam] ?? titleCase(fam)
  // claude-opus-5-5, claude-opus-4-20250514, claude-opus-4
  const after = new RegExp(`${fam}-(\\d+)(?:-(\\d{1,2}))?(?!\\d)`).exec(lower)
  // claude-3-5-haiku-20241022
  const before = new RegExp(`claude-(\\d+)(?:-(\\d+))?-${fam}`).exec(lower)
  const m = before ?? after
  if (m === null) return name
  return m[2] === undefined ? `${name} ${m[1]}` : `${name} ${m[1]}.${m[2]}`
}

/** `<folder> · <branch><*> · <model>`, leaving out what is unknown. */
export const envLine = (env: EnvInfo | null | undefined): string => {
  if (env === null || env === undefined) return ''
  const parts: string[] = []
  if (env.folder) parts.push(env.folder)
  if (env.branch) parts.push(`${env.branch}${env.dirty ? '*' : ''}`)
  if (env.model) parts.push(env.model)
  return parts.join(' \u00b7 ')
}

/** The compact line for `$.ui.status`. */
export const statusLine = (u: UsageSnapshot, env?: EnvInfo | null): string => {
  const parts: string[] = []
  const head = envLine(env)
  if (head !== '') parts.push(head)
  for (const l of u.limits) parts.push(`${limitLabel(l.kind)} ${pct(l.percent)}`)
  if (u.contextPercent !== undefined) parts.push(`ctx ${pct(u.contextPercent)}`)
  return parts.join(' \u00b7 ')
}

export const symbol = (s: AgentRow['status']): string =>
  s === 'running'
    ? '>'
    : s === 'done'
      ? '+'
      : s === 'failed'
        ? 'x'
        : s === 'untracked'
          ? '?'
          : '!'

export const statusWord = (s: AgentRow['status']): string => s
