import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import {
  AGENT_ROWS,
  agentMeta,
  barLayout,
  bar,
  CLAUDE_ORANGE,
  completed,
  CRAB,
  CRAB_MIN_COLS,
  BAR_MAX,
  BAR_MIN,
  CRIT_RED,
  denied,
  emptyActivity,
  detailRows,
  editSummary,
  envLine,
  extraRows,
  family,
  familyName,
  fitBlocks,
  fixedRows,
  hasRunning,
  groupByFolder,
  headerPlan,
  headerRows,
  friendlyModel,
  formatDuration,
  formatClock,
  formatReset,
  formatWeekdayTime,
  formatTokens,
  locationLine,
  mainMeta,
  mergeActivity,
  META_INDENT,
  MIN_COLS,
  order,
  parseGitStatus,
  parseWorktree,
  PATH_CAP,
  policyLines,
  projectLimit,
  resetTails,
  resetText,
  relativize,
  resumed,
  resolved,
  rule,
  ruleParts,
  severity,
  severityColor,
  spawned,
  SPINNER,
  spinnerFrame,
  symbol,
  trim,
  toolCalled,
  toolName,
  toolPaths,
  touchedIn,
  truncateLeft,
  withTool,
  truncate,
  typeName,
  visible,
  WARN_AMBER,
  WINDOW_MS,
} from './model'
import type { Touched } from './model'

const spawn = (rows: AgentRow[], key: string, now: number) =>
  spawned(rows, { key, description: key, type: 'Explore', now })

describe('reducers', () => {
  test('spawn, tool calls, completion', async () => {
    let rows = spawn([], 'a', 100)
    rows = resolved(rows, 'a', 'id-a', 'claude-opus-4')
    rows = toolCalled(rows, 'id-a', 'Bash', 150)
    rows = toolCalled(rows, 'id-a', 'Read', 160)
    expect(rows[0]?.tools).toBe(2)
    expect(rows[0]?.lastTool).toBe('Read')
    rows = completed(rows, 'id-a', 'answer', 500, 300)
    expect(rows[0]?.status).toBe('done')
    expect(rows[0]?.endedAt).toBe(300)
    expect(rows[0]?.tokens).toBe(500)
    expect(rows[0]?.lastTool).toBeUndefined()
  })

  test('a non-answer reason is failed', async () => {
    const rows = completed(
      resolved(spawn([], 'a', 0), 'a', 'x', undefined),
      'x',
      'error',
      0,
      5,
    )
    expect(rows[0]?.status).toBe('failed')
  })

  test('denied marks the row', async () => {
    const rows = denied(spawn([], 'a', 0), 'a', 9)
    expect(rows[0]?.status).toBe('denied')
    expect(rows[0]?.endedAt).toBe(9)
  })

  test('events before the spawn result merge into the pending row', async () => {
    let rows = spawn([], 'a', 0)
    rows = toolCalled(rows, 'id-a', 'Bash', 5)
    rows = completed(rows, 'id-a', 'answer', 40, 8)
    expect(rows.length).toBe(2)
    rows = resolved(rows, 'a', 'id-a', 'claude-haiku-4')
    expect(rows.length).toBe(1)
    expect(rows[0]?.description).toBe('a')
    expect(rows[0]?.tools).toBe(1)
    expect(rows[0]?.tokens).toBe(40)
    expect(rows[0]?.status).toBe('done')
    expect(rows[0]?.model).toBe('claude-haiku-4')
  })
})

describe('spawn without an agent id', () => {
  test('the row stops running at once', async () => {
    const rows = resolved(spawn([], 'a', 10), 'a', undefined, 'claude-opus-5-5', 50)
    expect(rows[0]?.status).toBe('untracked')
    expect(rows[0]?.endedAt).toBe(50)
    expect(hasRunning(rows)).toBe(false)
  })
})

describe('resume', () => {
  const s = { description: 'd', type: 'Explore', now: 900 }

  test('a finished agent runs again and keeps its counters', async () => {
    let rows = resolved(spawn([], 'a', 100), 'a', 'id-a', undefined)
    rows = toolCalled(rows, 'id-a', 'Bash', 110)
    rows = completed(rows, 'id-a', 'answer', 70, 200)
    rows = resumed(rows, 'id-a', s)
    expect(rows.length).toBe(1)
    expect(rows[0]?.status).toBe('running')
    expect(rows[0]?.endedAt).toBeUndefined()
    expect(rows[0]?.startedAt).toBe(100)
    expect(rows[0]?.tools).toBe(1)
    expect(rows[0]?.tokens).toBe(70)
  })

  test('a trimmed agent is added from the event', async () => {
    const rows = resumed([], 'gone', s)
    expect(rows.length).toBe(1)
    expect(rows[0]?.id).toBe('gone')
    expect(rows[0]?.description).toBe('d')
    expect(rows[0]?.status).toBe('running')
    expect(rows[0]?.startedAt).toBe(900)
  })
})

describe('ordering and trimming', () => {
  const build = () => {
    let rows = spawn([], 'old-done', 0)
    rows = spawn(rows, 'new-done', 10)
    rows = spawn(rows, 'run-old', 20)
    rows = spawn(rows, 'run-new', 30)
    rows = rows.map(r =>
      r.key === 'old-done'
        ? { ...r, status: 'done' as const, endedAt: 50 }
        : r.key === 'new-done'
          ? { ...r, status: 'failed' as const, endedAt: 60 }
          : r,
    )
    return rows
  }

  test('running first, then newest finished', async () => {
    expect(order(build()).map(r => r.key)).toEqual([
      'run-new',
      'run-old',
      'new-done',
      'old-done',
    ])
  })

  test('trim keeps running rows and the newest finished', async () => {
    const kept = trim(build(), 3)
    expect(kept.map(r => r.key).sort()).toEqual(
      ['new-done', 'run-new', 'run-old'].sort(),
    )
  })

  test('spawning past the cap drops the oldest finished', async () => {
    let rows: AgentRow[] = []
    for (let i = 0; i < 40; i++) {
      rows = spawn(rows, `a${i}`, i)
      rows = rows.map(r =>
        r.key === `a${i}` ? { ...r, status: 'done' as const, endedAt: i } : r,
      )
    }
    expect(rows.length).toBe(30)
    expect(rows.some(r => r.key === 'a39')).toBe(true)
    expect(rows.some(r => r.key === 'a0')).toBe(false)
  })

  test('visible fits the line budget', async () => {
    const { shown, hidden } = visible(build(), 5, 2)
    expect(shown.length).toBe(2)
    expect(hidden).toBe(2)
    expect(visible(build(), 1, 2).shown.length).toBe(0)
  })
})

