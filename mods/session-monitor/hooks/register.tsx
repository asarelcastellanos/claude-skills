import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, EnvInfo, UsageSnapshot } from '../types'
import {
  bar,
  completed,
  denied,
  envLine,
  family,
  friendlyModel,
  GIT_MIN_GAP_MS,
  formatDuration,
  formatReset,
  formatTokens,
  hasRunning,
  parseGitStatus,
  limitLabel,
  resolved,
  resumed,
  severity,
  spawned,
  statusLine,
  symbol,
  toolCalled,
  truncate,
  visible,
} from './model'
import type { Severity } from './model'

const PANE = 'monitor'
const USAGE_MS = 10_000
const TICK_MS = 1000

// Change a tag when the stored fields change: it declines what an earlier
// version stored, which outlives a reload.
const agents = atom({ plugin: 'session-monitor', key: 'agents' } as const, [], {
  shape: 'agents-1',
})
const usage = atom({ plugin: 'session-monitor', key: 'usage' } as const, null, {
  shape: 'usage-1',
})
const env = atom({ plugin: 'session-monitor', key: 'env' } as const, null, {
  shape: 'env-1',
})
const clock = atom({ plugin: 'session-monitor', key: 'now' } as const, 0)

const COLOR: Record<Severity, string | undefined> = {
  ok: undefined,
  warn: 'yellow',
  crit: 'red',
}

const STATUS_COLOR: Record<AgentRow['status'], string | undefined> = {
  running: 'cyan',
  done: 'green',
  failed: 'red',
  denied: 'yellow',
  untracked: undefined,
}

// A reload runs register in a fresh environment and drops the previous
// environment's timers (reference.md, "Developing one"), so neither this
// handle nor the 10 s usage timer doubles. The next spawn starts a new tick.
let ticker: { cancel: () => void } | undefined
let isGitRunning = false

/** Folder, branch and model. Git runs at most once per GIT_MIN_GAP_MS. */
async function refreshEnv($: EngineInterface): Promise<EnvInfo> {
  const before = await read($, env)
  const now = await $.clock.now()
  const cwd = await $.session.cwd()
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop()
  let model: string | undefined = before?.model
  try {
    model = friendlyModel(await $.session.model())
  } catch {}
  let { branch, dirty, gitAt } = before ?? { branch: undefined, dirty: false, gitAt: 0 }
  if (!isGitRunning && now - gitAt >= GIT_MIN_GAP_MS) {
    isGitRunning = true
    try {
      const ran = await $.process.run(
        ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'],
        { cwd, timeoutMs: 2000 },
      )
      const info = parseGitStatus(ran.exitCode, ran.stdout)
      branch = info?.branch
      dirty = info?.dirty ?? false
    } catch {
      branch = undefined
      dirty = false
    } finally {
      isGitRunning = false
      gitAt = now
    }
  }
  const next: EnvInfo = { folder, branch, dirty, model, gitAt }
  if (JSON.stringify(before) !== JSON.stringify(next)) {
    await update($, env, () => next)
  }

  return next
}

async function refreshUsage($: EngineInterface): Promise<void> {
  const info = await refreshEnv($).catch(() => null)
  const u = await $.session.usage()
  const snap: UsageSnapshot = {
    startedAt: u.startedAt,
    contextTokens: u.context.tokens,
    contextWindow: u.context.window,
    contextPercent: u.context.percent,
    limits: u.rateLimits.map(l => ({
      kind: l.kind,
      percent: l.percentUsed,
      resetsAt: l.resetsAt === undefined ? undefined : Date.parse(l.resetsAt),
    })),
    costUsd: u.cost?.usd,
  }
  const before = await read($, usage)
  if (JSON.stringify(before) !== JSON.stringify(snap)) {
    await update($, usage, () => snap)
  }
  $.ui.status(statusLine(snap, info) || undefined)
}

/** Refresh outside the event's time bound. Git never runs inside a hook. */
function refreshLater($: EngineInterface): void {
  $.clock.after(0, () => {
    refreshUsage($).catch(() => {})
  })
}

async function isPaneVisible($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes()
  return panes.some(p => p.id === PANE && p.isPlaced)
}

