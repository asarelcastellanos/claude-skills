import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModelPolicyUsage } from '../types'
import { FAMILIES, decideSpawn, family, isFileWrite, mainSessionMayWrite } from './policy'

const NAME = 'model-policy'
const enabledAtom = atom({ plugin: 'model-policy', key: 'enabled' } as const, true)
const usageAtom = atom({ plugin: 'model-policy', key: 'usage' } as const, {} as ModelPolicyUsage)

// The tally counts input + output tokens as "tokens". Cache reads and writes are
// kept apart as "cache", because they are billed and sized differently.
function compact(n: number): string {
	if (n < 1000) return String(n)
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`
	return `${(n / 1_000_000).toFixed(1)}m`
}

function statusLine(enabled: boolean, usage: ModelPolicyUsage): string {
	const parts = FAMILIES.filter(f => (usage[f]?.tokens ?? 0) > 0).map(f => `${f} ${compact(usage[f]?.tokens ?? 0)}`)
	return [`policy ${enabled ? 'on' : 'off'}`, ...parts].join(' · ')
}

function table(enabled: boolean, usage: ModelPolicyUsage): string {
	const total = FAMILIES.reduce((sum, f) => sum + (usage[f]?.tokens ?? 0), 0)
	const rows = FAMILIES.filter(f => usage[f]).map(f => {
		const { tokens = 0, cache = 0 } = usage[f] ?? {}
		const pct = total > 0 ? Math.round((tokens / total) * 100) : 0
		return `  ${f.padEnd(7)} ${compact(tokens).padStart(7)} tokens  ${String(pct).padStart(3)}%  cache ${compact(cache)}`
	})
	return [
		`Model policy is ${enabled ? 'on' : 'off'} for this session. Use /model-policy on or /model-policy off.`,
		rows.length > 0
			? `Tokens this session (input + output; cache read + creation shown separately):\n${rows.join('\n')}`
			: 'No turns counted yet.',
	].join('\n')
}

// Hooks pass `$` to this declared function; the engine follows `$` only into top-level functions.
async function refresh($: EngineInterface): Promise<void> {
	const enabled = await read($, enabledAtom)
	const usage = await read($, usageAtom)
	$.ui.status(statusLine(enabled, usage))
}

export const register: Register = on => {
	on('session.start', async ($, e, next) => {
		await $.command.register({
			name: NAME,
			description: 'Show or toggle the Opus/Sonnet model policy: /model-policy [on|off]',
		})
		await refresh($)
		return next(e)
	})

	on('command.run', { command: NAME }, async ($, e) => {
		const arg = e.args.trim().toLowerCase()
		if (arg === 'on' || arg === 'off') await update($, enabledAtom, () => arg === 'on')
		else if (arg !== '') return { text: 'Usage: /model-policy [on|off]' }
		await refresh($)
		return { text: table(await read($, enabledAtom), await read($, usageAtom)) }
	})

	on('agent.spawn', async ($, e, next) => {
		// A resume (SendMessage to an existing agent) can only be refused, and a rewrite is logged as a failure. Leave it alone.
		if (e.resume !== undefined || !(await read($, enabledAtom))) return next(e)
		const decision = decideSpawn(e)
		if ('deny' in decision) return { deny: decision.deny }
		if ('model' in decision) return next({ ...e, model: decision.model })
		return next(e)
	}).catch(($, e, next) =>
		next.called ? next(e) : { deny: `${NAME}: the spawn check failed, so the spawn is refused.` },
	)

	on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
		// agentId is set only inside a subagent, which may write code.
		if (e.agentId !== undefined || !(await read($, enabledAtom))) return next(e)
		const path = 'notebook_path' in e ? e.notebook_path : e.file_path
		// HOME is the user's home on macOS and Linux, USERPROFILE on Windows.
		const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
		if (mainSessionMayWrite(path, home, await $.session.cwd())) return next(e)
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
		if (!isFileWrite(e.command)) return next(e)
		return {
			deny:
				`Model policy: the main session does not write code, including through the shell ` +
				`(sed -i, redirects, tee, patches). Delegate this change to the model-policy:coder agent ` +
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
			await update($, usageAtom, all => {
				const prev = all[f] ?? { tokens: 0, cache: 0 }
				return { ...all, [f]: { tokens: prev.tokens + tokens, cache: prev.cache + cache } }
			})
			await refresh($)
		}
		return next(e)
	})
}
