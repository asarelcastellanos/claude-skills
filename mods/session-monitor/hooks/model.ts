import type { Activity, AgentRow, AgentStatus, EnvInfo, PathCount } from '../types'

/** Rows kept in state. Running rows are never dropped. */
export const MAX_KEPT = 30

export type Severity = 'ok' | 'warn' | 'crit'

/** Distinct paths kept per agent. Calls on more paths only add to `morePaths`. */
export const PATH_CAP = 50
/** Tool names kept for the `Recent:` line. */
export const RECENT_KEPT = 4

export const emptyActivity = (): Activity => ({
  tools: 0,
  recent: [],
  edits: [],
  reads: [],
  morePaths: 0,
})

/** The paths one tool call touched. `searched` holds folders (Glob and Grep). */
export type Touched = { edits: string[]; reads: string[]; searched: string[] }

const NOTHING: Touched = { edits: [], reads: [], searched: [] }

const some = (v: unknown): string[] => (typeof v === 'string' && v !== '' ? [v] : [])

/**
 * The paths a tool call names in its input. Only the file tools count: what a
 * shell command touches cannot be read from its text (see LESSONS.md).
 */
export const toolPaths = (input: object): Touched => {
  // A tool call's input is external data: each field is read as unknown and checked.
  const e = input as Readonly<Record<string, unknown>>
  switch (e.tool) {
    case 'Edit':
    case 'Write':
      return { ...NOTHING, edits: some(e.file_path) }
    case 'NotebookEdit':
      return { ...NOTHING, edits: some(e.notebook_path) }
    case 'Read':
      return { ...NOTHING, reads: some(e.file_path) }
    case 'Glob':
    case 'Grep':
      return { ...NOTHING, searched: some(e.path) }
    default:
      return NOTHING
  }
}

/** `/work/repo/src/a.ts` becomes `src/a.ts` inside `/work/repo`. Paths outside stay absolute. */
export const relativize = (path: string, cwd: string | undefined): string => {
  if (cwd === undefined) return path
  const base = cwd.replace(/[\\/]+$/, '')
  if (base === '') return path
  if (path === base) return '.'
  const sep = path.charAt(base.length)
  if (!path.startsWith(base) || (sep !== '/' && sep !== '\\')) return path
  // `/a/b/` inside `/a/b` is the folder itself.
  return path.slice(base.length + 1) || '.'
}

export const touchedIn = (t: Touched, cwd: string | undefined): Touched => ({
  edits: t.edits.map(p => relativize(p, cwd)),
  reads: t.reads.map(p => relativize(p, cwd)),
  searched: t.searched.map(p => relativize(p, cwd)),
})

type Paths = Pick<Activity, 'edits' | 'reads' | 'morePaths'>

/** Add `n` touches of `path`. A new path past PATH_CAP distinct paths only counts toward `morePaths`. */
const countPath = (acc: Paths, kind: 'edits' | 'reads', path: string, n: number): Paths => {
  const list = acc[kind]
  if (list.some(([p]) => p === path)) {
    return { ...acc, [kind]: list.map(([p, c]): PathCount => (p === path ? [p, c + n] : [p, c])) }
  }
  const known = new Set([...acc.edits, ...acc.reads].map(([p]) => p))
  if (!known.has(path) && known.size >= PATH_CAP) return { ...acc, morePaths: acc.morePaths + n }
  return { ...acc, [kind]: [...list, [path, n] as PathCount] }
}

const asFolder = (path: string): string => (path.endsWith('/') ? path : `${path}/`)

/** Record one tool call: the count, the last and recent tool names, and the paths. */
export const withTool = (a: Activity, tool: string, t: Touched): Activity => {
  let paths: Paths = { edits: a.edits, reads: a.reads, morePaths: a.morePaths }
  for (const p of t.edits) paths = countPath(paths, 'edits', p, 1)
  for (const p of t.reads) paths = countPath(paths, 'reads', p, 1)
  for (const p of t.searched) paths = countPath(paths, 'reads', asFolder(p), 1)
  return {
    tools: a.tools + 1,
    lastTool: tool,
    recent: [...a.recent, tool].slice(-RECENT_KEPT),
    ...paths,
  }
}

/** Fold the activity of `b` into `a`, as when a spawn result arrives after the agent's first events. */
export const mergeActivity = (a: Activity, b: Activity): Activity => {
  let paths: Paths = { edits: a.edits, reads: a.reads, morePaths: a.morePaths + b.morePaths }
  for (const [p, n] of b.edits) paths = countPath(paths, 'edits', p, n)
  for (const [p, n] of b.reads) paths = countPath(paths, 'reads', p, n)
  return {
    tools: a.tools + b.tools,
    lastTool: b.lastTool ?? a.lastTool,
    recent: [...a.recent, ...b.recent].slice(-RECENT_KEPT),
    ...paths,
  }
}

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
      tokens: 0,
      ...emptyActivity(),
    },
  ])

