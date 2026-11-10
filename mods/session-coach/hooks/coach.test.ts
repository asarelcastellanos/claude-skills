import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  buildClassifierPrompt,
  crossedMilestone,
  hintText,
  initialCoach,
  isIdle,
  nextHintThreshold,
  parseVerdict,
  recentUserPrompts,
  recordSpawn,
  shouldCheckContext,
} from './coach'

describe('parseVerdict', () => {
  test('reads one word, any case, with trailing punctuation', () => {
    expect(parseVerdict('NEW')).toBe('NEW')
    expect(parseVerdict(' same.\n')).toBe('SAME')
    expect(parseVerdict('**New**')).toBe('NEW')
  })

  test('returns null for anything else', () => {
    expect(parseVerdict('')).toBe(null)
    expect(parseVerdict('NEW task')).toBe(null)
    expect(parseVerdict('It is SAME')).toBe(null)
    expect(parseVerdict('maybe')).toBe(null)
  })
})

describe('thresholds', () => {
  test('context minimum', () => {
    expect(shouldCheckContext(19, 20, null)).toBe(false)
    expect(shouldCheckContext(20, 20, null)).toBe(true)
    expect(shouldCheckContext(undefined, 20, null)).toBe(false)
  })

  test('no repeat until 20 points more', () => {
    expect(nextHintThreshold(null, 20)).toBe(20)
    expect(nextHintThreshold(42, 20)).toBe(62)
    expect(shouldCheckContext(61, 20, 42)).toBe(false)
    expect(shouldCheckContext(62, 20, 42)).toBe(true)
  })

  test('idle detection', () => {
    const min = 60_000
    expect(isIdle(31 * min, 0, 30)).toBe(true)
    expect(isIdle(30 * min, 0, 30)).toBe(false)
    expect(isIdle(99 * min, null, 30)).toBe(false)
  })
})

describe('classifier prompt', () => {
  test('truncates and asks for one word', () => {
    const p = buildClassifierPrompt(['a'.repeat(900)], 'b'.repeat(2000))
    expect(p).toContain('a'.repeat(500) + '...')
    expect(p).not.toContain('a'.repeat(501))
    expect(p).toContain('b'.repeat(1000) + '...')
    expect(p).not.toContain('b'.repeat(1001))
    expect(p).toContain('SAME or NEW')
  })

  test('recentUserPrompts keeps the last three and drops the new prompt', () => {
    const rows = [
      { role: 'user', text: 'one' },
      { role: 'assistant', text: 'x' },
      { role: 'user', text: 'two' },
      { role: 'user', text: '' },
      { role: 'user', text: 'three' },
      { role: 'user', text: 'four' },
      { role: 'user', text: 'new one' },
    ]
    expect(recentUserPrompts(rows, 'new one', 3)).toEqual(['two', 'three', 'four'])
  })

  test('hint text', () => {
    expect(hintText(42, 85_000)).toBe(
      'New task? /clear starts fresh. Context is 42% full (85k tokens).',
    )
    expect(hintText(42)).toBe('New task? /clear starts fresh. Context is 42% full.')
  })
})

describe('workflow cap', () => {
  test('allows up to the cap and denies the next', () => {
    let runs: Record<string, number> = {}
    for (let i = 1; i <= 3; i++) {
      const r = recordSpawn(runs, 'r1', 3)
      expect(r.allowed).toBe(true)
      expect(r.count).toBe(i)
      runs = r.runs
    }
    const over = recordSpawn(runs, 'r1', 3)
    expect(over.allowed).toBe(false)
    expect(over.count).toBe(3)
    expect(over.runs['r1']).toBe(3)
  })

  test('cap 0 is unlimited', () => {
    let runs: Record<string, number> = {}
    for (let i = 0; i < 100; i++) runs = recordSpawn(runs, 'r1', 0).runs
    expect(recordSpawn(runs, 'r1', 0)).toMatchObject({ allowed: true, count: 101 })
  })

  test('runs count separately', () => {
    const a = recordSpawn({}, 'a', 1)
    const b = recordSpawn(a.runs, 'b', 1)
    expect(b.allowed).toBe(true)
    expect(recordSpawn(b.runs, 'a', 1).allowed).toBe(false)
  })
})

describe('milestones', () => {
  test('fires once per crossing', () => {
    expect(crossedMilestone(24, 25)).toBe(25)
    expect(crossedMilestone(25, 26)).toBe(null)
    expect(crossedMilestone(49, 50)).toBe(50)
    expect(crossedMilestone(99, 100)).toBe(100)
    expect(crossedMilestone(100, 101)).toBe(null)
    expect(crossedMilestone(0, 60)).toBe(50)
  })
})