function ensureTicker($: EngineInterface): void {
  if (ticker !== undefined) return
  ticker = $.clock.every(TICK_MS, () => {
    void (async () => {
      const rows = await read($, agents)
      if (!hasRunning(rows)) {
        ticker?.cancel()
        ticker = undefined
        return
      }
      // Redraw only while the pane is on screen.
      if (await isPaneVisible($)) {
        const now = await $.clock.now()
        await update($, clock, () => now)
      }
    })()
  })
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'monitor',
      description: 'Open the session monitor pane (/monitor close closes it)',
    })
    void $.ui.open({ id: PANE, title: 'Monitor' })
    refreshLater($)
    $.clock.every(USAGE_MS, () => void refreshUsage($))

    return next(e)
  })

  on('command.run', { command: 'monitor' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Monitor pane closed.' }
    }
    await refreshUsage($)
    await $.ui.open({ id: PANE, title: 'Monitor' })

    return { text: 'Monitor pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    // A resume continues an existing agent: it adds no row.
    if (e.resume !== undefined) {
      const id = e.resume.agentId
      const resumedRun = await next(e)
      if (resumedRun.deny === undefined) {
        try {
          const now = await $.clock.now()
          await update($, agents, rows =>
            resumed(rows, id, {
              description: e.description,
              type: e.subagentType,
              model: e.model ?? resumedRun.model,
              workflowIndex: e.workflow?.agentIndex,
              now,
            }),
          )
          ensureTicker($)
        } catch {}
      }

      return resumedRun
    }

    // Bookkeeping must never change or block the spawn: each write is guarded.
    const key = `${e.tool_use_id}:${crypto.randomUUID()}`
    try {
      const now = await $.clock.now()
      await update($, agents, rows =>
        spawned(rows, {
          key,
          description: e.description,
          type: e.subagentType,
          model: e.fork ? e.parentModel : e.model,
          workflowIndex: e.workflow?.agentIndex,
          now,
        }),
      )
      ensureTicker($)
    } catch {}

    let result
    try {
      result = await next(e)
    } catch (err) {
      try {
        const at = await $.clock.now()
        await update($, agents, rows => denied(rows, key, at))
      } catch {}
      throw err
    }
    try {
      if (result.deny !== undefined) {
        const at = await $.clock.now()
        await update($, agents, rows => denied(rows, key, at))
      } else {
        const { agentId, model } = result
        const at = await $.clock.now()
        await update($, agents, rows =>
          resolved(rows, key, agentId, model, at),
        )
      }
    } catch {}

    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      try {
        await update($, agents, () => [])
      } catch {}
      refreshLater($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      // Bookkeeping must never block the tool call.
      try {
        const now = await $.clock.now()
        await update($, agents, rows => toolCalled(rows, id, e.tool, now))
      } catch {}
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (e.agentId !== undefined) {
      const id = e.agentId
      const now = await $.clock.now()
      const u = e.usage
      const tokens = u
        ? u.input_tokens +
          u.output_tokens +
          u.cache_read_input_tokens +
          u.cache_creation_input_tokens
        : 0
      await update($, agents, rows =>
        completed(rows, id, e.reason, tokens, now),
      )
      }
    } catch {}
    refreshLater($)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = await read($, agents)
    const snap = await read($, usage)
    const info = await read($, env)
    const header = envLine(info)
    await read($, clock)
    const now = await $.clock.now()
    const cols = Math.max(10, e.props.bodyColumns)
    const height = e.props.scroll.bodyRows || e.viewport?.rows || 40
    const barWidth = cols >= 34 ? 10 : 6

    const limits = snap?.limits ?? []
    const fixed = 7 + Math.max(1, limits.length) + (header === '' ? 0 : 1)
    const { shown, hidden } = visible(rows, height - fixed - 1, 2)
    const running = rows.filter(r => r.status === 'running').length

    const line = (text: string, color?: string, dim = false) => (
      <Text color={color} dimColor={dim}>
        {truncate(text, cols)}
      </Text>
    )

    return (
      <Box flexDirection="column">
        {header !== '' && line(header, 'blue')}
        {line('Session', undefined, true)}
        {snap === null
          ? line('no data yet', undefined, true)
          : line(
              `${snap.costUsd === undefined ? '-' : `$${snap.costUsd.toFixed(2)}`} · ${formatDuration(now - snap.startedAt)}`,
            )}
        {line('Context', undefined, true)}
        {snap?.contextPercent === undefined
          ? line('-', undefined, true)
          : line(
              `${String(Math.round(snap.contextPercent)).padStart(3)}% ${bar(snap.contextPercent, barWidth)} ${formatTokens(snap.contextTokens ?? 0)}/${formatTokens(snap.contextWindow)}`,
              COLOR[severity(snap.contextPercent)],
            )}
        {line('Usage', undefined, true)}
        {limits.length === 0 && line('no rate limits reported', undefined, true)}
        {limits.map(l => {
          const reset = formatReset(l.resetsAt, now)
          return line(
            `${limitLabel(l.kind).padEnd(3)}${String(Math.round(l.percent)).padStart(3)}% ${bar(l.percent, barWidth)}${reset === '' ? '' : ` resets in ${reset}`}`,
            COLOR[severity(l.percent)],
          )
        })}
        {line(`Agents (${running} running, ${rows.length} total)`, undefined, true)}
        {rows.length === 0 && line('none yet', undefined, true)}
        {shown.map(r => {
          const end = r.endedAt ?? now
          const meta = [
            r.status,
            r.type,
            family(r.model),
            formatDuration(Math.max(0, end - r.startedAt)),
            `${r.tools} tools`,
            `${formatTokens(r.tokens)} tok`,
            r.status === 'running' && r.lastTool ? r.lastTool : undefined,
          ].filter(Boolean)
          const tag =
            r.workflowIndex === undefined ? '' : ` [wf#${r.workflowIndex}]`
          return (
            <Box flexDirection="column">
              {line(
                `${symbol(r.status)} ${r.description}${tag}`,
                STATUS_COLOR[r.status],
                r.status === 'untracked',
              )}
              {line(`  ${meta.join(' · ')}`, undefined, true)}
            </Box>
          )
        })}
        {hidden > 0 && line(`+${hidden} more`, undefined, true)}
      </Box>
    )
  })
}
