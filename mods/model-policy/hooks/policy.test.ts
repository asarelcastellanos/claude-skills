import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { dayKey, decideSpawn, family, isFileWrite, mainSessionMayWrite } from './policy'

// Beneath the plugin the engine's own spawn answers with the model it was given.
function engineSpawn(on: On) {
	const seen: Array<{ model?: string }> = []
	let n = 0
	on('agent.spawn', (_, e) => {
		seen.push({ model: e.model })
		return { model: e.model ?? 'inherit', agentId: `a${++n}` }
	})
	return seen
}

const NOON = Date.UTC(2026, 10, 10, 12)
const DAY = 24 * 3600 * 1000

// The engine fills these fields on a real spawn and command. A test states them.
function spawn($: Engine, input: Record<string, unknown>) {
	const full = { tool_use_id: 't1', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: false, fork: false, ...input }
	return $.agent.spawn(full as never)
}

function turn($: Engine, usage: Record<string, unknown>, agentId?: string) {
	return $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId, usage } as never)
}

function slash($: Engine, args: string) {
	return $.command.run({ command: 'model-policy', args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } } as never)
}

// The engine's own tool answers: the call went through.
function engineTools(on: On) {
	on('tool.call', () => ({ result: {} }))
	on('env.get', (_, e) => ({ value: (e as { name?: string }).name === 'TMPDIR' ? undefined : '/Users/me' }))
	const sid = { id: 's1' }
	on('session.id', () => ({ value: sid.id }))
	on('session.end', (_, e) => ({ sessionId: e.sessionId }))
	on('session.cwd', () => ({ value: '/work/app' }))
	on('session.start', (_, e) => ({ cwd: e.cwd }))
	on('command.register', () => ({ value: { command: 'model-policy' } }))
	const statuses: Array<string | undefined> = []
	const world = { percent: undefined as number | undefined, throws: false, deny: false }
	on('session.usage', () => {
		if (world.throws) throw new Error('usage unavailable')
		const rateLimits = world.percent === undefined ? [] : [{ kind: 'five_hour', percentUsed: world.percent }]
		return { value: { startedAt: 0, rateLimits, context: { tokens: 0, window: 200_000, percent: 0 } } } as never
	})
	on('tool.check', () => (world.deny ? { decision: 'deny', reason: 'a rule beneath' } : { decision: 'allow' }))
	on('turn.complete', () => ({ text: '' }))
	// The store is a Map, so a test reads what the plugin kept and what it deleted.
	const kv = new Map<string, unknown>()
	on('store.get', (_, e) => ({ value: kv.get(e.key) }))
	on('store.set', (_, e) => {
		kv.set(e.key, JSON.parse(JSON.stringify(e.value)))
		return { value: undefined }
	})
	on('store.delete', (_, e) => {
		kv.delete(e.key)
		return { value: undefined }
	})
	on('store.keys', () => ({ value: [...kv.keys()] }))
	const clock = mock.clock(on, { now: NOON })
	on('ui.status', (_, e) => {
		statuses.push(e.text)
		return { value: undefined }
	})
	return Object.assign(statuses, { world, clock, kv, sid })
}

test('family maps model ids', () => {
	expect(family('claude-opus-4-7')).toBe('opus')
	expect(family('claude-sonnet-5-5')).toBe('sonnet')
	expect(family('claude-haiku-4-5')).toBe('haiku')
	expect(family('claude-fable-1')).toBe('fable')
	expect(family('something-else')).toBe('other')
	expect(family(undefined)).toBe('other')
})

// A. Opus only in the main session.
test('A: every fork is denied, reviews run on sonnet', () => {
	expect(decideSpawn({ fork: true, description: 'Write the parser' })).toHaveProperty('deny')
	expect(decideSpawn({ fork: true, subagentType: 'fork', description: 'Review the diff' })).toHaveProperty('deny')
	const denied = decideSpawn({ fork: true }) as { deny: string }
	expect(denied.deny).toMatch(/main session model/)
	expect(denied.deny).toMatch(/coder, scout, mechanic, or reviewer/)
	expect(decideSpawn({ description: 'Write the parser' })).toEqual({ model: 'sonnet' })
	expect(decideSpawn({ description: 'Review the diff' })).toEqual({ model: 'sonnet' })
	expect(decideSpawn({ subagentType: 'model-policy:reviewer', model: 'opus' })).toEqual({ model: 'sonnet' })
	expect(decideSpawn({ fork: true, resume: { agentId: 'a1' } })).toEqual({ allow: true })
})

