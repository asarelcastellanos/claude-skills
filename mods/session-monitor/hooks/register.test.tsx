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
  on('ui.status', () => ({ value: undefined }))
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
    expect((await ui.find({ type: 'Text', text: /repo/ }))?.text).toBe(
      'repo \u00b7 main* \u00b7 Opus 5.5',
    )
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
  on('ui.status', () => ({ value: undefined }))
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
  on('ui.status', () => ({ value: undefined }))
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
  on('ui.status', () => ({ value: undefined }))
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
  expect(await ui.find({ type: 'Text', text: /0 running, 1 total/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /untracked/ })).toBeDefined()
  await ui.unmount()
})
