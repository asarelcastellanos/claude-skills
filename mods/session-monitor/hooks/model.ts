import type { AgentRow, AgentStatus, EnvInfo } from '../types'

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

/** Display name of a model family: "opus" becomes "Opus". */
export const familyName = (model: string | undefined): string => {
  const f = family(model)
  return `${f.slice(0, 1).toUpperCase()}${f.slice(1)}`
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

const HOUR_MS = 3_600_000

/** Length of each rate-limit window, by the `kind` the session reports. */
export const WINDOW_MS: Record<string, number> = {
  five_hour: 5 * HOUR_MS,
  seven_day: 7 * 24 * HOUR_MS,
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Local time as `Thu 14:30` (hour unpadded, 24 hour clock). */
export const formatWeekdayTime = (ms: number): string => {
  const d = new Date(ms)
  return `${WEEKDAYS[d.getDay()] ?? ''} ${formatClock(ms)}`
}

/** Local time as `14:30`. */
export const formatClock = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

const sameDay = (a: number, b: number): boolean => {
  const x = new Date(a)
  const y = new Date(b)
  return (
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  )
}

/** The text after "resets": a weekday and time for the 7 day window, a countdown for the others. */
export const resetText = (kind: string, resetsAt: number | undefined, now: number): string =>
  resetsAt === undefined
    ? ''
    : kind === 'seven_day'
      ? formatWeekdayTime(resetsAt)
      : formatReset(resetsAt, now)

/** The least percent used before a limit gets a projection row. */
export const PROJECT_MIN_PERCENT = 5

export type Projection = { text: string; color: string | undefined }

/**
 * Where a limit is heading at the pace so far. Undefined when there is nothing
 * to say: under PROJECT_MIN_PERCENT, an unknown reset, or no time elapsed.
 * A `color` of undefined means dim.
 */
export const projectLimit = (
  l: { kind: string; percent: number; resetsAt?: number },
  now: number,
): Projection | undefined => {
  if (l.percent >= 100) return { text: 'limit reached', color: CRIT_RED }
  const window = WINDOW_MS[l.kind]
  if (window === undefined || l.resetsAt === undefined || l.percent < PROJECT_MIN_PERCENT) {
    return undefined
  }
  const elapsed = window - (l.resetsAt - now)
  if (elapsed <= 0) return undefined
  const hitAt = now + ((100 - l.percent) / l.percent) * elapsed
  if (hitAt >= l.resetsAt) return { text: 'on pace, resets first', color: undefined }
  const when =
    l.kind === 'five_hour' && sameDay(hitAt, now) ? formatClock(hitAt) : formatWeekdayTime(hitAt)
  // A 5 hour window always fills within 5 hours, so "soon" only means something for the longer one.
  const soon = window > 5 * HOUR_MS && hitAt - now < 5 * HOUR_MS
  const long = window <= 5 * HOUR_MS || l.resetsAt - hitAt > 24 * HOUR_MS
  const color = soon ? CRIT_RED : long ? WARN_AMBER : CLAUDE_ORANGE
  return { text: `at this pace, full ${when}`, color }
}

const trimZero = (n: number): string => n.toFixed(1).replace(/\.0$/, '')

export const formatTokens = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const k = Math.round(n / 100) / 10
    return k >= 1000 ? '1M' : `${trimZero(k)}k`
  }
  return `${trimZero(Math.round(n / 100_000) / 10)}M`
}

/** Terminal rows one agent takes: the description and the two meta rows. */
export const AGENT_ROWS = 3

/** Spaces the pane puts before each meta row. */
export const META_INDENT = 4

/** `model-policy:reviewer` becomes `reviewer`. A type with nothing after the colon stays as it is. */
export const typeName = (type: string): string => {
  const name = type.slice(type.lastIndexOf(':') + 1)
  return name === '' ? type : name
}

/**
 * `mcp__plugin-authoring__scan_secrets` becomes `scan_secrets`. Other tools keep their name.
 * An MCP name with nothing after its last `__` has no name to show.
 */
export const toolName = (tool: string): string | undefined => {
  if (!tool.startsWith('mcp__')) return tool
  const name = tool.slice(tool.lastIndexOf('__') + 2)
  return name === '' ? undefined : name
}

/**
 * The narrowest body, in columns, the pane lays out for. At this width an agent's
 * two meta rows still show the model, duration, tool count and token count whole
 * (4 spaces, a 1 character type, `Sonnet`, `1m 04s`, `12 tools`, `18k tok`).
 * Below it the pane draws as if it were this wide and the host may cut the rows.
 */
export const MIN_COLS = 23

const SEP = ' \u00b7 '

/**
 * The two meta rows of an agent for a pane `cols` wide:
 * `coder \u00b7 Sonnet \u00b7 1m 04s`, then `12 tools \u00b7 18k tok \u00b7 Edit`.
 * The last tool shows only while the agent runs. Only the type and the last tool
 * shorten to fit, so the model, duration, tool count and tokens always show.
 */
export const agentMeta = (r: AgentRow, now: number, cols: number): [string, string] => {
  const width = Math.max(0, cols - META_INDENT)
  const rest = [familyName(r.model), formatDuration(Math.max(0, (r.endedAt ?? now) - r.startedAt))]
  const type = truncate(typeName(r.type), Math.max(1, width - [''].concat(rest).join(SEP).length))
  const stats = [r.tools === 1 ? '1 tool' : `${r.tools} tools`, `${formatTokens(r.tokens)} tok`]
  const tool = r.status === 'running' && r.lastTool ? toolName(r.lastTool) : undefined
  const room = width - stats.join(SEP).length - SEP.length
  return [
    [type, ...rest].join(SEP),
    (tool !== undefined && room > 0 ? [...stats, truncate(tool, room)] : stats).join(SEP),
  ]
}