describe('hooks', () => {
  const spawn = (runId: string | undefined, extra: object = {}) => ({
    prompt: 'p',
    description: 'd',
    ...(runId ? { workflow: { runId, agentIndex: 0 } } : {}),
    ...extra,
  })

  test('the cap denies the spawn over it, resumes are not counted', { options: { workflowAgentCap: 2 } }, async ($, on) => {
    on('agent.spawn', () => ({ agentId: 'a', model: 'm' }))
    const first = await $.agent.spawn(spawn('r1') as never)
    expect(first).not.toHaveProperty('deny')
    await $.agent.spawn(spawn('r1', { resume: 'x' }) as never)
    expect(await $.agent.spawn(spawn('r1') as never)).not.toHaveProperty('deny')
    const over = await $.agent.spawn(spawn('r1') as never)
    expect(over).toHaveProperty('deny')
    expect(await $.agent.spawn(spawn('r2') as never)).not.toHaveProperty('deny')
  })

  test('a cap of 0 never denies', { options: { workflowAgentCap: 0 } }, async ($, on) => {
    on('agent.spawn', () => ({ agentId: 'a', model: 'm' }))
    for (let i = 0; i < 30; i++) {
      expect(await $.agent.spawn(spawn('r1') as never)).not.toHaveProperty('deny')
    }
  })

  test('/clear resets the counters', { options: { workflowAgentCap: 2 } }, async ($, on) => {
    on('session.end', () => ({ sessionId: 's' }))
    on('agent.spawn', () => ({ agentId: 'a', model: 'm' }))
    for (let i = 0; i < 2; i++) await $.agent.spawn(spawn('r1') as never)
    expect(await $.agent.spawn(spawn('r1') as never)).toHaveProperty('deny')
    await $.session.end({ reason: 'clear' } as never)
    expect(await $.agent.spawn(spawn('r1') as never)).not.toHaveProperty('deny')
  })
})

describe('hint flow', () => {
  const rows = [
    { role: 'user', text: 'fix the login bug', toolUses: [] },
    { role: 'user', text: 'now add tests', toolUses: [] },
  ]

  // Stands in for the engine beneath the plugin; records toasts and model calls.
  const engine = (
    on: On,
    opts: { percent: number; verdict: string },
  ) => {
    const log = { toasts: [] as string[], modelCalls: 0 }
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('turn.complete', () => ({ text: '' }))
    on('session.end', () => ({ sessionId: 's' }))
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits: [], context: { tokens: 85_000, window: 200_000, percent: opts.percent } },
    }))
    on('session.messages', () => ({ value: rows as never }))
    on('model.complete', () => {
      log.modelCalls += 1

      return { value: { isAnswered: true, text: opts.verdict, usage: {} } } as never
    })
    on('ui.toast', (_, e) => {
      log.toasts.push(e.text)

      return { value: undefined }
    })

    return log
  }

  let clock: ReturnType<typeof mock.clock>
  const submit = async ($: Engine, text: string) => {
    await $.prompt.submit({ text } as never)
    await clock.settle()
  }

  test('first prompt, slash commands and low context get no check', async ($, on) => {
    clock = mock.clock(on)
    const log = engine(on, { percent: 10, verdict: 'NEW' })
    await submit($, 'first')
    await submit($, '/help')
    await submit($, 'second')
    expect(log.modelCalls).toBe(0)
    expect(log.toasts).toEqual([])
  })

  test('a NEW verdict toasts once, then stays quiet until 20 points more', async ($, on) => {
    clock = mock.clock(on)
    const log = engine(on, { percent: 42, verdict: 'NEW' })
    await submit($, 'first')
    await submit($, 'something unrelated')
    expect(log.modelCalls).toBe(1)
    expect(log.toasts).toEqual(['New task? /clear starts fresh. Context is 42% full (85k tokens).'])
    await submit($, 'another unrelated one')
    expect(log.toasts.length).toBe(1)
  })

  test('SAME and unclear verdicts give no hint', async ($, on) => {
    clock = mock.clock(on)
    const log = engine(on, { percent: 42, verdict: 'SAME' })
    await submit($, 'first')
    await submit($, 'continue')
    expect(log.toasts).toEqual([])
  })

  test('idle past the limit hints without a model call', async ($, on) => {
    clock = mock.clock(on)
    const log = engine(on, { percent: 42, verdict: 'SAME' })
    await submit($, 'first')
    await $.turn.complete({ answer: 'done' } as never)
    await clock.advance(31 * 60_000)
    await submit($, 'later')
    expect(log.modelCalls).toBe(0)
    expect(log.toasts.length).toBe(1)
  })

  test('useModelCheck off asks no model', { options: { useModelCheck: false } }, async ($, on) => {
    clock = mock.clock(on)
    const log = engine(on, { percent: 42, verdict: 'NEW' })
    await submit($, 'first')
    await submit($, 'second')
    expect(log.modelCalls).toBe(0)
    expect(log.toasts).toEqual([])
  })

  test('/clear resets the hint state', async ($, on) => {
    clock = mock.clock(on)
    const log = engine(on, { percent: 42, verdict: 'NEW' })
    await submit($, 'first')
    await submit($, 'second')
    expect(log.toasts.length).toBe(1)
    await $.session.end({ reason: 'clear' } as never)
    await submit($, 'first again')
    await submit($, 'second again')
    expect(log.toasts.length).toBe(2)
  })
})

test('toasts at 25 agents, once', async ($, on) => {
  const toasts: string[] = []
  on('agent.spawn', () => ({ agentId: 'a', model: 'm' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  for (let i = 0; i < 26; i++) await $.agent.spawn({ prompt: 'p', description: 'd' } as never)
  expect(toasts).toEqual(['25 agents have run this session. Workflows are for big tasks.'])
})

test('initial state is empty', () => {
  expect(initialCoach.runs).toEqual({})
})