const placeholder = (id: string, now: number): AgentRow => ({
  key: `id:${id}`,
  id,
  description: 'agent',
  type: 'agent',
  status: 'running',
  startedAt: now,
  tokens: 0,
  ...emptyActivity(),
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
        ...mergeActivity(base, early),
        tokens: base.tokens + early.tokens,
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
  touched: Touched = NOTHING,
): AgentRow[] => touch(rows, id, now, r => ({ ...r, ...withTool(r, tool, touched) }))

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

/** `short` is the form for a narrow row. A `color` of undefined means dim. */
export type Projection = { text: string; short: string; color: string | undefined }

/**
 * Where a limit is heading at the pace so far. Undefined when there is nothing
 * to say: under PROJECT_MIN_PERCENT, an unknown reset, or no time elapsed.
 */
export const projectLimit = (
  l: { kind: string; percent: number; resetsAt?: number },
  now: number,
): Projection | undefined => {
  if (l.percent >= 100) return { text: 'limit reached', short: 'limit reached', color: CRIT_RED }
  const window = WINDOW_MS[l.kind]
  if (window === undefined || l.resetsAt === undefined || l.percent < PROJECT_MIN_PERCENT) {
    return undefined
  }
  const elapsed = window - (l.resetsAt - now)
  if (elapsed <= 0) return undefined
  const hitAt = now + ((100 - l.percent) / l.percent) * elapsed
  if (hitAt >= l.resetsAt) return { text: 'on pace, resets first', short: 'on pace', color: undefined }
  const when =
    l.kind === 'five_hour' && sameDay(hitAt, now) ? formatClock(hitAt) : formatWeekdayTime(hitAt)
  // A 5 hour window always fills within 5 hours, so "soon" only means something for the longer one.
  const soon = window > 5 * HOUR_MS && hitAt - now < 5 * HOUR_MS
  const long = window <= 5 * HOUR_MS || l.resetsAt - hitAt > 24 * HOUR_MS
  const color = soon ? CRIT_RED : long ? WARN_AMBER : CLAUDE_ORANGE
  return { text: `at this pace, full ${when}`, short: `full ${when}`, color }
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
  const duration = formatDuration(Math.max(0, (r.endedAt ?? now) - r.startedAt))
  // The duration stays whole. The model gives up room for a 1 character type, then the type takes the rest.
  const fixed = 2 * SEP.length + duration.length
  const model = truncate(familyName(r.model), Math.max(1, width - 1 - fixed))
  const type = truncate(typeName(r.type), Math.max(1, width - model.length - fixed))
  const tok = `${formatTokens(r.tokens)} tok`
  const count = formatTokens(r.tools)
  // From the plain form to the shortest: large counts compact, then `tools` becomes `tl`, then `tok` goes.
  const stats = [
    [r.tools === 1 ? '1 tool' : `${r.tools} tools`, tok],
    [`${count} tools`, tok],
    [`${count} tl`, tok],
    [`${count} tl`, formatTokens(r.tokens)],
  ].map(parts => parts.join(SEP))
  const fitted = stats.find(s => s.length <= width) ?? stats[stats.length - 1] ?? ''
  const tool = r.status === 'running' && r.lastTool ? toolName(r.lastTool) : undefined
  const room = width - fitted.length - SEP.length
  return [
    [type, model, duration].join(SEP),
    tool !== undefined && room > 0 ? `${fitted}${SEP}${truncate(tool, room)}` : fitted,
  ]
}

export const BAR_MAX = 10
export const BAR_MIN = 4
/** Columns of ` 41%` after a bar. */
export const PERCENT_COLS = 5

/**
 * The bar width and the text after the percent for a row `cols` wide. `tails` run from the
 * long form to the short one. The first form that leaves a bar of BAR_MIN cells wins, and the
 * bar takes up to BAR_MAX of what is left. When none does, the first form that fits with no bar.
 */
export const barLayout = (
  cols: number,
  leadLength: number,
  tails: readonly string[],
): { barWidth: number; tail: string } => {
  const room = (tail: string): number => cols - leadLength - PERCENT_COLS - tail.length
  const withBar = tails.find(t => room(t) >= BAR_MIN)
  if (withBar !== undefined) return { barWidth: Math.min(BAR_MAX, room(withBar)), tail: withBar }
  const bare = tails.find(t => room(t) >= 0) ?? tails[tails.length - 1] ?? ''
  return { barWidth: 0, tail: bare }
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

/**
 * Rows the sections take besides the header and the agent rows: separators, titles and fixed
 * lines. `extraRows` are rows the person opened under the header.
 */
export const fixedRows = (
  usageRows: number,
  policyLineCount: number,
  extraRows = 0,
): number => {
  const sections = [
    2,
    2,
    1 + Math.max(1, usageRows),
    ...(policyLineCount > 0 ? [1 + policyLineCount] : []),
    1,
  ]
  // One blank row after the header, one between each pair of sections.
  return 1 + sections.reduce((a, b) => a + b, 0) + (sections.length - 1) + extraRows
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

/** Keeps the end of a path: `\u2026/hooks/register.tsx`. */
export const truncateLeft = (text: string, width: number): string =>
  width <= 0
    ? ''
    : text.length <= width
      ? text
      : width === 1
        ? '\u2026'
        : `\u2026${text.slice(text.length - (width - 1))}`

export type FolderGroup = { folder: string; files: PathCount[] }

const splitPath = (path: string): { folder: string; name: string } => {
  if (path.endsWith('/')) return { folder: path.slice(0, -1) || '/', name: '' }
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (i < 0) return { folder: '.', name: path }
  return { folder: i === 0 ? '/' : path.slice(0, i), name: path.slice(i + 1) }
}

/** Paths grouped by folder, in the order each folder first appears. A searched folder has a file named ''. */
export const groupByFolder = (list: readonly PathCount[]): FolderGroup[] => {
  const groups: FolderGroup[] = []
  for (const [path, count] of list) {
    const { folder, name } = splitPath(path)
    let group = groups.find(g => g.folder === folder)
    if (group === undefined) {
      group = { folder, files: [] }
      groups.push(group)
    }
    group.files.push([name, count])
  }
  return groups
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/**
 * One line on what an agent edited: `edits mods/x/hooks (2 files)`, `edits 3 folders (5 files)`,
 * or `no edits`. Undefined before the agent's first tool call. `width` is the room for the line.
 */
export const editSummary = (a: Activity, width: number): string | undefined => {
  if (a.tools === 0) return undefined
  const groups = groupByFolder(a.edits)
  if (groups.length === 0) return 'no edits'
  const files = plural(a.edits.length, 'file', 'files')
  const only = groups[0]
  if (groups.length === 1 && only !== undefined) {
    const lead = 'edits '
    const tail = ` (${files})`
    return `${lead}${truncateLeft(only.folder, width - lead.length - tail.length)}${tail}`
  }
  const n = groups.length
  // The long form, then shorter ones, each tried against the room.
  const forms = [
    `edits ${n} folders (${files})`,
    `${n} folders, ${files}`,
    `${n} dirs, ${files}`,
  ]
  return forms.find(f => f.length <= width) ?? truncate(forms[forms.length - 1] ?? '', width)
}

/** The rows under an expanded row: edited files, read folders and recent tools. Indent 4. */
export const detailRows = (a: Activity, cols: number): string[] => {
  const rows: string[] = []
  const pathRow = (indent: number, text: string, tail = ''): string =>
    `${' '.repeat(indent)}${truncateLeft(text, cols - indent - tail.length)}${tail}`
  if (a.edits.length > 0) {
    rows.push('    Edited')
    for (const g of groupByFolder(a.edits)) {
      rows.push(pathRow(6, g.folder))
      for (const [name, count] of g.files) rows.push(pathRow(8, `${name} \u00d7${count}`))
    }
  }
  if (a.reads.length > 0) {
    rows.push('    Read')
    for (const g of groupByFolder(a.reads)) {
      const named = g.files.filter(([name]) => name !== '').length
      rows.push(pathRow(6, g.folder, ` (${named === 0 ? 'searched' : plural(named, 'file', 'files')})`))
    }
  }
  if (a.morePaths > 0) rows.push(`    +${a.morePaths} more`)
  const recent = a.recent.flatMap(t => toolName(t) ?? [])
  if (recent.length > 0) rows.push(truncate(`    Recent: ${recent.join(' \u2192 ')}`, cols))
  return rows
}

/** The rows after an agent's title and meta rows: the detail when expanded, else the edit summary. */
export const extraRows = (a: Activity, cols: number, expanded: boolean): string[] => {
  if (expanded) return detailRows(a, cols)
  const summary = editSummary(a, cols - META_INDENT)
  return summary === undefined ? [] : [`${' '.repeat(META_INDENT)}${summary}`]
}

/** The single meta row of the main session: its tool count and last tool. */
export const mainMeta = (a: Activity): string => {
  const last = a.lastTool === undefined ? undefined : toolName(a.lastTool)
  return [plural(a.tools, 'tool', 'tools'), last].filter(Boolean).join(SEP)
}

/** Rows opened under the header: the session folder, and `worktree` for a linked worktree. */
export const headerRows = (env: EnvInfo | null | undefined, cols: number): string[] =>
  env?.cwd === undefined
    ? []
    : [`  ${truncateLeft(env.cwd, cols - 2)}`, ...(env.isWorktree ? ['  worktree'] : [])]

export type Block = { height: number; pinned: boolean }

/**
 * The blocks that fit `lines` rows, in order. Once one block does not fit, no later
 * block is shown. A pinned block (one the person expanded) is always shown and takes its rows.
 */
export const fitBlocks = <T extends Block>(
  items: readonly T[],
  lines: number,
): { shown: T[]; hidden: number } => {
  const shown: T[] = []
  let left = lines
  let full = false
  for (const item of items) {
    if (item.pinned || (!full && item.height <= left)) {
      shown.push(item)
      left -= item.height
    } else {
      full = true
    }
  }
  return { shown, hidden: items.length - shown.length }
}

/**
 * Whether the folder is a linked git worktree, from `git rev-parse --path-format=absolute
 * --git-dir --git-common-dir`: the two differ only in a linked worktree.
 */
export const parseWorktree = (exitCode: number, stdout: string): boolean => {
  if (exitCode !== 0) return false
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.length === 2 && lines[0] !== lines[1]
}