describe('formatting', () => {
  test('family', async () => {
    expect(family('claude-opus-4-1')).toBe('opus')
    expect(family('claude-3-5-haiku-latest')).toBe('haiku')
    expect(family('sonnet')).toBe('sonnet')
    expect(family('fable-x')).toBe('fable')
    expect(family(undefined)).toBe('?')
  })

  test('formatDuration', async () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(59_999)).toBe('59s')
    expect(formatDuration(65_000)).toBe('1m 05s')
    expect(formatDuration(3_900_000)).toBe('1h 05m')
  })

  test('formatReset', async () => {
    expect(formatReset(undefined, 0)).toBe('')
    expect(formatReset(5 * 60000, 0)).toBe('5m')
    expect(formatReset((2 * 60 + 14) * 60000, 0)).toBe('2h 14m')
    expect(formatReset(((3 * 24 + 4) * 60) * 60000, 0)).toBe('3d 4h')
    expect(formatReset(-5, 0)).toBe('0m')
  })

  test('formatTokens', async () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(12_345)).toBe('12.3k')
    expect(formatTokens(82_000)).toBe('82k')
    expect(formatTokens(200_000)).toBe('200k')
    expect(formatTokens(1_200_000)).toBe('1.2M')
    expect(formatTokens(2_000_000)).toBe('2M')
  })

  test('bar splits filled and empty cells', async () => {
    expect(bar(0, 10)).toEqual({ filled: '', empty: '\u25b1'.repeat(10) })
    expect(bar(50, 10)).toEqual({ filled: '\u25b0'.repeat(5), empty: '\u25b1'.repeat(5) })
    expect(bar(100, 4)).toEqual({ filled: '\u25b0'.repeat(4), empty: '' })
    expect(bar(250, 4)).toEqual({ filled: '\u25b0'.repeat(4), empty: '' })
    expect(bar(-3, 4)).toEqual({ filled: '', empty: '\u25b1'.repeat(4) })
  })

  test('bar and percent color follow severity', async () => {
    expect(severityColor(severity(10))).toBe(CLAUDE_ORANGE)
    expect(severityColor(severity(70))).toBe(WARN_AMBER)
    expect(severityColor(severity(89))).toBe(WARN_AMBER)
    expect(severityColor(severity(90))).toBe(CRIT_RED)
    expect(severityColor(severity(undefined))).toBe(CLAUDE_ORANGE)
  })

  test('severity thresholds', async () => {
    expect(severity(69.9)).toBe('ok')
    expect(severity(70)).toBe('warn')
    expect(severity(89.9)).toBe('warn')
    expect(severity(90)).toBe('crit')
    expect(severity(undefined)).toBe('ok')
  })

  test('truncate', async () => {
    expect(truncate('abcdef', 6)).toBe('abcdef')
    expect(truncate('abcdef', 4)).toBe('abc~')
    expect(truncate('abc', 0)).toBe('')
  })
})

describe('git status', () => {
  const head = (name: string, oid = 'abcdef1234567890') =>
    `# branch.oid ${oid}\n# branch.head ${name}\n# branch.upstream origin/${name}\n# branch.ab +0 -0\n`

  test('clean branch', async () => {
    expect(parseGitStatus(0, head('main'))).toEqual({ branch: 'main', dirty: false })
  })

  test('dirty: modified, renamed, unmerged and untracked all count', async () => {
    expect(parseGitStatus(0, `${head('main')}1 .M N... 100644 100644 100644 a b x.ts\n`)?.dirty).toBe(true)
    expect(parseGitStatus(0, `${head('main')}2 R. N... 1 1 1 a b R100 new\told\n`)?.dirty).toBe(true)
    expect(parseGitStatus(0, `${head('main')}u UU N... 1 1 1 1 a b c x\n`)?.dirty).toBe(true)
    expect(parseGitStatus(0, `${head('main')}? new.txt\n`)?.dirty).toBe(true)
  })

  test('ignored files do not make it dirty', async () => {
    expect(parseGitStatus(0, `${head('main')}! dist/\n`)?.dirty).toBe(false)
  })

  test('detached shows a short hash', async () => {
    expect(parseGitStatus(0, head('(detached)'))).toEqual({ branch: 'abcdef1', dirty: false })
  })

  test('initial commit keeps the branch name', async () => {
    expect(
      parseGitStatus(0, '# branch.oid (initial)\n# branch.head main\n? a\n'),
    ).toEqual({ branch: 'main', dirty: true })
  })

  test('not a repository', async () => {
    expect(parseGitStatus(128, '')).toBeUndefined()
    expect(parseGitStatus(0, '')).toBeUndefined()
  })
})

