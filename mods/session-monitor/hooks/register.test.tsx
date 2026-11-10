import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { formatWeekdayTime } from './model'

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
  opts: {
    policy?: { enabled?: boolean; usage: Record<string, unknown> }
    limits?: { kind: string; percentUsed: number; resetsAt?: string }[]
    worktree?: boolean
    onTool?: () => void
    now?: number
  } = {},
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
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('tool.call', () => {
    opts.onTool?.()
    return { result: {} }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 82000, window: 200000, percent: 41 },
      rateLimits: opts.limits ?? [
        { kind: 'five_hour', percentUsed: 28 },
        { kind: 'seven_day', percentUsed: 9 },
      ],
      cost: { usd: 1.42 },
    },
  }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('session.cwd', () => ({ value: '/work/claude-skills' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('rev-parse')
        ? opts.worktree
          ? '/work/.git/worktrees/w\n/work/.git\n'
          : '/work/.git\n/work/.git\n'
        : '# branch.oid abc1234\n# branch.head main\n? x\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('clock.now', () => ({ value: opts.now ?? 60_000 }))
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
  expect(await ui.find({ type: 'Text', text: /^ {4}1 tool \u00b7 0 tok \u00b7 Edit$/ })).toBeDefined()
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

test('at 40 columns real long agent and tool names keep duration and tokens whole', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ ...(SPAWN as object), subagentType: 'model-policy:reviewer' } as never)
  await $.tool.call({ tool: 'mcp__plugin-authoring__scan_secrets', agentId: 'a1' } as never)
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  expect(await ui.find({ type: 'Text', text: /^ {4}reviewer \u00b7 Sonnet \u00b7 \d+s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}1 tool \u00b7 0 tok \u00b7 scan_secrets$/ })).toBeDefined()
  await ui.unmount()
})

test('a limit with a known reset gets a projection row, within 40 columns', async ($, on) => {
  const H = 3_600_000
  // The clock reads 60 000 ms. The 5 hour window is 2 hours in at 60 percent.
  engine(on, {
    limits: [
      { kind: 'five_hour', percentUsed: 60, resetsAt: new Date(60_000 + 3 * H).toISOString() },
      { kind: 'seven_day', percentUsed: 10, resetsAt: new Date(60_000 + 6 * 24 * H).toISOString() },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  const projection = await ui.find({ type: 'Text', text: /at this pace, full/ })
  expect(projection).toBeDefined()
  expect(projection?.text?.length).toBeLessThanOrEqual(40)
  expect(await ui.find({ type: 'Text', text: /7d .*10%.* resets [A-Z][a-z]{2} \d+:\d{2}[ap]m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5h .*60%.* resets 3h 00m/ })).toBeDefined()
  await ui.unmount()
})

const EDIT = '/work/claude-skills/mods/session-monitor/hooks/register.tsx'

test('tool calls without an agent id show on the Main session row', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: EDIT } as never)
  await $.tool.call({ tool: 'Read', file_path: '/etc/hosts' } as never)
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  expect(await ui.find({ type: 'Text', text: /Main session/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}2 tools \u00b7 Read$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}edits .*hooks \(1 file\)$/ })).toBeDefined()
  await ui.unmount()
})

test('pressing a row expands it and pressing again collapses it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.tool.call({ tool: 'Edit', agentId: 'a1', file_path: EDIT } as never)
  await $.tool.call({ tool: 'Edit', agentId: 'a1', file_path: EDIT } as never)
  await $.tool.call({ tool: 'Read', agentId: 'a1', file_path: '/etc/hosts' } as never)
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  expect(await ui.find({ type: 'Text', text: /Write render code/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ \u25b8$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}Edited$/ })).toBeUndefined()

  const row = (await ui.findAll({ type: 'Button' })).find(b => /Write render code/.test(b.text ?? ''))
  expect(row?.key).toBeDefined()
  await ui.press({ key: row?.key ?? '' })
  expect(await ui.find({ type: 'Text', text: /^ {4}Edited$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {8}register\.tsx \u00d72$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}Read$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}Recent: Edit \u2192 Edit \u2192 Read$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ \u25be$/ })).toBeDefined()

  await ui.press({ key: row?.key ?? '' })
  expect(await ui.find({ type: 'Text', text: /^ {4}Edited$/ })).toBeUndefined()
  await ui.unmount()
})

test('an expanded row stays within 40 columns', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  const long = '/work/claude-skills/mods/a-very-long-folder-name/with/many/levels/of/nesting/and-a-long-file-name.tsx'
  await $.tool.call({ tool: 'Edit', agentId: 'a1', file_path: long } as never)
  await $.tool.call({ tool: 'Read', agentId: 'a1', file_path: '/very/long/absolute/path/outside/the/session/folder/x.ts' } as never)
  await $.tool.call({ tool: 'mcp__plugin-authoring__scan_secrets', agentId: 'a1' } as never)
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  const row = (await ui.findAll({ type: 'Button' })).find(b => /Write render code/.test(b.text ?? ''))
  await ui.press({ key: row?.key ?? '' })
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.length).toBeGreaterThan(10)
  for (const text of texts) expect((text.text ?? '').length).toBeLessThanOrEqual(40)
  expect(await ui.find({ type: 'Text', text: /\u2026/ })).toBeDefined()
  await ui.unmount()
})

