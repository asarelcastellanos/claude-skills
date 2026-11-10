import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CoachState } from '../types'
import {
  buildClassifierPrompt,
  crossedMilestone,
  hintText,
  initialCoach,
  isIdle,
  parseVerdict,
  recentUserPrompts,
  effectiveCap,
  recordSpawn,
  shouldCheckContext,
} from './coach'

const coach = atom({ plugin: 'session-coach', key: 'coach' } as const, initialCoach)

const MODEL_CHECK_TIMEOUT_MS = 5000

type Config = { minPercent: number; idleMinutes: number; useModelCheck: boolean }

async function coachPrompt(
  $: EngineInterface,
  cfg: Config,
  text: string,
  isCurrent: () => boolean,
): Promise<void> {
  const before = await update($, coach, (s: CoachState) => ({
    ...s,
    prompts: s.prompts + 1,
    hint: null,
  }))
  const isFirst = before.prompts <= 1
  if (isFirst) return

  const { context } = await $.session.usage()
  const percent = context.percent
  if (!shouldCheckContext(percent, cfg.minPercent, before.hintedAtPercent)) return
  if (percent === undefined) return

  const now = await $.clock.now()
  let isNew = isIdle(now, before.lastTurnEndAt, cfg.idleMinutes)

  if (!isNew && cfg.useModelCheck) {
    const rows = await $.session.messages()
    const previous = recentUserPrompts(rows, text, 3)
    if (previous.length === 0) return

    const reply = await $.model.complete({
      model: 'haiku',
      prompt: buildClassifierPrompt(previous, text),
      maxTokens: 8,
      timeoutMs: MODEL_CHECK_TIMEOUT_MS,
    })
    isNew = reply.isAnswered && parseVerdict(reply.text) === 'NEW'
  }

  if (!isNew || !isCurrent()) return

  await update($, coach, (s: CoachState) => ({
    ...s,
    hintedAtPercent: percent,
    hint: { percent, tokens: context.tokens },
  }))
  $.ui.toast(hintText(percent, context.tokens))
}

export const register: Register = (on, options) => {
  const minPercent = Number(options.clearHintMinContextPercent ?? 20)
  const idleMinutes = Number(options.idleMinutes ?? 30)
  const useModelCheck = options.useModelCheck !== false
  const cap = Number(options.workflowAgentCap ?? 12)
  const tightenAt = Number(options.tightenAtPercent ?? 80)
  const cfg: Config = { minPercent, idleMinutes, useModelCheck }

  // Bumped on every submit so a slow check for an older prompt drops its result.
  let latestPrompt = 0

  on('prompt.submit', ($, e, next) => {
    const isCountable = !e.isMeta && !e.command && !e.text.trimStart().startsWith('/')
    if (!isCountable) return next(e)

    const id = ++latestPrompt
    // A timer outlives this dispatch, so the check never delays the submit and
    // is not aborted when the hook returns. Errors are caught inside.
    $.clock.after(0, () => {
      void coachPrompt($, cfg, e.text, () => id === latestPrompt).catch(() => {})
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, coach, (s: CoachState) => ({ ...s, lastTurnEndAt: now }))
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // A resume also continues the process under another session id with no session.start.
    if (e.reason === 'clear' || e.reason === 'resume') {
      latestPrompt += 1
      await update($, coach, () => initialCoach)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { hint } = await read($, coach)
    if (e.props.hasSurvey || hint === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>{hintText(hint.percent, hint.tokens)}</Text>
      </Box>
    )
  })

  // Fails open: this is a budget, not a safety rule, so an error lets the spawn through.
  on('agent.spawn', async ($, e, next) => {
    if (e.resume) return next(e)

    let allowed = true
    let count = 0
    let prevTotal = 0
    let nextTotal = 0
    const runId = e.workflow?.runId

    let runCap = cap
    let tightenedAt: number | null = null
    if (runId !== undefined && cap > 0) {
      try {
        const { rateLimits } = await $.session.usage()
        ;({ cap: runCap, tightenedAt } = effectiveCap(cap, tightenAt, rateLimits))
      } catch {
        // A failed usage read uses the normal cap.
      }
    }

    await update($, coach, (s: CoachState) => {
      const run = runId === undefined ? null : recordSpawn(s.runs, runId, runCap)
      allowed = run === null || run.allowed
      count = run?.count ?? 0
      prevTotal = s.agentTotal
      nextTotal = allowed ? s.agentTotal + 1 : s.agentTotal

      return {
        ...s,
        agentTotal: nextTotal,
        runs: run === null ? s.runs : run.runs,
      }
    })

    if (!allowed) {
      const why =
        tightenedAt === null
          ? ''
          : ` The cap was halved from ${cap} because the 5-hour limit is at ${tightenedAt}%.`

      return {
        deny: `The workflow agent cap of ${runCap} for this run is reached (${count} agents started).${why} Finish the run with the agents already started. The user can raise workflowAgentCap in /config.`,
      }
    }

    const milestone = crossedMilestone(prevTotal, nextTotal)
    if (milestone !== null) {
      $.ui.toast(`${nextTotal} agents have run this session. Workflows are for big tasks.`)
    }

    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : next(e)))
}
