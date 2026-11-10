import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import {
  bar,
  completed,
  denied,
  envLine,
  family,
  hasRunning,
  friendlyModel,
  formatDuration,
  formatReset,
  formatTokens,
  order,
  parseGitStatus,
  resumed,
  resolved,
  severity,
  spawned,
  statusLine,
  toolCalled,
  trim,
  truncate,
  visible,
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
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })

  test('bar', async () => {
    expect(bar(0, 10)).toBe('----------')
    expect(bar(50, 10)).toBe('#####-----')
    expect(bar(100, 4)).toBe('####')
    expect(bar(250, 4)).toBe('####')
    expect(bar(-3, 4)).toBe('----')
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

  test('statusLine', async () => {
    expect(
      statusLine({
        startedAt: 0,
        contextWindow: 200000,
        contextPercent: 38.2,
        limits: [
          { kind: 'five_hour', percent: 23.4 },
          { kind: 'seven_day', percent: 41 },
        ],
      }),
    ).toBe('5h 23% · 7d 41% · ctx 38%')
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

describe('status line with environment', () => {
  const usage = {
    startedAt: 0,
    contextWindow: 1,
    contextPercent: 38,
    limits: [{ kind: 'five_hour', percent: 23 }, { kind: 'seven_day', percent: 41 }],
  }
  const env = { folder: 'repo', branch: 'main', dirty: true, model: 'Opus 5.5', gitAt: 0 }

  test('every segment', async () => {
    expect(statusLine(usage, env)).toBe(
      'repo \u00b7 main* \u00b7 Opus 5.5 \u00b7 5h 23% \u00b7 7d 41% \u00b7 ctx 38%',
    )
  })

  test('clean branch has no star, no repo drops the branch', async () => {
    expect(statusLine(usage, { ...env, dirty: false })).toContain('repo \u00b7 main \u00b7 Opus')
    expect(statusLine(usage, { ...env, branch: undefined })).toBe(
      'repo \u00b7 Opus 5.5 \u00b7 5h 23% \u00b7 7d 41% \u00b7 ctx 38%',
    )
  })

  test('each of folder and model can be missing', async () => {
    expect(statusLine(usage, { ...env, folder: undefined })).toMatch(/^main\* \u00b7 Opus 5.5/)
    expect(statusLine(usage, { ...env, model: undefined })).toMatch(/^repo \u00b7 main\* \u00b7 5h/)
    expect(envLine({ dirty: false, gitAt: 0 })).toBe('')
    expect(envLine(null)).toBe('')
  })

  test('no usage segments and no env gives an empty line', async () => {
    expect(statusLine({ ...usage, limits: [], contextPercent: undefined })).toBe('')
  })
})
