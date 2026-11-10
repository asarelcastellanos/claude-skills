import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModelPolicyDay, ModelPolicyPick, ModelPolicyUsage } from '../types'
import {
	FAMILIES,
	PICK_LABELS,
	addSpawn,
	addTurn,
	compact,
	dateOfKey,
	dayKey,
	dayStoreKey,
	decideSpawn,
	emptyDay,
	family,
	fiveHourPercent,
	formatWeek,
	isFileWrite,
	mainSessionMayWrite,
	mergeDay,
	pickFromAnswer,
	staleKeys,
} from './policy'

const NAME = 'model-policy'
const FLUSH_MS = 30_000
const enabledAtom = atom({ plugin: 'model-policy', key: 'enabled' } as const, true)
const usageAtom = atom({ plugin: 'model-policy', key: 'usage' } as const, {} as ModelPolicyUsage)
const agentsAtom = atom({ plugin: 'model-policy', key: 'agents' } as const, {} as Record<string, string>)
const daysAtom = atom({ plugin: 'model-policy', key: 'days' } as const, {} as Record<string, ModelPolicyDay>)
const pickedAtom = atom({ plugin: 'model-policy', key: 'picked' } as const, null as ModelPolicyPick | null)

// What the last flush wrote, so an idle timer tick writes nothing.
let lastFlushed = ''

// Set while a continuing session.end resets the tally and writes the snapshot. In that window
// $.session.id() still returns the old id, so a flush would write the new tally under the old key.
let ending = false

function table(enabled: boolean, usage: ModelPolicyUsage): string {
	const total = FAMILIES.reduce((sum, f) => sum + (usage[f]?.tokens ?? 0), 0)
	const rows = FAMILIES.filter(f => usage[f]).map(f => {
		const { tokens = 0, cache = 0 } = usage[f] ?? {}
		const pct = total > 0 ? Math.round((tokens / total) * 100) : 0
		return `  ${f.padEnd(7)} ${compact(tokens).padStart(7)} tokens  ${String(pct).padStart(3)}%  cache ${compact(cache)}`
	})
	return [
		`Model policy is ${enabled ? 'on' : 'off'} for this session. Use /model-policy on, off, or week.`,
		rows.length > 0
			? `Tokens this session (input + output; cache read + creation shown separately):\n${rows.join('\n')}`
			: 'No turns counted yet.',
	].join('\n')
}

// The five-hour percent used, or undefined when the read fails or the window is absent.
// A failed read fails open on purpose: with no reading no Workflow is held for confirmation.
async function fiveHour($: EngineInterface): Promise<number | undefined> {
	try {
		return fiveHourPercent((await $.session.usage()).rateLimits)
	} catch {
		return undefined
	}
}

async function prune($: EngineInterface, today: string): Promise<void> {
	for (const key of staleKeys(await $.store.keys(), today)) await $.store.delete(key)
}

// The session's tally lives in $.state, where `update` is atomic, so concurrent turns never overwrite
// each other. This is the one place that copies it to $.store, under a key only this session writes.
async function flush($: EngineInterface, sessionId: string): Promise<void> {
	const days = await read($, daysAtom)
	const signature = sessionId + JSON.stringify(days)
	if (signature === lastFlushed) return
	for (const [date, log] of Object.entries(days)) await $.store.set(dayStoreKey(date, sessionId), log)
	lastFlushed = signature
	await prune($, dayKey(await $.clock.now()))
}

// The timer's callback. A failed flush must not stop the interval.
async function tick($: EngineInterface): Promise<void> {
	try {
		if (!ending) await flush($, await $.session.id())
	} catch {
		// The next tick tries again.
	}
}

async function week($: EngineInterface): Promise<string> {
	if (!ending) await flush($, await $.session.id())
	const today = dayKey(await $.clock.now())
	const days: Record<string, ModelPolicyDay> = {}
	for (const key of await $.store.keys()) {
		const date = dateOfKey(key)
		const log = date === undefined ? undefined : ((await $.store.get(key)) as ModelPolicyDay | undefined)
		if (date !== undefined && log) days[date] = mergeDay(days[date] ?? emptyDay(), log)
	}
	return formatWeek(today, days)
}

