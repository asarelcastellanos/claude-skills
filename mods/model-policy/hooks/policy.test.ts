import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { decideSpawn, family, isFileWrite, isReview, mainSessionMayWrite } from './policy'

// Beneath the plugin the engine's own spawn answers with the model it was given.
function engineSpawn(on: On) {
	const seen: Array<{ model?: string }> = []
	on('agent.spawn', (_, e) => {
		seen.push({ model: e.model })
		return { model: e.model ?? 'inherit', agentId: 'a1' }
	})
	return seen
}

// The engine fills these fields on a real spawn and command. A test states them.
function spawn($: Engine, input: Record<string, unknown>) {
	const full = { tool_use_id: 't1', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: false, fork: false, ...input }
	return $.agent.spawn(full as never)
}

function slash($: Engine, args: string) {
	return $.command.run({ command: 'model-policy', args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } } as never)
}

// The engine's own tool answers: the call went through.
function engineTools(on: On) {
	on('tool.call', () => ({ result: {} }))
	on('env.get', () => ({ value: '/Users/me' }))
	on('session.cwd', () => ({ value: '/work/app' }))
	on('session.start', (_, e) => ({ cwd: e.cwd }))
	on('command.register', () => ({ value: { command: 'model-policy' } }))
	const statuses: Array<string | undefined> = []
	on('ui.status', (_, e) => {
		statuses.push(e.text)
		return { value: undefined }
	})
	return statuses
}

test('review detection', () => {
	expect(isReview({ subagentType: 'model-policy:reviewer' })).toBe(true)
	expect(isReview({ subagentType: 'security-reviewer' })).toBe(true)
	expect(isReview({ subagentType: 'general-purpose', description: 'Review the diff' })).toBe(true)
	expect(isReview({ subagentType: 'general-purpose', description: '  review: logic lens' })).toBe(true)
	expect(isReview({ subagentType: 'general-purpose', description: 'Fix reviewer notes' })).toBe(false)
	expect(isReview({ subagentType: 'general-purpose', description: 'Preview the page' })).toBe(false)
	expect(isReview({ subagentType: 'model-policy:coder', description: 'Write the parser' })).toBe(false)
})

test('family maps model ids', () => {
	expect(family('claude-opus-4-7')).toBe('opus')
	expect(family('claude-sonnet-5-5')).toBe('sonnet')
	expect(family('claude-haiku-4-5')).toBe('haiku')
	expect(family('claude-fable-1')).toBe('fable')
	expect(family('something-else')).toBe('other')
	expect(family(undefined)).toBe('other')
})

test('fork decisions', () => {
	expect(decideSpawn({ fork: true, description: 'Write the parser' })).toHaveProperty('deny')
	expect(decideSpawn({ fork: true, subagentType: 'fork', description: 'Review the diff' })).toEqual({ allow: true })
	expect(decideSpawn({ description: 'Write the parser' })).toEqual({ model: 'sonnet' })
	expect(decideSpawn({ description: 'Review the diff' })).toEqual({ model: 'opus' })
})

test('main session writes: paths', () => {
	expect(mainSessionMayWrite('src/a.ts', '/Users/me', '/work/app')).toBe(false)
	expect(mainSessionMayWrite('/work/app/README.md', '/Users/me', '/work/app')).toBe(true)
	expect(mainSessionMayWrite('notes.TXT', '/Users/me', '/work/app')).toBe(true)
	expect(mainSessionMayWrite('/Users/me/.claude/settings.json', '/Users/me', '/work/app')).toBe(true)
	expect(mainSessionMayWrite('/Users/me/.claude/../x.ts', '/Users/me', '/work/app')).toBe(false)
	expect(mainSessionMayWrite('/Users/me/.claudex/a.ts', '/Users/me', '/work/app')).toBe(false)
	expect(mainSessionMayWrite('../other/a.ts', '/Users/me', '/work/app')).toBe(false)
})

test('shell write detection: writes', () => {
	const writes = [
		"sed -i 's/a/b/' file.ts",
		"sed -i.bak 's/a/b/' file.ts",
		"perl -pi -e 's/a/b/' file.ts",
		"perl -i -pe 's/a/b/' file.ts",
		'echo hi | tee out.txt',
		'echo hi >> src/a.ts',
		'echo hi > src/a.ts',
		'cat a.ts > b.ts',
		'echo hi &> out.log',
		'git apply fix.patch',
		'patch -p1 < fix.patch',
		'cat <<EOF > src/a.ts\nconst a = 1\nEOF',
		"python3 -c \"open('a.py','w').write('x')\"",
		"node -e \"require('fs').writeFileSync('a.js','x')\"",
	]
	for (const command of writes) expect(isFileWrite(command)).toBe(true)
})