test('B5: where the main session may write', () => {
	const may = (path: string, tmp = '') => mainSessionMayWrite(path, '/Users/me', '/work/app', tmp)
	expect(may('src/a.ts')).toBe(false)
	expect(may('/work/app/README.md')).toBe(true)
	expect(may('notes.TXT')).toBe(true)
	expect(may('build.log')).toBe(true)
	expect(may('/Users/me/.claude/settings.json')).toBe(true)
	expect(may('/Users/me/.claude/../x.ts')).toBe(false)
	expect(may('/Users/me/.claudex/a.ts')).toBe(false)
	expect(may('../other/a.ts')).toBe(false)
	// A .claude/ directory at any level.
	expect(may('.claude/settings.json')).toBe(true)
	expect(may('/work/app/.claude/skills/x/SKILL.json')).toBe(true)
	expect(may('/work/app/.claude')).toBe(false)
	// Temp dirs.
	expect(may('/tmp/a.ts')).toBe(true)
	expect(may('/private/tmp/claude-501/a.ts')).toBe(true)
	expect(may('/var/folders/ab/cd/T/a.ts')).toBe(true)
	expect(may('/tmp/../work/a.ts')).toBe(false)
	expect(may('/custom/tmp/a.ts')).toBe(false)
	expect(may('/custom/tmp/a.ts', '/custom/tmp')).toBe(true)
	expect(may('~/.claude/CLAUDE.json')).toBe(true)
})

test('shell write detection: writes', () => {
	const ctx = { home: '/Users/me', cwd: '/work/app' }
	const writes = [
		"sed -i 's/a/b/' file.ts",
		"sed -i.bak 's/a/b/' file.ts",
		"perl -pi -e 's/a/b/' file.ts",
		"perl -i -pe 's/a/b/' file.ts",
		"perl -pie 's/a/b/' file.ts",
		'echo hi | tee out.ts',
		'echo hi >> src/a.ts',
		'echo hi > src/a.ts',
		'cat a.ts > b.ts',
		'echo hi &> out.ts',
		'git apply fix.patch',
		'patch -p1 < fix.patch',
		'cat <<EOF > src/a.ts\nconst a = 1\nEOF',
		"python3 -c \"open('a.py','w').write('x')\"",
		"python3 -c \"from pathlib import Path; Path('a').write_text('x')\"",
		"node -e \"require('fs').writeFileSync('a.js','x')\"",
		// B4: heredoc into an interpreter, cp/mv/install/ln, normalized targets.
		"python3 - <<'PY'\nopen('a.py', 'w').write('x')\nPY",
		"node <<'JS'\nrequire('fs').writeFileSync('a.js', 'x')\nJS",
		"ruby <<EOF\nFile.write('a.rb', 'x')\nEOF",
		'cp a.ts src/b.ts',
		'mv old.ts src/new.ts',
		'cp -r a src/',
		'install -m 755 tool bin/tool',
		'ln -s a.ts src/b.ts',
		'cp -t src/ a.ts b.ts',
		'cp --target-directory=src a.ts',
		'git mv a.ts b.ts',
		'echo x > /tmp/../Users/me/repo/src/a.ts',
		'echo x > $TMPDIR/../a.ts',
		'echo x > "$OUT"',
		'grep x <<<"foo"\necho x > src/a.ts',
	]
	for (const command of writes) expect([command, isFileWrite(command, ctx)]).toEqual([command, true])
})

test('shell write detection: no false positives', () => {
	const ctx = { home: '/Users/me', cwd: '/work/app' }
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
		// B3
		'node -e "x" && git commit -m "Rewrite parser"',
		'python3 -c "import sys; sys.stdout.write(\'x\')"',
		"perl -Mstrict -e 'print 1'",
		"perl -I lib -e 'print 1'",
		'git apply --check p.diff',
		'git apply --stat p.diff',
		'npm run build | tee build.log',
		'echo $((3 > 2))',
		'[[ 3 > 2 ]]',
		'cmd > $TMPDIR/x',
		'cmd > ${TMPDIR}/x',
		'cmd > /var/folders/ab/T/x',
		'echo x > README.md',
		'echo x >> ~/.claude/notes.md',
		'echo x > .claude/settings.json',
		// B4: cp/mv to allowed places, here-string, interpreter heredoc that only prints.
		'cp a.ts /tmp/a.ts',
		'mv notes.md docs/notes.md',
		'npm install left-pad',
		'grep x <<<"foo"\necho done',
		"python3 - <<'PY'\nprint('hi')\nPY",
		"python3 - <<'PY'\nimport sys\nsys.stdout.write('x')\nPY",
	]
	for (const command of reads) expect([command, isFileWrite(command, ctx)]).toEqual([command, false])
})

