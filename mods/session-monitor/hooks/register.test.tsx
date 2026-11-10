import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-monitor',
  component: 'Pane',
  requestId: 'monitor',
  props: {
    title: 'Monitor',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the pane shows an agent, usage and context, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 76000, window: 200000, percent: 38 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 92 }],
      cost: { usd: 1.5 },
    },
  }))
  on('agent.spawn', () => ({ model: 'claude-opus-4', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '# branch.oid abc1234\n# branch.head main\n? x\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('clock.now', () => ({ value: 60_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    prompt: 'p',
    description: 'scan the repo',
    subagentType: 'Explore',
    background: false,
    fork: false,
  } as never)

  // The refresh at start-up is scheduled, so /monitor loads the figures here.
  await $.command.run({ command: 'monitor', args: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: /scan the repo/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /38%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /repo \u00b7 main\*/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/clear empties the agent list', async ($, on) => {
  on('command.register', () => ({ value: { command: 'monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [],
    },
  }))
  on('agent.spawn', () => ({ model: 'claude-opus-4', agentId: 'a1' }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '# branch.oid abc1234\n# branch.head main\n? x\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('clock.now', () => ({ value: 60_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    prompt: 'p',
    description: 'scan the repo',
    subagentType: 'Explore',
    background: false,
    fork: false,
  } as never)
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /none yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /scan the repo/ })).toBeUndefined()
  await ui.unmount()
})

test('a resumed session empties the agent list', async ($, on) => {
  on('command.register', () => ({ value: { command: 'monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [],
    },
  }))
  on('agent.spawn', () => ({ model: 'claude-opus-4', agentId: 'a1' }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '# branch.oid abc1234\n# branch.head main\n? x\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('clock.now', () => ({ value: 60_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    prompt: 'p',
    description: 'scan the repo',
    subagentType: 'Explore',
    background: false,
    fork: false,
  } as never)
  await $.session.end({ reason: 'resume', sessionId: 's' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /none yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /scan the repo/ })).toBeUndefined()
  await ui.unmount()
})

test('an answered spawn with no agent id is not left running', async ($, on) => {
  on('command.register', () => ({ value: { command: 'monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] },
  }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: 60_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))

  await $.agent.spawn({
    prompt: 'p',
    description: 'remote job',
    subagentType: 'Explore',
    background: false,
    fork: false,
  } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /0 running \u00b7 1 total/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /remote job/ })).toBeDefined()
  await ui.unmount()
})

type Open = { id: string; title?: string; columns?: number }

// The engine's answers for a session with one usage reading and one repo.
function engine(
  on: On,
  opts: { policy?: { enabled?: boolean; usage: Record<string, unknown> } } = {},
) {
  const opens: Open[] = []
  const statuses: unknown[] = []
  on('command.register', () => ({ value: { command: 'monitor' } }))
  on('ui.open', (_, e) => {
    opens.push(e as Open)
    return { value: { isPlaced: true } }
  })
  on('ui.status', (_, e) => {
    statuses.push(e)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 82000, window: 200000, percent: 41 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 28 },
        { kind: 'seven_day', percentUsed: 9 },
      ],
      cost: { usd: 1.42 },
    },
  }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('session.cwd', () => ({ value: '/work/claude-skills' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '# branch.oid abc1234\n# branch.head main\n? x\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('clock.now', () => ({ value: 60_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  const policy = opts.policy
  if (policy !== undefined) {
    on('state.get', { plugin: 'model-policy' }, (_, e) => ({
      value:
        e.key === 'usage'
          ? { value: policy.usage, version: 3 }
          : { value: policy.enabled, version: policy.enabled === undefined ? 0 : 1 },
    }))
  }
  return { opens, statuses }
}

const SPAWN = {
  prompt: 'p',
  description: 'Write render code',
  subagentType: 'coder',
  background: false,
  fork: false,
} as never

test('the pane has the header and every section, and sets no status line', async ($, on) => {
  const { opens, statuses } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Claude Monitor/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /claude-skills \u00b7 main\*/ })).toBeDefined()
  for (const title of ['Session', 'Context', 'Usage', 'Agents']) {
    expect(await ui.find({ type: 'Text', text: new RegExp(`\u2500\u2500 ${title}`) })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /\$1\.42/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /41%.*82k \/ 200k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5h.*28%.*7d|5h .*28%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /7d .*9%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 running \u00b7 1 total/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Write render code/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}coder \u00b7 Sonnet \u00b7 \d+s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}0 tools \u00b7 0 tok$/ })).toBeDefined()
  await ui.unmount()

  expect(statuses).toEqual([])
  expect(opens.length).toBeGreaterThan(0)
})

test('the pane opens with a dock width request of 40 columns', async ($, on) => {
  const { opens } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  expect(opens.length).toBe(2)
  for (const o of opens) {
    expect(o.id).toBe('monitor')
    expect(o.columns).toBe(40)
  }
})

test('a narrow pane falls back to a one-line header', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 27 } })
  expect(await ui.find({ type: 'Text', text: /Claude Monitor/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\u259d\u259c/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^claude-skills \u00b7 main\* \u00b7/ })).toBeDefined()
  await ui.unmount()
})

test('the Policy section shows when model-policy has written its state', async ($, on) => {
  engine(on, { policy: { usage: { opus: { tokens: 7000, cache: 0 } } } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\u2500\u2500 Policy/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}on$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}opus {4}7k$/ })).toBeDefined()
  await ui.unmount()
})

test('the Policy section reads off when model-policy is switched off', async ($, on) => {
  engine(on, { policy: { enabled: false, usage: {} } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ {2}off$/ })).toBeDefined()
  await ui.unmount()
})

test('without model-policy the pane has no Policy section', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\u2500\u2500 Usage/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Policy/ })).toBeUndefined()
  await ui.unmount()
})

const AT_40 = { ...PANE.props, bodyColumns: 40 }

test('at 40 columns a running agent shows its tools, tokens and last tool whole', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.tool.call({ tool: 'Edit', agentId: 'a1' } as never)
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  expect(await ui.find({ type: 'Text', text: /^ {4}coder \u00b7 Sonnet \u00b7 \d+s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}1 tools \u00b7 0 tok \u00b7 Edit$/ })).toBeDefined()
  await ui.unmount()
})

test('at 40 columns a finished agent shows its token count whole', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.turn.complete({
    agentId: 'a1',
    reason: 'answer',
    answer: '',
    usage: {
      input_tokens: 10_000,
      output_tokens: 5_000,
      cache_read_input_tokens: 2_000,
      cache_creation_input_tokens: 1_000,
    },
  } as never)
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  expect(await ui.find({ type: 'Text', text: /^ {4}0 tools \u00b7 18k tok$/ })).toBeDefined()
  await ui.unmount()
})

test('at 40 columns the Policy section lists three families on their own rows', async ($, on) => {
  engine(on, {
    policy: {
      usage: {
        opus: { tokens: 123_000, cache: 0 },
        sonnet: { tokens: 456_000, cache: 0 },
        haiku: { tokens: 78_000, cache: 0 },
      },
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  expect(await ui.find({ type: 'Text', text: /^ {2}on$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}opus {4}123k$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}sonnet {2}456k$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}haiku {3}78k$/ })).toBeDefined()
  await ui.unmount()
})