test('shell write detection: no false positives', () => {
	const reads = [
		'git commit -m "a > b"',
		"git commit -m 'use sed -i for edits'",
		'echo hi > /dev/null',
		'ls 2>&1 | head',
		'ls 2>/dev/null',
		'echo err >&2',
		'echo hi > /tmp/out.txt',
		'echo hi > "/private/tmp/claude-501/x/out.txt"',
		'echo hi | tee /tmp/out.txt',
		'cat <<EOF\na > b\nEOF',
		'grep -rn "foo" src | sed -n 1,5p',
		'npm test 2>&1 | tail -20',
		'git diff --stat',
		"python3 -c 'print(1)'",
	]
	for (const command of reads) expect(isFileWrite(command)).toBe(false)
})

test('spawns are rewritten: worker, review, fork, workflow', async ($, on) => {
	const seen = engineSpawn(on)
	engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	const worker = await spawn($, { prompt: 'p', description: 'Write the parser', subagentType: 'general-purpose', model: 'opus' })
	expect(worker.model).toBe('sonnet')

	const review = await spawn($, { prompt: 'p', description: 'Check it', subagentType: 'model-policy:reviewer' })
	expect(review.model).toBe('opus')

	// The engine raises the fork and workflow fields itself. The args type leaves them out, so cast.
	const workflow = await spawn($, {
		prompt: 'p',
		description: 'review: logic lens',
		subagentType: 'general-purpose',
		workflow: { runId: 'wf_1', agentIndex: 1 },
	})
	expect(workflow.model).toBe('opus')

	const workflowWorker = await spawn($, {
		prompt: 'p',
		description: 'implement step 2',
		subagentType: 'general-purpose',
		workflow: { runId: 'wf_1', agentIndex: 2 },
	})
	expect(workflowWorker.model).toBe('sonnet')

	const fork = await spawn($, { prompt: 'p', description: 'Write it', subagentType: 'fork', fork: true })
	expect(fork).toHaveProperty('deny')
	const reviewFork = await spawn($, { prompt: 'p', description: 'Review it', subagentType: 'fork', fork: true })
	expect(reviewFork).not.toHaveProperty('deny')

	// The allowed review fork is passed through unchanged: it inherits Opus.
	expect(seen.map(s => s.model)).toEqual(['sonnet', 'opus', 'opus', 'sonnet', undefined])
})

test('a resumed agent passes through untouched', async ($, on) => {
	const seen = engineSpawn(on)
	engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	const resumed = await spawn($, { prompt: 'fix it', description: 'Write it', subagentType: 'model-policy:coder', model: 'haiku', resume: { agentId: 'a1' } })
	expect(resumed).not.toHaveProperty('deny')
	const resumedFork = await spawn($, { prompt: 'fix it', description: 'Write it', subagentType: 'fork', fork: true, resume: { agentId: 'a2' } })
	expect(resumedFork).not.toHaveProperty('deny')
	// The engine saw the model the caller gave, unrewritten.
	expect(seen.map(s => s.model)).toEqual(['haiku', undefined])
})

test('main-loop Edit: code denied, prose allowed, subagent allowed', async ($, on) => {
	engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	const code = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
	expect(code).toHaveProperty('deny')
	const prose = await $.tool.call({ tool: 'Edit', file_path: 'README.md', old_string: 'a', new_string: 'b' })
	expect(prose).not.toHaveProperty('deny')
	const sub = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
	expect(sub).not.toHaveProperty('deny')
	const bash = await $.tool.call({ tool: 'Bash', command: "sed -i 's/a/b/' src/a.ts" })
	expect(bash).toHaveProperty('deny')
	const subBash = await $.tool.call({ tool: 'Bash', command: "sed -i 's/a/b/' src/a.ts", agentId: 'a1' })
	expect(subBash).not.toHaveProperty('deny')
})

test('/model-policy off and on toggle enforcement', async ($, on) => {
	const seen = engineSpawn(on)
	engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	const off = await slash($, 'off')
	expect(off.text).toMatch(/is off/)
	expect(await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })).not.toHaveProperty('deny')
	const spawned = await spawn($, { prompt: 'p', description: 'Write it', subagentType: 'general-purpose', model: 'opus' })
	expect(spawned.model).toBe('opus')
	expect(seen.length).toBe(1)

	const back = await slash($, 'on')
	expect(back.text).toMatch(/is on/)
	expect(await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })).toHaveProperty('deny')
})

test('turn.complete adds usage to the tally and passes the turn through', async ($, on) => {
	const statuses = engineTools(on)
	on('turn.complete', () => ({ text: '' }))
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	await $.turn.complete({
		answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer',
		usage: { model: 'claude-sonnet-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 },
	} as never)

	const shown = await slash($, '')
	expect(statuses.at(-1)).toBe('policy on · sonnet 2k')
	expect(shown.text).toMatch(/sonnet\s+2k tokens\s+100%\s+cache 9k/)
})
