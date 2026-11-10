import type { CoachState } from '../types'

export const HINT_STEP_PERCENT = 20
export const MILESTONES = [25, 50, 100] as const

export const initialCoach: CoachState = {
  prompts: 0,
  lastTurnEndAt: null,
  hintedAtPercent: null,
  hint: null,
  agentTotal: 0,
  runs: {},
}

/** Context percent a hint needs: the minimum at first, then the last hint plus one step. */
export function nextHintThreshold(
  lastHintedPercent: number | null,
  minPercent: number,
): number {
  return lastHintedPercent === null
    ? minPercent
    : lastHintedPercent + HINT_STEP_PERCENT
}

export function shouldCheckContext(
  percent: number | undefined,
  minPercent: number,
  lastHintedPercent: number | null,
): boolean {
  if (percent === undefined) return false
  return percent >= nextHintThreshold(lastHintedPercent, minPercent)
}

export function isIdle(
  now: number,
  lastTurnEndAt: number | null,
  idleMinutes: number,
): boolean {
  if (lastTurnEndAt === null || idleMinutes <= 0) return false
  return now - lastTurnEndAt > idleMinutes * 60_000
}

export function parseVerdict(text: string): 'SAME' | 'NEW' | null {
  const word = text.trim().replace(/[.!"'`*\s]+$/, '').replace(/^["'`*\s]+/, '')
  const upper = word.toUpperCase()
  return upper === 'SAME' || upper === 'NEW' ? upper : null
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

export function buildClassifierPrompt(
  previousPrompts: readonly string[],
  newPrompt: string,
): string {
  const previous = previousPrompts
    .map((p, i) => `Earlier prompt ${i + 1}: ${truncate(p, 500)}`)
    .join('\n')

  return [
    'A user is working in a coding session. Decide whether their new prompt continues the same task as the earlier prompts or starts a different task.',
    '',
    previous,
    '',
    `New prompt: ${truncate(newPrompt, 1000)}`,
    '',
    'Answer with exactly one word: SAME or NEW.',
  ].join('\n')
}

/**
 * Counts one fresh workflow spawn for a run. A spawn over the cap is not
 * counted. A cap of 0 means no cap.
 */
export function recordSpawn(
  runs: Readonly<Record<string, number>>,
  runId: string,
  cap: number,
): { allowed: boolean; count: number; runs: Record<string, number> } {
  const current = runs[runId] ?? 0
  if (cap > 0 && current + 1 > cap) {
    return { allowed: false, count: current, runs: { ...runs } }
  }

  return { allowed: true, count: current + 1, runs: { ...runs, [runId]: current + 1 } }
}

/** The highest milestone passed going from prev to next, or null. */
export function crossedMilestone(prev: number, next: number): number | null {
  let hit: number | null = null
  for (const m of MILESTONES) {
    if (prev < m && next >= m) hit = m
  }

  return hit
}

export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

export function hintText(percent: number, tokens?: number): string {
  const size = tokens === undefined ? '' : ` (${formatTokens(tokens)} tokens)`

  return `New task? /clear starts fresh. Context is ${percent}% full${size}.`
}

/** The last `count` non-empty user prompts, leaving out the new prompt if it is already stored. */
export function recentUserPrompts(
  rows: readonly { role: string; text: string }[],
  newPrompt: string,
  count: number,
): string[] {
  const texts = rows
    .filter(r => r.role === 'user' && r.text.trim() !== '')
    .map(r => r.text)
  if (texts.at(-1) === newPrompt) texts.pop()

  return texts.slice(-count)
}