export type Bar = { filled: string; empty: string }

/** A bar of `width` cells, split into the filled and the empty part so each takes its own color. */
export const bar = (percent: number, width: number): Bar => {
  const w = Math.max(0, Math.floor(width))
  const clamped = Math.min(100, Math.max(0, percent))
  const filled = Math.round((clamped / 100) * w)
  return { filled: '\u25b0'.repeat(filled), empty: '\u25b1'.repeat(w - filled) }
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

/** `<folder> \u00b7 <branch><*>`, leaving out what is unknown. */
export const locationLine = (env: EnvInfo | null | undefined): string => {
  if (env === null || env === undefined) return ''
  const parts: string[] = []
  if (env.folder) parts.push(env.folder)
  if (env.branch) parts.push(`${env.branch}${env.dirty ? '*' : ''}`)
  return parts.join(' \u00b7 ')
}

export const CLAUDE_ORANGE = '#D97757'
export const WARN_AMBER = '#E5A82E'
export const CRIT_RED = '#E5534B'
export const DONE_GREEN = '#6CC070'

export const severityColor = (s: Severity): string =>
  s === 'crit' ? CRIT_RED : s === 'warn' ? WARN_AMBER : CLAUDE_ORANGE

/** Undefined means the default text color, which the pane dims for an untracked row. */
export const STATUS_COLOR: Record<AgentStatus, string | undefined> = {
  running: CLAUDE_ORANGE,
  done: DONE_GREEN,
  failed: CRIT_RED,
  denied: WARN_AMBER,
  untracked: undefined,
}

/** The Claude spinner glyphs. A running agent shows one, picked by the 1 s tick. */
export const SPINNER = ['\u00b7', '\u2722', '\u2733', '\u2736', '\u273b', '\u273d'] as const
export const SPINNER_MS = 1000

export const spinnerFrame = (now: number): string =>
  SPINNER[Math.floor(Math.max(0, now) / SPINNER_MS) % SPINNER.length] ?? SPINNER[0]

export const symbol = (s: AgentStatus, now: number): string =>
  s === 'running'
    ? spinnerFrame(now)
    : s === 'done'
      ? '\u2713'
      : s === 'failed'
        ? '\u2717'
        : s === 'denied'
          ? '\u2298'
          : '\u25cb'

export const statusWord = (s: AgentRow['status']): string => s

/** The pixel crab beside the title. Each row is padded to CRAB_WIDTH when drawn. */
export const CRAB = [' ▐▛███▜▌', '▝▜█████▛▘', '  ▘▘ ▝▝'] as const
export const CRAB_WIDTH = 9
export const CRAB_GAP = 2
export const CRAB_MIN_COLS = 28

export type HeaderPlan = { kind: 'crab'; rows: number } | { kind: 'line'; rows: number }

/**
 * The crab header needs CRAB_MIN_COLS columns and room for the three crab rows,
 * every other fixed row and the one row under the agents ("none yet" or "+N more").
 * Otherwise the header is a title line and, when the
 * environment is known, a folder, branch and model line.
 */
export const headerPlan = (
  cols: number,
  height: number,
  otherRows: number,
  hasEnv: boolean,
): HeaderPlan =>
  cols >= CRAB_MIN_COLS && height >= CRAB.length + otherRows + 1
    ? { kind: 'crab', rows: CRAB.length }
    : { kind: 'line', rows: hasEnv ? 2 : 1 }

/** Rows the sections take besides the header and the agent rows: separators, titles and fixed lines. */
export const fixedRows = (usageRows: number, policyLineCount: number): number => {
  const sections = [
    2,
    2,
    1 + Math.max(1, usageRows),
    ...(policyLineCount > 0 ? [1 + policyLineCount] : []),
    1,
  ]
  // One blank row after the header, one between each pair of sections.
  return 1 + sections.reduce((a, b) => a + b, 0) + (sections.length - 1)
}

export type RuleParts = { lead: string; title: string; tail: string }

/** A section rule `\u2500\u2500 Title \u2500\u2500\u2500...` as three parts, so the title can take its own color. */
export const ruleParts = (title: string, width: number): RuleParts => {
  const lead = '\u2500\u2500 '
  const shown = truncate(title, Math.max(0, width - lead.length - 1))
  const left = Math.max(0, width - lead.length - shown.length)
  const tail = left === 0 ? '' : ` ${'\u2500'.repeat(left - 1)}`
  return { lead, title: shown, tail }
}

/** The rule as one string, exactly `width` characters. */
export const rule = (title: string, width: number): string => {
  const p = ruleParts(title, width)
  return `${p.lead}${p.title}${p.tail}`.slice(0, Math.max(0, width))
}

export type PolicyUsage = Record<string, { tokens: number; cache: number }>

const POLICY_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'other'] as const

/** `on` or `off`, then one `opus    123k` row per model family that has tokens. */
export const policyLines = (enabled: boolean, usage: PolicyUsage): string[] => [
  enabled ? 'on' : 'off',
  ...POLICY_FAMILIES.filter(f => (usage[f]?.tokens ?? 0) > 0).map(
    f => `${f.padEnd(7)} ${formatTokens(usage[f]?.tokens ?? 0)}`,
  ),
]