test('A: spawns are rewritten to sonnet at most, workflow included, forks denied', async ($, on) => {
	const seen = engineSpawn(on)
	engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	const worker = await spawn($, { prompt: 'p', description: 'Write the parser', subagentType: 'general-purpose', model: 'opus' })
	expect(worker.model).toBe('sonnet')
	const review = await spawn($, { prompt: 'p', description: 'Check it', subagentType: 'model-policy:reviewer' })
	expect(review.model).toBe('sonnet')
	const workflow = await spawn($, {
		prompt: 'p',
		description: 'review: logic lens',
		subagentType: 'general-purpose',
		model: 'opus',
		workflow: { runId: 'wf_1', agentIndex: 1 },
	})
	expect(workflow.model).toBe('sonnet')

	expect(await spawn($, { prompt: 'p', description: 'Write it', subagentType: 'fork', fork: true })).toHaveProperty('deny')
	expect(await spawn($, { prompt: 'p', description: 'Review it', subagentType: 'fork', fork: true })).toHaveProperty('deny')
	// Denied forks never reach the engine.
	expect(seen.map(s => s.model)).toEqual(['sonnet', 'sonnet', 'sonnet'])
})

test('a resumed agent passes through untouched', async ($, on) => {
	const seen = engineSpawn(on)
	engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	const resumed = await spawn($, { prompt: 'fix it', description: 'Write it', subagentType: 'model-policy:coder', model: 'haiku', resume: { agentId: 'a1' } })
	expect(resumed).not.toHaveProperty('deny')
	const resumedFork = await spawn($, { prompt: 'fix it', description: 'Write it', subagentType: 'fork', fork: true, resume: { agentId: 'a2' } })
	expect(resumedFork).not.toHaveProperty('deny')
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
	const projectClaude = await $.tool.call({ tool: 'Write', file_path: '.claude/settings.json', content: '{}' })
	expect(projectClaude).not.toHaveProperty('deny')
	const bash = await $.tool.call({ tool: 'Bash', command: "sed -i 's/a/b/' src/a.ts" })
	expect(bash).toHaveProperty('deny')
	const bashLog = await $.tool.call({ tool: 'Bash', command: 'npm run build | tee build.log' })
	expect(bashLog).not.toHaveProperty('deny')
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
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	await turn($, { model: 'claude-sonnet-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 })

	const shown = await slash($, '')
	expect(statuses.at(-1)).toBe('policy on · sonnet 2k')
	expect(shown.text).toMatch(/sonnet\s+2k tokens\s+100%\s+cache 9k/)
})

test('Sonnet at most: haiku types and explicit haiku are kept', async ($, on) => {
	engineSpawn(on)
	engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	const model = async (input: Record<string, unknown>) => (await spawn($, { prompt: 'p', description: 'Look', subagentType: 'general-purpose', ...input })).model
	expect(await model({ subagentType: 'Explore' })).toBe('haiku')
	expect(await model({ subagentType: 'Explore', model: 'sonnet' })).toBe('sonnet')
	expect(await model({ subagentType: 'Explore', model: 'claude-sonnet-5-5' })).toBe('claude-sonnet-5-5')
	expect(await model({ subagentType: 'Explore', model: 'opus' })).toBe('haiku')
	expect(await model({ subagentType: 'model-policy:scout' })).toBe('haiku')
	expect(await model({ subagentType: 'model-policy:scout', model: 'opus' })).toBe('haiku')
	expect(await model({ subagentType: 'model-policy:mechanic', model: 'sonnet' })).toBe('sonnet')
	expect(await model({ subagentType: 'model-policy:mechanic', model: 'opus' })).toBe('haiku')
	expect(await model({ model: 'haiku' })).toBe('haiku')
	expect(await model({ model: 'claude-haiku-4-5' })).toBe('claude-haiku-4-5')
	expect(await model({ model: 'opus' })).toBe('sonnet')
	expect(await model({ subagentType: 'model-policy:coder', model: 'opus' })).toBe('sonnet')
	expect(await model({ subagentType: 'model-policy:mechanic' })).toBe('haiku')
	expect(await model({ workflow: { runId: 'wf_1', agentIndex: 1 }, model: 'haiku' })).toBe('haiku')
})

test('mechanicModel sonnet', { options: { mechanicModel: 'sonnet' } }, async ($, on) => {
	engineSpawn(on)
	engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	const run = await spawn($, { prompt: 'p', description: 'Rename', subagentType: 'model-policy:mechanic' })
	expect(run.model).toBe('sonnet')
})

test('Workflow asks the person at the confirm threshold', async ($, on) => {
	const world = engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	const check = (agentId?: string) => $.tool.check({ tool: 'Workflow', input: {}, ...(agentId ? { agentId } : {}) } as never)

	world.world.percent = 94
	expect((await check()).decision).toBe('allow')
	world.world.percent = 95
	const asked = await check()
	expect(asked.decision).toBe('ask')
	expect(asked.reason).toMatch(/95%/)
	expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)).decision).toBe('allow')
	// A failed usage read fails open: no ask.
	world.world.throws = true
	expect((await check()).decision).toBe('allow')
})