// Asks which main model to use and switches to it. Closing the question, a -p run, and any failure
// leave the model as it is. It never throws, so nothing waits on it and nothing breaks if it fails.
async function askModel($: EngineInterface): Promise<void> {
	try {
		// A session that already has prompts was resumed, so it keeps its own model.
		if ((await $.session.turns()) > 0) return
		const answer = await $.ui.ask('Which model should this session use?', { options: PICK_LABELS, header: 'Model' })
		const pick = pickFromAnswer(answer)
		if (pick === undefined) return
		await $.command.run({ command: 'model', args: pick })
		await update($, pickedAtom, () => pick)
	} catch {
		// Dismissed, no one to ask, or the switch failed: keep the current model.
	}
}

// A copy that `update` may change: its callback can run again on a version miss.
function copyDays(all: Record<string, ModelPolicyDay>): Record<string, ModelPolicyDay> {
	return JSON.parse(JSON.stringify(all)) as Record<string, ModelPolicyDay>
}

export const register: Register = (on, options) => {
	const mechanicModel = String(options.mechanicModel ?? 'haiku')
	const confirmAt = Number(options.workflowConfirmAtPercent ?? 95)
	const askAtStart = options.askModelAtStart !== false

	on('session.start', async ($, e, next) => {
		await $.command.register({
			name: NAME,
			description: 'Show or toggle the model policy: /model-policy [on|off|week]',
		})
		await prune($, dayKey(await $.clock.now()))
		$.clock.every(FLUSH_MS, () => void tick($))
		// Writing the tally back unchanged is the first write to `usage`. session-monitor reads that
		// version to learn this mod is installed before it draws its Policy section. A failed write
		// only hides that section: the timer above is already set and the session starts.
		try {
			await update($, usageAtom, usage => usage)
		} catch {
			// The first turn writes `usage` again.
		}
		// The dialog waits on the person, so it is not awaited: the session starts without it.
		if (askAtStart) void askModel($)
		return next(e)
	})

	// After /clear and on a resume the process goes on under another session id with no session.start.
	// The old tally is taken and the atoms are emptied in one atomic update each, so a turn that lands
	// meanwhile goes to the old snapshot or to the new tally, never to neither. The snapshot is then
	// written under the ending id. The reset does not wait on the store write. next(e) comes last and fast.
	on('session.end', async ($, e, next) => {
		const continues = e.reason === 'clear' || e.reason === 'resume'
		if (!continues) {
			try {
				await flush($, e.sessionId)
			} catch {
				// Ending the session matters more than the last tally.
			}
			return next(e)
		}
		ending = true
		try {
			let snapshot: Record<string, ModelPolicyDay> = {}
			try {
				await update($, daysAtom, old => {
					snapshot = old
					return {}
				})
				await update($, usageAtom, () => ({}))
				await update($, agentsAtom, () => ({}))
				// A clear keeps the model, so it keeps the pick. A resumed session brings its own model.
				if (e.reason === 'resume') await update($, pickedAtom, () => null)
				lastFlushed = ''
			} catch {
				// Fall through to the write: the old tally still belongs to the ending session.
			}
			try {
				for (const [date, log] of Object.entries(snapshot)) await $.store.set(dayStoreKey(date, e.sessionId), log)
				await prune($, dayKey(await $.clock.now()))
			} catch {
				// A failed write loses this tally only.
			}
		} finally {
			ending = false
		}
		return next(e)
	})

	on('command.run', { command: NAME }, async ($, e) => {
		const arg = e.args.trim().toLowerCase()
		if (arg === 'week') return { text: await week($) }
		if (arg === 'on' || arg === 'off') await update($, enabledAtom, () => arg === 'on')
		else if (arg !== '') return { text: 'Usage: /model-policy [on|off|week]' }
		return { text: table(await read($, enabledAtom), await read($, usageAtom)) }
	})

	on('agent.spawn', async ($, e, next) => {
		// A resume can only be refused and a rewrite is logged as a failure, so it passes untouched.
		if (e.resume !== undefined || !(await read($, enabledAtom))) return next(e)
		const mainPick = (await read($, pickedAtom)) ?? undefined
		const decision = decideSpawn(e, { mechanicModel, mainPick })
		if ('deny' in decision) return { deny: decision.deny }
		const ran = 'model' in decision ? await next({ ...e, model: decision.model }) : await next(e)
		if ('deny' in ran) return ran
		// Logging must never change the spawn. A failure here only loses a log line.
		try {
			if (ran.agentId !== undefined) {
				const id = ran.agentId
				const type = e.subagentType
				const date = dayKey(await $.clock.now())
				await update($, agentsAtom, all => ({ ...all, [id]: type }))
				await update($, daysAtom, all => {
					const copy = copyDays(all)
					copy[date] = addSpawn(copy[date] ?? emptyDay(), type, family(ran.model))
					return copy
				})
			}
		} catch {
			// Fall through.
		}
		return ran
	}).catch(($, e, next) =>
		next.called ? next(e) : { deny: `${NAME}: the spawn check failed, so the spawn is refused.` },
	)

	on('tool.check', { tool: 'Workflow' }, async ($, e, next) => {
		// The verdict beneath comes first: a deny there stays a deny.
		const verdict = await next(e)
		if (verdict.decision === 'deny') return verdict
		if (e.agentId !== undefined || !(await read($, enabledAtom))) return verdict
		const percent = await fiveHour($)
		if (percent === undefined || percent < confirmAt) return verdict
		// An ask puts the call to the person, who sees this reason in the permission prompt.
		return {
			decision: 'ask',
			reason: `Model policy: the 5-hour usage limit is at ${Math.round(percent)}%. A Workflow starts many agents. Confirm to start it.`,
		}
	}).catch(($, e, next) =>
		next.called ? next(e) : { decision: 'deny', reason: `${NAME}: the Workflow check failed, so the call is refused.` },
	)

	on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
		// agentId is set only inside a subagent, which may write code.
		if (e.agentId !== undefined || !(await read($, enabledAtom))) return next(e)
		const path = 'notebook_path' in e ? e.notebook_path : e.file_path
		// HOME is the user's home on macOS and Linux, USERPROFILE on Windows.
		const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
		const tmpdir = (await $.env.get('TMPDIR')) ?? ''
		if (mainSessionMayWrite(path, home, await $.session.cwd(), tmpdir)) return next(e)
		return {
			deny:
				`Model policy: the main session plans and reviews, it does not write code. ` +
				`Delegate this change to the model-policy:coder agent with a precise spec ` +
				`(files, intended behavior, checks to run). Blocked path: ${path}`,
		}
	}).catch(($, e, next) =>
		next.called ? next(e) : { deny: `${NAME}: the write check failed, so the write is refused.` },
	)

	on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
		if (e.agentId !== undefined || !(await read($, enabledAtom))) return next(e)
		const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
		const tmpdir = (await $.env.get('TMPDIR')) ?? ''
		if (!isFileWrite(e.command, { home, cwd: await $.session.cwd(), tmpdir })) return next(e)
		return {
			deny:
				`Model policy: the main session does not write code, including through the shell ` +
				`(sed -i, redirects, tee, cp, mv, patches). Delegate this change to the model-policy:coder agent ` +
				`with a precise spec. Blocked command: ${e.command.slice(0, 200)}`,
		}
	}).catch(($, e, next) =>
		next.called ? next(e) : { deny: `${NAME}: the shell check failed, so the command is refused.` },
	)

	on('turn.complete', async ($, e, next) => {
		const usage = e.usage
		if (usage) {
			const f = family(usage.model)
			const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
			const cache = (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
			const date = dayKey(await $.clock.now())
			const type = e.agentId === undefined ? undefined : (await read($, agentsAtom))[e.agentId]
			await update($, usageAtom, all => {
				const prev = all[f] ?? { tokens: 0, cache: 0 }
				return { ...all, [f]: { tokens: prev.tokens + tokens, cache: prev.cache + cache } }
			})
			await update($, daysAtom, all => {
				const copy = copyDays(all)
				copy[date] = addTurn(copy[date] ?? emptyDay(), f, tokens, cache, type)
				return copy
			})
		}
		return next(e)
	})
}
