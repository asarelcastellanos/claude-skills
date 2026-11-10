import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import {
  AGENT_ROWS,
  agentMeta,
  bar,
  CLAUDE_ORANGE,
  completed,
  CRAB,
  CRAB_MIN_COLS,
  CRIT_RED,
  denied,
  envLine,
  family,
  familyName,
  fixedRows,
  hasRunning,
  headerPlan,
  friendlyModel,
  formatDuration,
  formatReset,
  formatTokens,
  locationLine,
  order,
  parseGitStatus,
  policyLines,
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
  toolCalled,
  trim,
  truncate,
  visible,
  WARN_AMBER,
} from './model'

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
  const env = { folder: 'repo', branch: 'main', dirty: true, model: 'Opus 5.5', gitAt: 0 }

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
    expect(envLine({ dirty: false, gitAt: 0 })).toBe('')
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

  test('agentMeta splits into two rows that fit a 40 column dock', async () => {
    const row: AgentRow = {
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
    expect(AGENT_ROWS).toBe(3)
    expect(agentMeta(row, 64_000)).toEqual(['coder \u00b7 Sonnet \u00b7 1m 04s', '12 tools \u00b7 18k tok \u00b7 Edit'])
    expect(agentMeta({ ...row, status: 'done', endedAt: 18_000 }, 64_000)).toEqual([
      'coder \u00b7 Sonnet \u00b7 18s',
      '12 tools \u00b7 18k tok',
    ])
    expect(agentMeta({ ...row, lastTool: undefined }, 64_000)[1]).toBe('12 tools \u00b7 18k tok')
    for (const text of agentMeta(row, 64_000)) expect(4 + text.length).toBeLessThanOrEqual(40)
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