test('rows saved under the old shape are discarded', async ($, on) => {
  engine(on)
  // What agents-1 stored has no tool paths. A value under another tag reads as the initial value.
  on('state.get', { plugin: 'session-monitor', key: 'agents' }, () => ({
    value: {
      value: [
        {
          key: 'old',
          description: 'left over from agents-1',
          type: 'coder',
          status: 'running',
          startedAt: 0,
          tools: 3,
          tokens: 0,
        },
      ],
      version: 1,
    },
  }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  expect(await ui.find({ type: 'Text', text: /left over from agents-1/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /none yet/ })).toBeDefined()
  await ui.unmount()
})

test('the folder line opens a row with the full path and worktree', async ($, on) => {
  engine(on, { worktree: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  expect(await ui.find({ type: 'Text', text: /^ {2}\/work\/claude-skills$/ })).toBeUndefined()
  await ui.press({ key: 'header' })
  expect(await ui.find({ type: 'Text', text: /^ {2}\/work\/claude-skills$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}worktree$/ })).toBeDefined()
  await ui.press({ key: 'header' })
  expect(await ui.find({ type: 'Text', text: /^ {2}worktree$/ })).toBeUndefined()
  await ui.unmount()
})

test('a folder that is not a worktree shows no worktree row', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  await ui.press({ key: 'header' })
  expect(await ui.find({ type: 'Text', text: /^ {2}\/work\/claude-skills$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /worktree/ })).toBeUndefined()
  await ui.unmount()
})

// The test environment has real timers, but the API's type root names no DOM or Node.
declare const setTimeout: (fn: (...args: never[]) => void, ms: number) => unknown

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('/clear empties the Main session row and collapses every row', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: EDIT } as never)
  await $.command.run({ command: 'monitor', args: '' } as never)

  const first = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  await first.press({ key: 'row:main' })
  await first.press({ key: 'header' })
  expect(await first.find({ type: 'Text', text: /^ {4}Edited$/ })).toBeDefined()
  expect(await first.find({ type: 'Text', text: /^ {2}\/work\/claude-skills$/ })).toBeDefined()
  await first.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  expect(await ui.find({ type: 'Text', text: /^ {4}0 tools$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Edited/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}\/work\/claude-skills$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ \u25b8$/ })).toBeDefined()
  await ui.unmount()
})

test('the tool call runs before its bookkeeping write lands', async ($, on) => {
  let toolRan = false
  let ranBeforeWrite: boolean | undefined
  engine(on, {
    onTool: () => {
      toolRan = true
    },
  })
  // Hold the monitor's write until the tool has run, or give up after a short wait.
  on('state.set', { plugin: 'session-monitor', key: 'main' }, async () => {
    for (let i = 0; i < 100 && !toolRan; i++) await new Promise(r => setTimeout(r, 1))
    ranBeforeWrite = toolRan
    return { value: { isSet: true, version: 1 } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: EDIT } as never)
  await $.command.run({ command: 'monitor', args: '' } as never)

  expect(ranBeforeWrite).toBe(true)
})

test('with no agents and no room for the Main row, only "+1 more" draws', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  const tight = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    props: { ...PANE.props, bodyColumns: 40, scroll: { offset: 0, bodyRows: 16 } },
  })
  expect(await tight.find({ type: 'Text', text: /\+1 more/ })).toBeDefined()
  expect(await tight.find({ type: 'Text', text: /none yet/ })).toBeUndefined()
  await tight.unmount()

  const roomy = await $.ui.mount({ ...PANE, surface: 'terminal', props: AT_40 })
  expect(await roomy.find({ type: 'Text', text: /none yet/ })).toBeDefined()
  expect(await roomy.find({ type: 'Text', text: /\+1 more/ })).toBeUndefined()
  await roomy.unmount()
})

test('from 23 columns up the usage times are whole and no row is wider than the pane', async ($, on) => {
  const H = 3_600_000
  // Sunday 12:59pm local. The 7 day window is 4 days in at 80 percent, so it fills in 1 day
  // and resets in 3, both at 12:59pm: the longest time form, `Wed 12:59pm`.
  const NOW = new Date(2026, 10, 8, 12, 59).getTime()
  const reset = NOW + 3 * 24 * H
  const full = NOW + 24 * H
  expect(formatWeekdayTime(reset)).toBe('Wed 12:59pm')
  engine(on, {
    now: NOW,
    limits: [
      { kind: 'five_hour', percentUsed: 60, resetsAt: new Date(NOW + 3 * H).toISOString() },
      { kind: 'seven_day', percentUsed: 80, resetsAt: new Date(reset).toISOString() },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'monitor', args: '' } as never)

  for (const cols of [23, 30, 34, 36, 40]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: cols } })
    expect(await ui.find({ type: 'Text', text: new RegExp(`7d .*80%.* ${escape(formatWeekdayTime(reset))}$`) })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: new RegExp(`^ {6}(at this pace, )?full ${escape(formatWeekdayTime(full))}$`) })).toBeDefined()
    for (const text of await ui.findAll({ type: 'Text' })) {
      expect((text.text ?? '').length).toBeLessThanOrEqual(cols)
    }
    await ui.unmount()
  }
})