test('B2: a deny beneath the Workflow check stays a deny', async ($, on) => {
	const world = engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	const check = () => $.tool.check({ tool: 'Workflow', input: {} } as never)

	world.world.percent = 99
	world.world.deny = true
	const denied = await check()
	expect(denied.decision).toBe('deny')
	expect(denied.reason).toBe('a rule beneath')
	// Without the deny beneath, the same percent asks.
	world.world.deny = false
	expect((await check()).decision).toBe('ask')
})

test('B1: concurrent turns add up, and the day flushes to a per-session key', async ($, on) => {
	const world = engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	const usage = { model: 'claude-sonnet-5-5', input_tokens: 60, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
	await Promise.all([turn($, usage), turn($, usage), turn($, usage), turn($, usage)])
	expect((await slash($, '')).text).toMatch(/sonnet\s+400 tokens/)

	// The timer flushes within 30 seconds, and only to this session's key.
	expect([...world.kv.keys()]).toEqual([])
	await world.clock.advance(31_000)
	expect([...world.kv.keys()]).toEqual([`day-${dayKey(NOON)}-s1`])

	// A second session on the same day has its own key, and the week sums both.
	world.sid.id = 's2'
	await turn($, usage)
	await world.clock.advance(31_000)
	expect([...world.kv.keys()].sort()).toEqual([`day-${dayKey(NOON)}-s1`, `day-${dayKey(NOON)}-s2`])
	expect((await slash($, 'week')).text).toMatch(/sonnet\s+900 tokens/)
})

test('day log: rollover, 30-day pruning, and /model-policy week', async ($, on) => {
	engineSpawn(on)
	const world = engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	const run = await spawn($, { prompt: 'p', description: 'Write', subagentType: 'model-policy:coder' })
	expect(run.agentId).toBe('a1')
	await turn($, { model: 'claude-sonnet-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'a1')
	await turn($, { model: 'claude-opus-4-7', input_tokens: 400, output_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 })

	await world.clock.advance(DAY)
	await spawn($, { prompt: 'p', description: 'Write', subagentType: 'model-policy:coder' })
	await turn($, { model: 'claude-sonnet-5-5', input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'a2')

	const text = (await slash($, 'week')).text ?? ''
	expect(text).toMatch(/Last 7 days \(.* to .*\), 2 with activity/)
	expect(text).toMatch(/sonnet\s+4k tokens\s+89%/)
	expect(text).toMatch(/opus\s+500 tokens\s+11%\s+cache 2k/)
	expect(text).toMatch(/model-policy:coder\s+2 spawns\s+4k tokens\s+sonnet/)

})

test('B1: 30-day pruning keeps today and the 29 days before it', async ($, on) => {
	const world = engineTools(on)
	const at = (daysAgo: number, id: string) => `day-${dayKey(NOON - daysAgo * DAY)}-${id}`
	for (const key of [at(0, 'x'), at(29, 'x'), at(30, 'x'), at(30, 'y'), at(45, 'z')]) world.kv.set(key, { families: {}, types: {} })
	world.kv.set('unrelated', 1)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	expect([...world.kv.keys()].sort()).toEqual([at(29, 'x'), at(0, 'x'), 'unrelated'].sort())
})

test('B6: /clear flushes under the old id, then resets the session tally and agent map', async ($, on) => {
	engineSpawn(on)
	const world = engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	await spawn($, { prompt: 'p', description: 'Write', subagentType: 'model-policy:coder' })
	await turn($, { model: 'claude-sonnet-5-5', input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'a1')

	await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
	// Flushed under the ending session's id.
	expect([...world.kv.keys()]).toEqual([`day-${dayKey(NOON)}-s1`])
	// The session table starts over.
	world.sid.id = 's2'
	expect((await slash($, '')).text).toMatch(/No turns counted yet/)
	// The agent map is empty: a turn from the old agent id adds to the family but to no type.
	await turn($, { model: 'claude-sonnet-5-5', input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'a1')
	await world.clock.advance(31_000)
	const week = (await slash($, 'week')).text ?? ''
	expect(week).toMatch(/sonnet\s+150 tokens/)
	expect(week).toMatch(/model-policy:coder\s+1 spawns\s+100 tokens/)
	// Other end reasons flush but keep the tally.
	await $.session.end({ reason: 'other', sessionId: 's2', resume: {} } as never)
	expect((await slash($, '')).text).toMatch(/sonnet\s+50 tokens/)
})