describe('friendlyModel', () => {
  test('known families', async () => {
    expect(friendlyModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(friendlyModel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(friendlyModel('claude-haiku-4-5')).toBe('Haiku 4.5')
    expect(friendlyModel('claude-fable-1')).toBe('Fable 1')
  })

  test('dated, old-style, alias and suffixed ids', async () => {
    expect(friendlyModel('claude-opus-4-20250514')).toBe('Opus 4')
    expect(friendlyModel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
    expect(friendlyModel('sonnet')).toBe('Sonnet')
    expect(friendlyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  })

  test('unknown ids pass through', async () => {
    expect(friendlyModel('gpt-x')).toBe('gpt-x')
  })
})

describe('environment lines', () => {
  const env = { folder: 'repo', branch: 'main', dirty: true, isWorktree: false, model: 'Opus 5.5', gitAt: 0 }

  test('envLine has every segment', async () => {
    expect(envLine(env)).toBe('repo \u00b7 main* \u00b7 Opus 5.5')
  })

  test('clean branch has no star, no repo drops the branch', async () => {
    expect(envLine({ ...env, dirty: false })).toBe('repo \u00b7 main \u00b7 Opus 5.5')
    expect(envLine({ ...env, branch: undefined })).toBe('repo \u00b7 Opus 5.5')
  })

  test('each of folder and model can be missing', async () => {
    expect(envLine({ ...env, folder: undefined })).toBe('main* \u00b7 Opus 5.5')
    expect(envLine({ ...env, model: undefined })).toBe('repo \u00b7 main*')
    expect(envLine({ dirty: false, isWorktree: false, gitAt: 0 })).toBe('')
    expect(envLine(null)).toBe('')
  })

  test('locationLine leaves the model out', async () => {
    expect(locationLine(env)).toBe('repo \u00b7 main*')
    expect(locationLine({ ...env, folder: undefined, branch: undefined })).toBe('')
    expect(locationLine(null)).toBe('')
  })
})

describe('pane layout', () => {
  test('spinnerFrame picks a glyph by the second', async () => {
    expect(SPINNER.join(' ')).toBe('\u00b7 \u2722 \u2733 \u2736 \u273b \u273d')
    expect(spinnerFrame(0)).toBe('\u00b7')
    expect(spinnerFrame(999)).toBe('\u00b7')
    expect(spinnerFrame(1000)).toBe('\u2722')
    expect(spinnerFrame(5000)).toBe('\u273d')
    expect(spinnerFrame(6000)).toBe('\u00b7')
    expect(spinnerFrame(61_500)).toBe('\u2722')
  })

  test('status symbols', async () => {
    expect(symbol('running', 2000)).toBe('\u2733')
    expect(symbol('done', 0)).toBe('\u2713')
    expect(symbol('failed', 0)).toBe('\u2717')
    expect(symbol('denied', 0)).toBe('\u2298')
    expect(symbol('untracked', 0)).toBe('\u25cb')
  })

  test('no spinner frame looks like another status glyph', async () => {
    const others = (['done', 'failed', 'denied', 'untracked'] as const).map(s => symbol(s, 0))
    for (const frame of SPINNER) expect(others.includes(frame)).toBe(false)
    expect(new Set(others).size).toBe(others.length)
  })

  const meta = (over: Partial<AgentRow> = {}): AgentRow => ({
    ...emptyActivity(),
    key: 'k',
    description: 'd',
    type: 'coder',
    model: 'claude-sonnet-5-5',
    status: 'running',
    startedAt: 0,
    tools: 12,
    tokens: 18_000,
    lastTool: 'Edit',
    ...over,
  })

  test('agentMeta splits into two rows that fit a 40 column dock', async () => {
    const row = meta()
    expect(AGENT_ROWS).toBe(3)
    expect(agentMeta(row, 64_000, 40)).toEqual(['coder \u00b7 Sonnet \u00b7 1m 04s', '12 tools \u00b7 18k tok \u00b7 Edit'])
    expect(agentMeta(meta({ status: 'done', endedAt: 18_000 }), 64_000, 40)).toEqual([
      'coder \u00b7 Sonnet \u00b7 18s',
      '12 tools \u00b7 18k tok',
    ])
    expect(agentMeta(meta({ lastTool: undefined }), 64_000, 40)[1]).toBe('12 tools \u00b7 18k tok')
  })

  test('typeName and toolName strip a plugin prefix and the MCP server', async () => {
    expect(typeName('model-policy:reviewer')).toBe('reviewer')
    expect(typeName('coder')).toBe('coder')
    expect(toolName('mcp__plugin-authoring__scan_secrets')).toBe('scan_secrets')
    expect(toolName('mcp__x')).toBe('x')
    expect(toolName('Edit')).toBe('Edit')
  })

  test('a single tool is singular', async () => {
    expect(agentMeta(meta({ tools: 1 }), 64_000, 40)[1]).toBe('1 tool \u00b7 18k tok \u00b7 Edit')
    expect(agentMeta(meta({ tools: 0 }), 64_000, 40)[1]).toBe('0 tools \u00b7 18k tok \u00b7 Edit')
  })

  test('long names shorten, and duration and token count survive at 40 columns', async () => {
    const worst = meta({
      type: 'a-very-long-plugin:an-extremely-long-agent-type-name',
      lastTool: 'mcp__plugin-authoring__a_really_long_tool_name_here',
      tools: 123,
      tokens: 456_000,
      startedAt: 0,
    })
    const [one, two] = agentMeta(worst, 3_723_000, 40)
    expect(one.endsWith(' \u00b7 Sonnet \u00b7 1h 02m')).toBe(true)
    expect(two.startsWith('123 tools \u00b7 456k tok \u00b7 ')).toBe(true)
    expect(one.includes('~')).toBe(true)
    expect(two.includes('~')).toBe(true)
    for (const text of [one, two]) expect(META_INDENT + text.length).toBeLessThanOrEqual(40)
  })

  test('the real long names fit 40 columns with duration and tokens whole', async () => {
    const [one, two] = agentMeta(
      meta({ type: 'model-policy:reviewer', lastTool: 'mcp__plugin-authoring__scan_secrets' }),
      64_000,
      40,
    )
    expect(one).toBe('reviewer \u00b7 Sonnet \u00b7 1m 04s')
    expect(two).toBe('12 tools \u00b7 18k tok \u00b7 scan_secrets')
  })

  test('an empty name after a prefix is no name', async () => {
    expect(typeName('plugin:')).toBe('plugin:')
    expect(toolName('mcp__')).toBeUndefined()
    expect(toolName('mcp__x__')).toBeUndefined()
    const [one, two] = agentMeta(meta({ type: 'plugin:', lastTool: 'mcp__x__' }), 64_000, 40)
    expect(one).toBe('plugin: \u00b7 Sonnet \u00b7 1m 04s')
    expect(two).toBe('12 tools \u00b7 18k tok')
  })

  test('at MIN_COLS the counts, model and duration survive the pane truncation', async () => {
    expect(MIN_COLS).toBe(23)
    const rows = agentMeta(meta(), 64_000, MIN_COLS).map(text =>
      truncate(`${' '.repeat(META_INDENT)}${text}`, MIN_COLS),
    )
    expect(rows[0]).toContain(' \u00b7 Sonnet \u00b7 1m 04s')
    expect(rows[1]).toBe('    12 tools \u00b7 18k tok')
    for (const row of rows) expect(row.includes('~')).toBe(false)
  })

  test('familyName capitalizes the family', async () => {
    expect(familyName('claude-sonnet-5-5')).toBe('Sonnet')
    expect(familyName(undefined)).toBe('?')
  })

  test('the crab rows are the three pixel rows', async () => {
    expect([...CRAB]).toEqual([' \u2590\u259b\u2588\u2588\u2588\u259c\u258c', '\u259d\u259c\u2588\u2588\u2588\u2588\u2588\u259b\u2598', '  \u2598\u2598 \u259d\u259d'])
  })

  test('header is the crab when wide and tall enough', async () => {
    const other = fixedRows(2, 0)
    expect(headerPlan(40, 60, other, true)).toEqual({ kind: 'crab', rows: 3 })
    expect(headerPlan(CRAB_MIN_COLS, 60, other, true).kind).toBe('crab')
  })

  test('header needs a spare row for "none yet" or "+N more"', async () => {
    const other = fixedRows(2, 0)
    expect(headerPlan(40, CRAB.length + other + 1, other, true).kind).toBe('crab')
    expect(headerPlan(40, CRAB.length + other, other, true)).toEqual({ kind: 'line', rows: 2 })
  })

  test('header falls back to a line when narrow or short', async () => {
    const other = fixedRows(2, 0)
    expect(headerPlan(CRAB_MIN_COLS - 1, 60, other, true)).toEqual({ kind: 'line', rows: 2 })
    expect(headerPlan(40, CRAB.length + other - 1, other, true)).toEqual({ kind: 'line', rows: 2 })
    expect(headerPlan(20, 60, other, false)).toEqual({ kind: 'line', rows: 1 })
  })

  test('fixedRows counts separators, titles and fixed lines', async () => {
    // blank after header, Session 2, Context 2, Usage 1 + 2, Agents 1, three blanks between.
    expect(fixedRows(2, 0)).toBe(1 + 2 + 2 + 3 + 1 + 3)
    // No limits still reserve one line for "no rate limits reported".
    expect(fixedRows(0, 0)).toBe(fixedRows(1, 0))
    // Policy adds its rule, one row per policy line and one more blank.
    expect(fixedRows(2, 1)).toBe(fixedRows(2, 0) + 3)
    expect(fixedRows(2, 4)).toBe(fixedRows(2, 0) + 6)
  })

  test('rule fills the width exactly', async () => {
    expect(rule('Session', 20)).toBe('\u2500\u2500 Session \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500')
    for (const width of [10, 11, 28, 40, 80]) {
      expect(rule('Session', width).length).toBe(width)
      expect(rule('Agents \u00b7 1 running \u00b7 3 total', width).length).toBe(width)
    }
  })

  test('rule shortens a title that does not fit', async () => {
    const r = rule('A very long section title', 12)
    expect(r.length).toBe(12)
    expect(r.startsWith('\u2500\u2500 ')).toBe(true)
  })

  test('ruleParts joins to the rule', async () => {
    const p = ruleParts('Usage', 30)
    expect(p.title).toBe('Usage')
    expect(`${p.lead}${p.title}${p.tail}`).toBe(rule('Usage', 30))
  })

  test('policyLines lists on or off, then one row per family with tokens', async () => {
    expect(policyLines(true, { opus: { tokens: 7000, cache: 0 } })).toEqual(['on', 'opus    7k'])
    expect(policyLines(false, {})).toEqual(['off'])
    expect(
      policyLines(true, {
        haiku: { tokens: 400, cache: 9 },
        sonnet: { tokens: 2500, cache: 0 },
        opus: { tokens: 0, cache: 50 },
      }),
    ).toEqual(['on', 'sonnet  2.5k', 'haiku   400'])
  })
})

describe('limit projection', () => {
  const H = 3_600_000
  const NOW = new Date(2026, 10, 9, 12, 0).getTime()
  const seven = (elapsedH: number, percent: number) => ({
    kind: 'seven_day',
    percent,
    resetsAt: NOW + WINDOW_MS.seven_day! - elapsedH * H,
  })
  const five = (elapsedH: number, percent: number) => ({
    kind: 'five_hour',
    percent,
    resetsAt: NOW + WINDOW_MS.five_hour! - elapsedH * H,
  })

  test('hidden under 5 percent, with no reset time, with no elapsed time or with an unknown window', async () => {
    expect(projectLimit(seven(24, 4.9), NOW)).toBeUndefined()
    expect(projectLimit(seven(24, 5), NOW)).toBeDefined()
    expect(projectLimit({ kind: 'seven_day', percent: 50 }, NOW)).toBeUndefined()
    expect(projectLimit({ kind: 'seven_day', percent: 50, resetsAt: NOW + WINDOW_MS.seven_day! }, NOW)).toBeUndefined()
    expect(projectLimit({ kind: 'spend_limit', percent: 50, resetsAt: NOW + H }, NOW)).toBeUndefined()
  })

  test('at 100 percent the limit is reached, even with no reset time', async () => {
    expect(projectLimit({ kind: 'seven_day', percent: 100 }, NOW)).toEqual({ text: 'limit reached', short: 'limit reached', color: CRIT_RED })
    expect(projectLimit(five(1, 104), NOW)?.text).toBe('limit reached')
  })

  test('on pace when the reset comes first', async () => {
    // Half the week gone, 40 percent used: full after 5.25 days, reset in 3.5.
    expect(projectLimit(seven(84, 40), NOW)).toEqual({ text: 'on pace, resets first', short: 'on pace', color: undefined })
  })

  test('7 day window: amber when the limit stays full for over a day', async () => {
    // 3 days gone, 60 percent: full in 2 days, reset in 4.
    const p = projectLimit(seven(72, 60), NOW)
    expect(p).toEqual({
      text: `at this pace, full ${formatWeekdayTime(NOW + 48 * H)}`,
      short: `full ${formatWeekdayTime(NOW + 48 * H)}`,
      color: WARN_AMBER,
    })
  })

  test('7 day window: orange when the limit is full for under a day', async () => {
    // 6 days gone, 90 percent: full in 16 hours, reset in 24.
    const p = projectLimit(seven(144, 90), NOW)
    expect(p?.color).toBe(CLAUDE_ORANGE)
    expect(p?.text).toBe(`at this pace, full ${formatWeekdayTime(NOW + 16 * H)}`)
  })

  test('7 day window: red when it fills within 5 hours', async () => {
    // 6 days gone, 99 percent: full in about 1.5 hours.
    expect(projectLimit(seven(144, 99), NOW)?.color).toBe(CRIT_RED)
  })

  test('5 hour window: amber, time only on the same day', async () => {
    // 2 hours gone, 80 percent: full in 30 minutes.
    expect(projectLimit(five(2, 80), NOW)).toEqual({ text: 'at this pace, full 12:30pm', short: 'full 12:30pm', color: WARN_AMBER })
    const late = new Date(2026, 10, 9, 23, 50).getTime()
    const next = projectLimit(
      { kind: 'five_hour', percent: 80, resetsAt: late + WINDOW_MS.five_hour! - 2 * H },
      late,
    )
    expect(next?.text).toBe(`at this pace, full ${formatWeekdayTime(late + 30 * 60_000)}`)
  })

  test('time formats', async () => {
    expect(formatClock(new Date(2026, 10, 9, 14, 5).getTime())).toBe('2:05pm')
    expect(formatClock(new Date(2026, 10, 9, 9, 0).getTime())).toBe('9:00am')
    expect(formatWeekdayTime(new Date(2026, 10, 13, 9, 0).getTime())).toBe('Fri 9:00am')
    expect(formatWeekdayTime(new Date(2026, 10, 9, 14, 30).getTime())).toBe('Mon 2:30pm')
  })

  test('time formats at the 12 hour boundaries', async () => {
    const at = (h: number, m: number) => formatClock(new Date(2026, 10, 9, h, m).getTime())
    expect(at(0, 5)).toBe('12:05am')
    expect(at(0, 0)).toBe('12:00am')
    expect(at(1, 0)).toBe('1:00am')
    expect(at(11, 59)).toBe('11:59am')
    expect(at(12, 0)).toBe('12:00pm')
    expect(at(12, 59)).toBe('12:59pm')
    expect(at(13, 0)).toBe('1:00pm')
    expect(at(23, 0)).toBe('11:00pm')
    expect(formatWeekdayTime(new Date(2026, 10, 11, 12, 59).getTime())).toBe('Wed 12:59pm')
  })

  test('reset text is a weekday time for 7d and a countdown otherwise', async () => {
    const at = new Date(2026, 10, 13, 9, 0).getTime()
    expect(resetText('seven_day', at, NOW)).toBe('Fri 9:00am')
    expect(resetText('five_hour', NOW + (3 * 60 + 12) * 60_000, NOW)).toBe('3h 12m')
    expect(resetText('seven_day', undefined, NOW)).toBe('')
  })

  test('projection rows count in fixedRows', async () => {
    expect(fixedRows(4, 0)).toBe(fixedRows(2, 0) + 2)
  })
})

describe('tool path tracking', () => {
  test('toolPaths reads the file tools and nothing else', async () => {
    expect(toolPaths({ tool: 'Edit', file_path: 'a.ts' })).toEqual({ edits: ['a.ts'], reads: [], searched: [] })
    expect(toolPaths({ tool: 'Write', file_path: 'b.ts' }).edits).toEqual(['b.ts'])
    expect(toolPaths({ tool: 'NotebookEdit', notebook_path: 'n.ipynb' }).edits).toEqual(['n.ipynb'])
    expect(toolPaths({ tool: 'Read', file_path: 'c.ts' }).reads).toEqual(['c.ts'])
    expect(toolPaths({ tool: 'Glob', pattern: '*.ts', path: 'src' }).searched).toEqual(['src'])
    expect(toolPaths({ tool: 'Grep', pattern: 'x', path: 'lib' }).searched).toEqual(['lib'])
    expect(toolPaths({ tool: 'Grep', pattern: 'x' })).toEqual({ edits: [], reads: [], searched: [] })
    expect(toolPaths({ tool: 'Edit', file_path: '' }).edits).toEqual([])
    expect(toolPaths({ tool: 'Edit', file_path: 42 }).edits).toEqual([])
  })

  test('a shell command is never parsed for paths', async () => {
    expect(toolPaths({ tool: 'Bash', command: 'sed -i s/a/b/ src/a.ts > out.txt' })).toEqual({
      edits: [],
      reads: [],
      searched: [],
    })
    expect(toolPaths({ tool: 'mcp__x__write', file_path: 'a.ts' }).edits).toEqual([])
  })

  test('relativize keeps paths inside the folder relative and the rest absolute', async () => {
    expect(relativize('/work/repo/src/a.ts', '/work/repo')).toBe('src/a.ts')
    expect(relativize('/work/repo/src/a.ts', '/work/repo/')).toBe('src/a.ts')
    expect(relativize('/work/repo', '/work/repo')).toBe('.')
    expect(relativize('/work/repo2/a.ts', '/work/repo')).toBe('/work/repo2/a.ts')
    expect(relativize('/etc/hosts', '/work/repo')).toBe('/etc/hosts')
    expect(relativize('C:\\work\\repo\\a.ts', 'C:\\work\\repo')).toBe('a.ts')
    expect(relativize('/a/b', undefined)).toBe('/a/b')
    expect(touchedIn({ edits: ['/w/r/a.ts'], reads: ['/x/b.ts'], searched: ['/w/r/lib'] }, '/w/r')).toEqual({
      edits: ['a.ts'],
      reads: ['/x/b.ts'],
      searched: ['lib'],
    })
  })

  test('withTool counts edits per file and keeps the last four tool names', async () => {
    let a = emptyActivity()
    for (const [tool, input] of [
      ['Edit', { edits: ['src/a.ts'] }],
      ['Edit', { edits: ['src/a.ts'] }],
      ['Read', { reads: ['src/b.ts'] }],
      ['Bash', {}],
      ['Edit', { edits: ['lib/c.ts'] }],
    ] as [string, Partial<Touched>][]) {
      a = withTool(a, tool, { edits: [], reads: [], searched: [], ...input })
    }
    expect(a.tools).toBe(5)
    expect(a.lastTool).toBe('Edit')
    expect(a.edits).toEqual([['src/a.ts', 2], ['lib/c.ts', 1]])
    expect(a.reads).toEqual([['src/b.ts', 1]])
    expect(a.recent).toEqual(['Edit', 'Read', 'Bash', 'Edit'])
  })

  test('a searched folder is stored with a trailing slash', async () => {
    const a = withTool(emptyActivity(), 'Grep', { edits: [], reads: [], searched: ['lib'] })
    expect(a.reads).toEqual([['lib/', 1]])
  })

  test('paths past the cap only add to morePaths, and known paths still count', async () => {
    let a = emptyActivity()
    for (let i = 0; i < PATH_CAP; i++) a = withTool(a, 'Edit', { edits: [`f${i}.ts`], reads: [], searched: [] })
    expect(a.edits.length).toBe(PATH_CAP)
    a = withTool(a, 'Edit', { edits: ['extra.ts'], reads: [], searched: [] })
    a = withTool(a, 'Read', { edits: [], reads: ['other.ts'], searched: [] })
    expect(a.edits.length).toBe(PATH_CAP)
    expect(a.reads).toEqual([])
    expect(a.morePaths).toBe(2)
    a = withTool(a, 'Edit', { edits: ['f0.ts'], reads: [], searched: [] })
    expect(a.edits[0]).toEqual(['f0.ts', 2])
    // A file already edited counts once toward the cap when it is read too.
    a = withTool(a, 'Read', { edits: [], reads: ['f1.ts'], searched: [] })
    expect(a.reads).toEqual([['f1.ts', 1]])
    expect(a.morePaths).toBe(2)
  })

  test('toolCalled records the paths on the agent row', async () => {
    let rows = spawned([], { key: 'a', description: 'a', type: 'Explore', now: 0 })
    rows = resolved(rows, 'a', 'id-a', undefined)
    rows = toolCalled(rows, 'id-a', 'Edit', 5, { edits: ['x.ts'], reads: [], searched: [] })
    expect(rows[0]?.edits).toEqual([['x.ts', 1]])
    expect(rows[0]?.tools).toBe(1)
  })

  test('mergeActivity adds counts and joins the recent names', async () => {
    const a = withTool(emptyActivity(), 'Edit', { edits: ['a.ts'], reads: [], searched: [] })
    const b = withTool(withTool(emptyActivity(), 'Read', { edits: [], reads: ['r.ts'], searched: [] }), 'Edit', {
      edits: ['a.ts'],
      reads: [],
      searched: [],
    })
    const m = mergeActivity(a, b)
    expect(m.tools).toBe(3)
    expect(m.edits).toEqual([['a.ts', 2]])
    expect(m.reads).toEqual([['r.ts', 1]])
    expect(m.recent).toEqual(['Edit', 'Read', 'Edit'])
  })

  test('truncateLeft keeps the end', async () => {
    expect(truncateLeft('mods/session-monitor/hooks/register.tsx', 20).length).toBe(20)
    expect(truncateLeft('mods/session-monitor/hooks/register.tsx', 20).endsWith('/register.tsx')).toBe(true)
    expect(truncateLeft('abc', 5)).toBe('abc')
    expect(truncateLeft('abcdef', 1)).toBe('\u2026')
    expect(truncateLeft('abcdef', 0)).toBe('')
  })

  test('groupByFolder groups in first-seen order', async () => {
    expect(groupByFolder([['a/x.ts', 2], ['b/y.ts', 1], ['a/z.ts', 1], ['top.ts', 1], ['/abs/q.ts', 1], ['lib/', 3]])).toEqual([
      { folder: 'a', files: [['x.ts', 2], ['z.ts', 1]] },
      { folder: 'b', files: [['y.ts', 1]] },
      { folder: '.', files: [['top.ts', 1]] },
      { folder: '/abs', files: [['q.ts', 1]] },
      { folder: 'lib', files: [['', 3]] },
    ])
  })

  const act = (edits: [string, number][], tools = 3, reads: [string, number][] = []) => ({
    ...emptyActivity(),
    tools,
    edits,
    reads,
    recent: ['Edit', 'Read', 'Bash', 'Edit'],
  })

  test('editSummary', async () => {
    expect(editSummary(act([], 0), 36)).toBeUndefined()
    expect(editSummary(act([]), 36)).toBe('no edits')
    expect(editSummary(act([['mods/session-monitor/hooks/a.ts', 1], ['mods/session-monitor/hooks/b.ts', 2]]), 50)).toBe(
      'edits mods/session-monitor/hooks (2 files)',
    )
    expect(editSummary(act([['a/1.ts', 1], ['b/2.ts', 1], ['c/3.ts', 1], ['c/4.ts', 1], ['c/5.ts', 1]]), 36)).toBe(
      'edits 3 folders (5 files)',
    )
    expect(editSummary(act([['x.ts', 1]]), 36)).toBe('edits . (1 file)')
  })

  test('editSummary shortens a long folder from the left to fit', async () => {
    const s = editSummary(act([['mods/session-monitor/hooks/deep/er/a.ts', 1]]), 30)
    expect(s?.length).toBeLessThanOrEqual(30)
    expect(s?.startsWith('edits \u2026')).toBe(true)
    expect(s?.endsWith(' (1 file)')).toBe(true)
  })

  test('detailRows list edited files, read folders and recent tools within the width', async () => {
    const a = act(
      [['mods/session-monitor/hooks/register.tsx', 3], ['mods/session-monitor/hooks/model.ts', 2]],
      9,
      [['mods/model-policy/hooks/a.ts', 1], ['mods/model-policy/hooks/b.ts', 1], ['lib/', 1]],
    )
    const rows = detailRows(a, 40)
    expect(rows[0]).toBe('    Edited')
    expect(rows).toContain('        register.tsx \u00d73')
    expect(rows).toContain('        model.ts \u00d72')
    expect(rows).toContain('    Read')
    expect(rows.some(r => r.endsWith(' (2 files)'))).toBe(true)
    expect(rows.some(r => r.endsWith('lib (searched)'))).toBe(true)
    expect(rows.at(-1)).toBe('    Recent: Edit \u2192 Read \u2192 Bash \u2192 Edit')
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(40)
    const narrow = detailRows(a, 24)
    for (const r of narrow) expect(r.length).toBeLessThanOrEqual(24)
    expect(narrow.some(r => r.includes('\u2026'))).toBe(true)
  })

  test('detailRows notes the paths past the cap and shortens MCP tool names', async () => {
    const a = { ...act([]), morePaths: 3, recent: ['mcp__a__scan_secrets', 'mcp__'] }
    expect(detailRows(a, 40)).toEqual(['    +3 more', '    Recent: scan_secrets'])
  })

  test('extraRows is the summary collapsed and the detail expanded', async () => {
    const a = act([['src/a.ts', 1]])
    expect(extraRows(a, 40, false)).toEqual(['    edits src (1 file)'])
    expect(extraRows(a, 40, true)).toEqual(detailRows(a, 40))
    expect(extraRows(act([], 0), 40, false)).toEqual([])
  })

  test('mainMeta shows the count and the last tool', async () => {
    expect(mainMeta(emptyActivity())).toBe('0 tools')
    expect(mainMeta({ ...emptyActivity(), tools: 1, lastTool: 'Read' })).toBe('1 tool \u00b7 Read')
    expect(mainMeta({ ...emptyActivity(), tools: 4, lastTool: 'mcp__a__scan' })).toBe('4 tools \u00b7 scan')
  })

  test('fitBlocks keeps order, stops at the first miss and always shows pinned blocks', async () => {
    const b = (key: string, height: number, pinned = false) => ({ key, height, pinned })
    expect(fitBlocks([b('a', 3), b('b', 3), b('c', 3)], 7)).toEqual({ shown: [b('a', 3), b('b', 3)], hidden: 1 })
    // A small block after a miss stays hidden, so the order is kept.
    expect(fitBlocks([b('a', 5), b('b', 8), b('c', 1)], 6).shown.map(x => x.key)).toEqual(['a'])
    // A pinned block shows past the room and takes the rows the others would have had.
    const r = fitBlocks([b('a', 3), b('b', 9, true), b('c', 3)], 6)
    expect(r.shown.map(x => x.key)).toEqual(['a', 'b'])
    expect(r.hidden).toBe(1)
    expect(fitBlocks([], 5)).toEqual({ shown: [], hidden: 0 })
  })

  test('parseWorktree is true only when the git dir and the common dir differ', async () => {
    expect(parseWorktree(0, '/x/.git\n/x/.git\n')).toBe(false)
    expect(parseWorktree(0, '/x/.git/worktrees/w\n/x/.git\n')).toBe(true)
    expect(parseWorktree(128, '')).toBe(false)
    expect(parseWorktree(0, '# branch.oid a\n# branch.head main\n? x\n')).toBe(false)
  })

  test('headerRows shows the folder and worktree, shortened from the left', async () => {
    const env = { cwd: '/Users/someone/projects/claude-skills', isWorktree: true, dirty: false, gitAt: 0 }
    const rows = headerRows(env, 24)
    expect(rows.length).toBe(2)
    expect(rows[0]?.length).toBeLessThanOrEqual(24)
    expect(rows[0]?.trim().startsWith('\u2026')).toBe(true)
    expect(rows[1]).toBe('  worktree')
    expect(headerRows({ ...env, isWorktree: false }, 60)).toEqual(['  /Users/someone/projects/claude-skills'])
    expect(headerRows({ isWorktree: false, dirty: false, gitAt: 0 }, 40)).toEqual([])
    expect(headerRows(null, 40)).toEqual([])
  })

  test('fixedRows adds the rows opened under the header', async () => {
    expect(fixedRows(2, 0, 2)).toBe(fixedRows(2, 0) + 2)
  })
})

describe('narrow widths', () => {
  const H = 3_600_000
  const base: AgentRow = {
    ...emptyActivity(),
    key: 'k',
    description: 'd',
    type: 'coder',
    model: 'claude-sonnet-5-5',
    status: 'running',
    startedAt: 0,
    tools: 12,
    tokens: 18_000,
    lastTool: 'Edit',
  }
  const rowsAt = (over: Partial<AgentRow>, cols = 23): [string, string] => {
    const [one, two] = agentMeta({ ...base, ...over }, 64_000, cols)
    const indent = ' '.repeat(META_INDENT)
    return [`${indent}${one}`, `${indent}${two}`]
  }

  test('relativize turns the folder itself into a dot', async () => {
    expect(relativize('/a/b/', '/a/b')).toBe('.')
    expect(relativize('/a/b/', '/a/b/')).toBe('.')
    expect(relativize('C:\\work\\repo\\', 'C:\\work\\repo')).toBe('.')
    expect(relativize('/a/b/c/', '/a/b')).toBe('c/')
    const t = touchedIn({ edits: [], reads: [], searched: ['/a/b/'] }, '/a/b')
    expect(t.searched).toEqual(['.'])
    expect(withTool(emptyActivity(), 'Grep', t).reads).toEqual([['./', 1]])
    expect(groupByFolder([['./', 1]])).toEqual([{ folder: '.', files: [['', 1]] }])
  })

  test('an unknown model name shortens to fit and the duration stays whole at 23 columns', async () => {
    const [one] = rowsAt({ model: 'some-unknown-model-name' })
    expect(one.length).toBeLessThanOrEqual(23)
    expect(one.endsWith(' \u00b7 1m 04s')).toBe(true)
    const [long] = rowsAt({ model: 'abcdefghij' }, 23)
    expect(long.length).toBeLessThanOrEqual(23)
    expect(long.endsWith('1m 04s')).toBe(true)
    // With room the model shows whole.
    expect(agentMeta({ ...base, model: 'abcdefghij' }, 64_000, 40)[0]).toBe('coder \u00b7 Abcdefghij \u00b7 1m 04s')
  })

  test('huge counts use a compact form and the token count stays whole at 23 columns', async () => {
    const [, a] = rowsAt({ tools: 1000, tokens: 1_500_000 })
    expect(a).toBe('    1k tools \u00b7 1.5M tok')
    const [, b] = rowsAt({ tools: 12_345, tokens: 12_300_000 })
    expect(b).toContain('12.3M')
    for (const text of [a, b]) expect(text.length).toBeLessThanOrEqual(23)
    const [, c] = rowsAt({ tools: 12_345, tokens: 12_300_000 }, 40)
    expect(c).toBe('    12345 tools \u00b7 12.3M tok \u00b7 Edit')
  })

  test('the plain stats form stays when it fits', async () => {
    expect(rowsAt({})[1]).toBe('    12 tools \u00b7 18k tok')
    expect(rowsAt({ tools: 1 })[1]).toBe('    1 tool \u00b7 18k tok')
  })

  test('the multi-folder edit summary fits 23 columns', async () => {
    const files: [string, number][] = Array.from({ length: 50 }, (_, i) => [`d${i % 10}/f${i}.ts`, 1])
    const a = { ...emptyActivity(), tools: 9, edits: files }
    expect(editSummary(a, 60)).toBe('edits 10 folders (50 files)')
    const narrow = editSummary(a, 19)
    expect(narrow).toBe('10 dirs, 50 files')
    expect(narrow?.length).toBeLessThanOrEqual(19)
    expect(editSummary(a, 20)).toBe('10 folders, 50 files')
    for (const row of extraRows(a, 23, false)) expect(row.length).toBeLessThanOrEqual(23)
  })

  test('barLayout takes the long tail only when a bar of BAR_MIN fits beside it', async () => {
    const tails = resetTails('Wed 10:00am')
    expect(barLayout(60, 6, tails)).toEqual({ barWidth: BAR_MAX, tail: tails[0] })
    expect(barLayout(35, 6, tails)).toEqual({ barWidth: 4, tail: tails[0] })
    expect(barLayout(34, 6, tails)).toEqual({ barWidth: 10, tail: tails[1] })
    expect(barLayout(23, 6, tails)).toEqual({ barWidth: 0, tail: tails[1] })
    expect(BAR_MIN).toBe(4)
  })

  test('at every width from 23 the reset time and the projection time are whole and fit', async () => {
    const reset = new Date(2026, 10, 11, 12, 59).getTime()
    const when = formatWeekdayTime(reset)
    expect(when).toBe('Wed 12:59pm')
    for (const cols of [23, 26, 30, 34, 36, 40, 60]) {
      const tails = resetTails(when)
      const layout = barLayout(cols, 6, tails)
      const row = `  7d  ${'#'.repeat(layout.barWidth)}${' ' + '99'.padStart(3)}%${layout.tail}`
      expect(row.length).toBeLessThanOrEqual(cols)
      expect(row.endsWith(when)).toBe(true)
    }
  })

  test('projection short forms drop the lead words', async () => {
    const NOW = new Date(2026, 10, 9, 12, 0).getTime()
    const p = projectLimit(
      { kind: 'seven_day', percent: 60, resetsAt: NOW + 7 * 24 * H - 72 * H },
      NOW,
    )
    expect(p?.short).toBe(`full ${formatWeekdayTime(NOW + 48 * H)}`)
    expect(`      ${p?.short}`.length).toBeLessThanOrEqual(23)
  })
})
