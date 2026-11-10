import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EnvInfo, UsageSnapshot } from '../types'

import {
  bar,
  CLAUDE_ORANGE,
  completed,
  CRAB,
  CRAB_GAP,
  CRAB_WIDTH,
  denied,
  envLine,
  familyName,
  fixedRows,
  formatDuration,
  formatReset,
  formatTokens,
  friendlyModel,
  GIT_MIN_GAP_MS,
  hasRunning,
  headerPlan,
  limitLabel,
  locationLine,
  parseGitStatus,
  policyLine,
  resolved,
  resumed,
  ruleParts,
  severity,
  severityColor,
  spawned,
  STATUS_COLOR,
  symbol,
  toolCalled,
  truncate,
  visible,
} from './model'
import type { PolicyUsage } from './model'

const PANE = 'monitor'
// Dock width requested when the pane opens. A width the person dragged to wins.
const PANE_COLUMNS = 40
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

// Reads another plugin's value: `plugin` and `key` stay literals so validate can list them.
const policyEnabled = { plugin: 'model-policy', key: 'enabled' } as const
const policyUsage = { plugin: 'model-policy', key: 'usage' } as const

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
  await refreshEnv($).catch(() => null)
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


/**
 * model-policy's tally, or undefined when that mod is not installed. The mod
 * writes `usage` at session start, so a version above 0 means it is there. The
 * reads subscribe this pane to later writes.
 */
async function readPolicy(
  $: EngineInterface,
): Promise<{ enabled: boolean; usage: PolicyUsage } | undefined> {
  try {
    const used = await $.state.get(policyUsage)
    const on = await $.state.get(policyEnabled)
    if (used.version === 0 && on.version === 0) return undefined
    return { enabled: on.value ?? true, usage: used.value ?? {} }
  } catch {
    return undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'monitor',
      description: 'Open the session monitor pane (/monitor close closes it)',
    })
    void $.ui.open({ id: PANE, title: 'Monitor', columns: PANE_COLUMNS })
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
    await $.ui.open({ id: PANE, title: 'Monitor', columns: PANE_COLUMNS })

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
    // Both leave this process running under a new session id, with no session.start.
    if (e.reason === 'clear' || e.reason === 'resume') {
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
    const policy = await readPolicy($)
    await read($, clock)
    const now = await $.clock.now()
    const cols = Math.max(10, e.props.bodyColumns)
    const height = e.props.scroll.bodyRows || e.viewport?.rows || 40
    const barWidth = cols >= 34 ? 10 : 6

    const limits = snap?.limits ?? []
    const other = fixedRows(limits.length, policy !== undefined)
    const plan = headerPlan(cols, height, other, envLine(info) !== '')
    // One more row stays free for the "+N more" line.
    const { shown, hidden } = visible(rows, height - plan.rows - other - 1, 2)
    const running = rows.filter(r => r.status === 'running').length

    const line = (text: string, color?: string, dim = false) => (
      <Text color={color} dimColor={dim}>
        {truncate(text, cols)}
      </Text>
    )
    const blank = () => <Text> </Text>
    const section = (title: string) => {
      const p = ruleParts(title, cols)
      return (
        <Text>
          <Text dimColor>{p.lead}</Text>
          <Text color={CLAUDE_ORANGE}>{p.title}</Text>
          <Text dimColor>{p.tail}</Text>
        </Text>
      )
    }
    const barRow = (lead: string, percent: number, tail: string) => {
      const color = severityColor(severity(percent))
      const b = bar(percent, barWidth)
      const after = truncate(
        ` ${String(Math.round(percent)).padStart(3)}%${tail}`,
        Math.max(0, cols - lead.length - barWidth),
      )
      return (
        <Text>
          {lead}
          <Text color={color}>{b.filled}</Text>
          <Text dimColor>{b.empty}</Text>
          <Text color={color}>{after}</Text>
        </Text>
      )
    }
    const side = cols - CRAB_WIDTH - CRAB_GAP
    const crabColor = severityColor(severity(snap?.contextPercent))
    const crabRow = (i: number, text: string, extra?: { dim?: boolean }) => (
      <Text>
        <Text color={crabColor}>{(CRAB[i] ?? '').padEnd(CRAB_WIDTH + CRAB_GAP)}</Text>
        <Text dimColor={extra?.dim}>{truncate(text, side)}</Text>
      </Text>
    )

    return (
      <Box flexDirection="column">
        {plan.kind === 'crab' ? (
          <Box flexDirection="column">
            <Text>
              <Text color={crabColor}>{(CRAB[0] ?? '').padEnd(CRAB_WIDTH + CRAB_GAP)}</Text>
              <Text color={CLAUDE_ORANGE}>{'✻ '}</Text>
              <Text bold>Claude Monitor</Text>
            </Text>
            {crabRow(1, locationLine(info))}
            {crabRow(2, info?.model ?? '', { dim: true })}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text>
              <Text color={CLAUDE_ORANGE}>{'✻ '}</Text>
              <Text bold>{truncate('Claude Monitor', cols - 2)}</Text>
            </Text>
            {envLine(info) !== '' && line(envLine(info), undefined, true)}
          </Box>
        )}
        {blank()}
        {section('Session')}
        {snap === null
          ? line('  no data yet', undefined, true)
          : line(
              `  ${snap.costUsd === undefined ? '-' : `$${snap.costUsd.toFixed(2)}`} · ${formatDuration(now - snap.startedAt)}`,
            )}
        {blank()}
        {section('Context')}
        {snap?.contextPercent === undefined
          ? line('  -', undefined, true)
          : barRow(
              '  ',
              snap.contextPercent,
              `   ${formatTokens(snap.contextTokens ?? 0)} / ${formatTokens(snap.contextWindow)}`,
            )}
        {blank()}
        {section('Usage')}
        {limits.length === 0 && line('  no rate limits reported', undefined, true)}
        {limits.map(l => {
          const reset = formatReset(l.resetsAt, now)
          return barRow(
            `  ${limitLabel(l.kind).padEnd(2)}  `,
            l.percent,
            reset === '' ? '' : `  resets ${reset}`,
          )
        })}
        {blank()}
        {policy !== undefined && (
          <Box flexDirection="column">
            {section('Policy')}
            {line(`  ${policyLine(policy.enabled, policy.usage)}`)}
            {blank()}
          </Box>
        )}
        {section(`Agents · ${running} running · ${rows.length} total`)}
        {rows.length === 0 && line('  none yet', undefined, true)}
        {shown.map(r => {
          const meta = [
            r.type,
            familyName(r.model),
            formatDuration(Math.max(0, (r.endedAt ?? now) - r.startedAt)),
            `${r.tools} tools`,
          ]
          const tag =
            r.workflowIndex === undefined ? '' : ` [wf#${r.workflowIndex}]`
          return (
            <Box flexDirection="column">
              <Text dimColor={r.status === 'untracked'}>
                <Text color={STATUS_COLOR[r.status]}>
                  {`  ${symbol(r.status, now)} `}
                </Text>
                {truncate(`${r.description}${tag}`, cols - 4)}
              </Text>
              {line(`    ${meta.join(' · ')}`, undefined, true)}
            </Box>
          )
        })}
        {hidden > 0 && line(`  +${hidden} more`, undefined, true)}
      </Box>
    )
  })
}
