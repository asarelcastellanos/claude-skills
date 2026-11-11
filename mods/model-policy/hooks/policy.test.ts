import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PICK_LABELS, dayKey, decideSpawn, family, isDocPath, isFileWrite, mainSessionMayWrite, pickFromAnswer } from './policy'

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
	const world = {
		percent: undefined as number | undefined,
		throws: false,
		deny: false,
		failSet: false,
		onSet: undefined as undefined | (() => Promise<unknown>),
	}
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
	on('store.set', async (_, e) => {
		if (world.failSet) throw new Error('store is full')
		await world.onSet?.()
		kv.set(e.key, JSON.parse(JSON.stringify(e.value)))
		return { value: undefined }
	})
	on('store.delete', (_, e) => {
		kv.delete(e.key)
		return { value: undefined }
	})
	on('store.keys', () => ({ value: [...kv.keys()] }))
	const clock = mock.clock(on, { now: NOON })
	// The mod no longer sets a status line: a call here is recorded so a test can assert none came.
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
	expect(may('/work/app/README.md')).toBe(false)
	expect(may('notes.TXT')).toBe(false)
	expect(may('guide.mdx')).toBe(false)
	expect(may('guide.markdown')).toBe(false)
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
	// Prose is blocked everywhere, temp dirs and .claude/ directories included.
	expect(may('/tmp/plan.md')).toBe(false)
	expect(may('/Users/me/.claude/CLAUDE.md')).toBe(false)
	expect(may('.claude/skills/x/SKILL.md')).toBe(false)
	// The auto-memory directory is the one exception.
	expect(may('/Users/me/.claude/projects/-Users-me-app/memory/MEMORY.md')).toBe(true)
	expect(may('~/.claude/projects/-Users-me-app/memory/note.md')).toBe(true)
	expect(may('/Users/me/.claude/projects/-Users-me-app/memory/sub/note.txt')).toBe(true)
	expect(may('/Users/me/.claude/projects/a/memory/../../b/c.md')).toBe(false)
	expect(may('/Users/me/.claude/projects/-Users-me-app/notes.md')).toBe(false)
	expect(may('/Users/me/.claude/projects/memory/MEMORY.md')).toBe(false)
	expect(may('/Users/me/.claude/projects/a/b/memory/x.md')).toBe(false)
	expect(may('/Users/other/.claude/projects/a/memory/x.md')).toBe(false)
	expect(may('/work/app/.claude/projects/a/memory/x.md')).toBe(false)
	expect(mainSessionMayWrite('~/.claude/projects/a/memory/x.md', '', '/work/app')).toBe(false)
})

test('isDocPath: Markdown and plain-text files', () => {
	expect(isDocPath('README.md', '/Users/me', '/work/app')).toBe(true)
	expect(isDocPath('~/.claude/projects/a/memory/x.MD', '/Users/me', '/work/app')).toBe(true)
	expect(isDocPath('docs/a.txt', '/Users/me', '/work/app')).toBe(true)
	expect(isDocPath('src/a.ts', '/Users/me', '/work/app')).toBe(false)
	expect(isDocPath('build.log', '/Users/me', '/work/app')).toBe(false)
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
		// Round 2: each simple command is judged alone.
		'git apply --check p.diff && git apply p.diff',
		'patch --dry-run -p1 < p && patch -p1 < p',
		'cp a src/b.ts > /dev/null',
		'make | tee /tmp/out.log && cp a src/b.ts',
		'echo $((1<<n))\ncat > src/a.ts',
		'git commit -m "note: cat <<EOF"\ncat > src/a.ts',
		'ls; sed -i s/a/b/ f.ts',
		'echo $(sed -i s/a/b/ f.ts)',
		'FOO=1 sudo sed -i s/a/b/ f.ts',
		'(cp a src/b.ts)',
		// Prose is not written from the shell, except in the memory directory.
		'echo x > README.md',
		'echo x >> ~/.claude/notes.md',
		'echo x > /tmp/out.txt',
		'echo x | tee /tmp/plan.md',
		'mv notes.md docs/notes.md',
		'cp a.txt /tmp/b.txt',
		'echo x > ~/.claude/projects/-Users-me-app/notes.md',
		'echo x > /work/app/.claude/projects/a/memory/x.md',
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
		'echo hi > /tmp/out.log',
		'echo hi > "/private/tmp/claude-501/x/out.log"',
		'echo hi | tee /tmp/out.log',
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
		'echo x >> ~/.claude/projects/-Users-me-app/memory/MEMORY.md',
		'echo x > ~/.claude/projects/-Users-me-app/memory/note.md',
		'echo x > .claude/settings.json',
		// B4: cp/mv to allowed places, here-string, interpreter heredoc that only prints.
		'cp a.ts /tmp/a.ts',
		'mv notes.md /tmp/notes.log',
		'npm install left-pad',
		'grep x <<<"foo"\necho done',
		"python3 - <<'PY'\nprint('hi')\nPY",
		"python3 - <<'PY'\nimport sys\nsys.stdout.write('x')\nPY",
		// Round 2: redirects are not arguments.
		'make | tee out.log > /dev/null',
		'make | tee /tmp/out.log 2>&1',
		'cp a /tmp/b 2>/dev/null',
		'cp a.txt /tmp/b.log 2>&1',
		'git apply --check p.diff && git apply --stat p.diff',
		'patch --dry-run -p1 < p',
		'echo $((1<<n))\ncat > /tmp/a.ts',
		'git commit -m "note: cat <<EOF"\necho done',
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

test('main-loop Edit: code and prose denied, memory allowed, subagent allowed', async ($, on) => {
	engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	const code = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
	expect(code).toHaveProperty('deny')
	const prose = await $.tool.call({ tool: 'Edit', file_path: 'README.md', old_string: 'a', new_string: 'b' })
	expect(prose).toHaveProperty('deny')
	const reason = (prose as { deny: string }).deny
	expect(reason).toMatch(/model-policy:coder/)
	expect(reason).toMatch(/outline/)
	expect(reason).toMatch(/model-policy:mechanic/)
	const proseWrite = await $.tool.call({ tool: 'Write', file_path: 'docs/plan.txt', content: 'x' })
	expect(proseWrite).toHaveProperty('deny')
	const memory = await $.tool.call({ tool: 'Write', file_path: '/Users/me/.claude/projects/-work-app/memory/MEMORY.md', content: 'x' })
	expect(memory).not.toHaveProperty('deny')
	const memoryTilde = await $.tool.call({ tool: 'Edit', file_path: '~/.claude/projects/-work-app/memory/note.md', old_string: 'a', new_string: 'b' })
	expect(memoryTilde).not.toHaveProperty('deny')
	const bashMemory = await $.tool.call({ tool: 'Bash', command: 'echo x >> ~/.claude/projects/-work-app/memory/MEMORY.md' })
	expect(bashMemory).not.toHaveProperty('deny')
	const subProse = await $.tool.call({ tool: 'Edit', file_path: 'README.md', old_string: 'a', new_string: 'b', agentId: 'a1' })
	expect(subProse).not.toHaveProperty('deny')
	const subProseWrite = await $.tool.call({ tool: 'Write', file_path: 'docs/plan.md', content: 'x', agentId: 'a1' })
	expect(subProseWrite).not.toHaveProperty('deny')
	const bashProse = await $.tool.call({ tool: 'Bash', command: 'echo x > README.md' })
	expect(bashProse).toHaveProperty('deny')
	expect((bashProse as { deny: string }).deny).toMatch(/model-policy:coder/)
	const subBashProse = await $.tool.call({ tool: 'Bash', command: 'echo x > README.md', agentId: 'a1' })
	expect(subBashProse).not.toHaveProperty('deny')
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
	expect(statuses).toEqual([])
	expect(shown.text).toMatch(/sonnet\s+2k tokens\s+100%\s+cache 9k/)
})

test('session.start writes usage once, so other plugins can tell the mod is installed', async ($, on) => {
	const statuses = engineTools(on)
	const writes: Array<{ plugin: string; key: string; value: unknown }> = []
	on('state.set', (_, e) => {
		writes.push({ plugin: e.plugin, key: e.key, value: e.value })
		return { value: { isSet: true, version: writes.length } }
	})

	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

	expect(writes).toEqual([{ plugin: 'model-policy', key: 'usage', value: {} }])
	expect(statuses).toEqual([])
})

test('a failed first write to usage still starts the flush timer and the session', async ($, on) => {
	const world = engineTools(on)
	// A small state store whose writes fail until the test lets them through.
	const held = new Map<string, { value: unknown; version: number }>()
	let failing = true
	on('state.get', (_, e) => ({ value: held.get(`${e.plugin}/${e.key}`) ?? { value: undefined, version: 0 } }))
	on('state.set', (_, e) => {
		// Every write misses its version, so `update` gives up and throws.
		if (failing) return { value: { isSet: false, version: 99 } }
		const version = (held.get(`${e.plugin}/${e.key}`)?.version ?? 0) + 1
		held.set(`${e.plugin}/${e.key}`, { value: e.value, version })
		return { value: { isSet: true, version } }
	})

	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	failing = false
	await turn($, { model: 'claude-sonnet-5-5', input_tokens: 60, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
	// Only the timer flushes the day to the store.
	await world.clock.advance(31_000)

	expect([...world.kv.keys()].some(k => k.startsWith('day-'))).toBe(true)
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

test('session.end: a turn landing during the store write is not lost', async ($, on) => {
	const world = engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	const usage = (n: number) => ({ model: 'claude-sonnet-5-5', input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
	await turn($, usage(100))

	let injected = false
	world.world.onSet = async () => {
		if (injected) return
		injected = true
		await turn($, usage(50))
	}
	await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
	world.world.onSet = undefined
	// The old key holds the snapshot taken at the reset. The turn that landed after it is in the new tally.
	expect((world.kv.get(`day-${dayKey(NOON)}-s1`) as { families: { sonnet: { tokens: number } } }).families.sonnet.tokens).toBe(100)
	expect((await slash($, '')).text).toMatch(/sonnet\s+50 tokens/)
	world.sid.id = 's2'
	expect((await slash($, 'week')).text).toMatch(/sonnet\s+150 tokens/)
})

test('session.end: a failed store write still resets the tally', async ($, on) => {
	const world = engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	await turn($, { model: 'claude-sonnet-5-5', input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
	world.world.failSet = true
	await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
	world.world.failSet = false
	expect([...world.kv.keys()]).toEqual([])
	expect((await slash($, '')).text).toMatch(/No turns counted yet/)
})

test('session.end: resume resets and the week does not double count', async ($, on) => {
	const world = engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	const usage = (n: number) => ({ model: 'claude-sonnet-5-5', input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
	await turn($, usage(100))
	await $.session.end({ reason: 'resume', sessionId: 's1', resume: {} } as never)
	world.sid.id = 's2'
	expect((await slash($, '')).text).toMatch(/No turns counted yet/)
	expect((await slash($, 'week')).text).toMatch(/sonnet\s+100 tokens/)
	await turn($, usage(50))
	expect((await slash($, 'week')).text).toMatch(/sonnet\s+150 tokens/)
})

// Table-driven regression: commands a reviewer ran against isFileWrite, with the expected verdict.
// Known gaps are left out on purpose (sh -c, dd of=, curl -o, wget -O, sponge, truncate, rsync, ed, git checkout/restore).
const SHELL_CTX = { home: '/Users/a', cwd: '/Users/a/proj', tmpdir: '/var/folders/x/T' }

const SHELL_BLOCKED: string[] = [
	"echo hi > src/a.ts",
	"cat <<EOF > a.ts\nx\nEOF",
	"cat > a.ts <<EOF\nx\nEOF",
	"cat >a.ts",
	"echo x >| a.ts",
	"echo x >>a.ts",
	"tee a.ts < in",
	"echo x | tee -a a.ts",
	"cp a b.ts",
	"cp -r a b",
	"git mv a.ts b.ts",
	"sed -i \"\" s/a/b/ f.ts",
	"sed -i.bak s/a/b/ f.ts",
	"echo x &> a.ts",
	"FOO=1 echo x > a.ts",
	"if true; then echo x > a.ts; fi",
	"(echo x > a.ts)",
	"echo $(echo x > a.ts)",
	"echo `echo x > a.ts`",
	"true && echo x > a.ts",
	"echo x 2> a.ts",
	"echo x 1>a.ts",
	"python3 - <<EOF\nopen(\"a.py\",\"w\").write(\"x\")\nEOF",
	"python3 -c \"open('a.py','w').write('x')\"",
	"node -e \"require('fs').writeFileSync('a.js','x')\"",
	"cat <<EOF >a.ts\n$(echo hi)\nEOF",
	"cat <<\"EOF\" > a.ts\nx\nEOF",
	"printf x > \"a.ts\"",
	"printf x > 'a b.ts'",
	"echo x > ${HOME}/a.ts",
	"echo x > ~/a.ts",
	"echo x>a.ts",
	"echo x > /tmp/../etc/a.ts",
	"echo x > /tmp/../Users/a/a.ts",
	"curl http://x > a.ts",
	"awk '{print}' f > a.ts",
	"mv a.ts b.ts",
	"sed -i -e s/a/b/ f.ts",
	"echo x | tee a.ts b.md",
	"exec > a.ts",
	"echo hi >/tmp/a; echo x > a.ts",
	"cat <<EOF > /tmp/a\nx\nEOF\necho x > a.ts",
	"echo \"a\" > a.ts # c",
	"echo x >a.ts&",
	"ls &&echo x>a.ts",
	"cat a.ts | sed \"s/a/b/\" > b.ts",
	"time cp a b.ts",
	"xargs -I{} cp {} b.ts",
	"echo x >\\\na.ts",
	"echo x > a\\ b.ts",
	"echo \"x\" >\"a.ts\"",
	"echo x > $HOME/a.ts",
	"echo x > .claude.ts",
	"echo x > .claude/../a.ts",
	"echo x > foo.md.ts",
	"echo x > a.ts.log/b.ts",
	"echo x > src/.claude/x/../../a.ts",
	"cat <<EOF\nhi\nEOF\necho x > a.ts",
	"cat <<EOF | tee a.ts\nhi\nEOF",
	"echo a<<b >c.ts",
	"echo $((1<<2)) > a.ts",
	"echo \"#\" > a.ts",
	"echo x #\n echo y > a.ts",
	"echo a#b > a.ts",
	"case x in x) echo y > a.ts;; esac",
	"for f in a; do echo y > $f.ts; done",
	"find . -name x -exec cp {} b.ts ;",
	"echo x > /tmp.ts",
	"echo x > /tmpfoo/a.ts",
	"ln -s a b.ts",
	"install -m 644 a b.ts",
	"cp a.ts b/",
	"cp -t dir a.ts",
	"git apply p.diff",
	"git -C x apply p.diff",
	"echo x > a.ts 2>&1",
	"echo x 2>&1 > a.ts",
	"echo x >&2 > a.ts",
	"echo x >&a.ts",
	"sed -n 1p a.ts > b.ts",
	"jq . a.json > b.json",
	"echo x > a.json",
	"echo x > Makefile",
	"echo \"$(cat <<EOF\nx\nEOF\n)\" > a.ts",
	"perl -pi -e s/a/b/ a.ts",
	"echo x > \"$f\"",
	"echo x > $f",
	"echo \"$(echo x > a.ts)\"",
	"x=\"$(cat a > b.ts)\"",
	"echo \"`echo x > a.ts`\"",
	"find . -name \"*.ts\" -exec sed -i s/a/b/ {} +",
	"find . -name \"*.ts\" -exec sed -i \"\" s/a/b/ {} ;",
	"for f in a; do echo x; done > a.ts",
	"{ echo x; } > a.ts",
	"echo x >| a.ts",
	"echo x>|a.ts",
	"cat > \"a b.ts\"",
	"echo x > a.ts\\\n",
	"echo x \\\n > a.ts",
	"cat <<EOF > a.ts\nx\nEOF\n",
	"cat <<-EOF > a.ts\n\tx\n\tEOF",
	"echo x > $TMPDIRx/a.ts",
	"cat <<EOF\nx\nEOF\n> a.ts",
	"tee -a a.ts <<EOF\nx\nEOF",
	"cat <<EOF | python3 -\nopen(\"a.py\",\"w\")\nEOF",
	"python3 <<EOF\nopen(\"a.py\",\"w\")\nEOF",
	"python3 <<EOF >/tmp/x\nopen(\"a.py\",\"w\")\nEOF",
	"cat <<EOF > a.ts\n\"\nEOF\necho ok",
	"echo \"it's\" > a.ts",
	"echo x > a.ts # > /tmp/x",
	"echo x # y\necho z > a.ts",
	"echo $# > a.ts",
	"echo ${#a} > a.ts",
	"echo $#; echo x > a.ts",
	"cp a.ts b.ts 2>/dev/null",
	"cp -p a.ts b.ts",
	"cp --target-directory=src a.ts",
	"cp -- a.ts b.ts",
	"mv -f a.ts b.ts",
	"sudo tee a.ts",
	"env FOO=1 tee a.ts",
	"tee -- a.ts",
	"echo x | tee /dev/null a.ts",
	"git -C dir mv a.ts b.ts",
	"git -c core.x=1 apply p.diff",
	"git --no-pager apply p.diff",
	"echo x > a.ts; git apply --check p",
	"sed -E -i s/a/b/ a.ts",
	"sed -ni 1p a.ts",
	"sed --in-place=.bak s/a/b/ a.ts",
	"sed -e \"s/i/j/\" -i a.ts",
	"perl -i -pe 1 a.ts",
	"patch -p1 < x.diff",
	"echo x > a.md.bak",
	"echo x > file.TXT",
	"git diff > p.txt",
	"cat > notes.md <<EOF\nhello\nEOF",
	"cat <<EOF > docs/a.md\nx\nEOF",
	"echo x > a.md",
	"echo x > A.MD",
	"cp a.ts b.md",
	"printf \"%s\\n\" a >> notes.txt",
	"echo x > .claude",
	"echo x > \"/tmp/a b.ts\"",
	"git commit -m \"x\" && echo y > a.ts",
	"echo $(( 1 > 0 )) > a.ts",
	"echo x > a.ts &",
	"echo x > a.ts|cat",
	"make 2> err.ts",
	"cmd 2>>a.ts",
	"cmd 2>a.ts",
	"cmd 2> /dev/null > a.ts",
	"cmd &>>a.ts",
	"cmd >&a.ts",
	"cmd 1>&2 2>a.ts",
	"cmd 3>a.ts",
	"cmd 10>a.ts",
	"exec 3>a.ts",
	"echo x > a.ts<b",
	"cmd <a.ts >b.ts",
	"cmd < a.ts > b.ts",
	"cmd <>a.ts",
]

const SHELL_ALLOWED: string[] = [
	"git commit -m \"fix: a > b && c; d | e\"",
	"git commit -m \"$(cat <<'EOF'\nfix a > b\n\nbody a.ts > b\nEOF\n)\"",
	"git log --oneline -5",
	"git diff HEAD~1 -- a.ts",
	"git status --short",
	"git diff > /tmp/x.patch",
	"npm run build 2>&1 | tail -20",
	"pnpm test -- --grep \"a > b\"",
	"bun run test > /tmp/out",
	"npm test 2>&1 | tee /tmp/o.log",
	"grep -rn \"=> {\" src",
	"grep -r \">\" src",
	"rg '->' src",
	"rg -n \"a>b\" --type ts",
	"find . -name \"*.ts\" -exec grep -l foo {} +",
	"find . -type f -exec sed -n 1,5p {} ;",
	"jq \".a > 1\" f.json",
	"jq -r \".a\" f.json | head",
	"curl -s -o /tmp/x http://a",
	"curl -o /dev/null -s http://a",
	"curl -sL http://a | jq .",
	"gh pr create --title \"t\" --body \"$(cat <<'EOF'\n## S\n- a > b\nEOF\n)\"",
	"sed -n \"1,5p\" a.ts",
	"sed -n 1,5p a.ts | head",
	"awk '{ if ($1 > 3) print }' f",
	"awk -F, '$2>3{print $1}' f.csv",
	"FOO=1 npm test",
	"FOO=\"a b\" BAR=2 node x.js",
	"(cd x && ls)",
	"echo $(date)",
	"echo `date`",
	"x=$(git rev-parse HEAD); echo $x",
	"for f in *.ts; do echo $f; done",
	"while read l; do echo \"$l\"; done < f",
	"if [ -f a ]; then echo y; fi",
	"if [ \"$a\" -gt 3 ]; then echo y; fi",
	"[ 3 -gt 2 ] && echo ok",
	"ls -la 2>/dev/null",
	"cmd > /dev/null 2>&1",
	"cmd &> /dev/null",
	"cmd >/dev/null &",
	"sleep 1 & wait",
	"echo x > $TMPDIR/a.ts",
	"echo x > ${TMPDIR}/a.ts",
	"echo x > /tmp/a.ts",
	"echo x > /private/tmp/a.ts",
	"echo x > /var/folders/a/b.ts",
	"echo x > .claude/a.ts",
	"echo x > ~/.claude/a.ts",
	"cat a.ts",
	"cat a.ts b.ts | wc -l",
	"wc -l < a.ts",
	"sort < a.ts | uniq",
	"head -5 < a.ts",
	"python3 -c \"print(1>0)\"",
	"python3 script.py",
	"node -e \"console.log(1)\"",
	"node x.js > /tmp/o",
	"python3 - <<EOF\nprint(\"hi\")\nEOF",
	"cat <<EOF\nopen(\"a\",\"w\")\nEOF",
	"git log --format=\"%h %s\" | head",
	"git show HEAD:a.ts",
	"git diff --stat",
	"git apply --check p.diff",
	"git branch -a",
	"git push origin HEAD",
	"git checkout -b x",
	"echo \"a;b\" | tr \";\" \"\\n\"",
	"echo a || echo b",
	"echo $?",
	"cmd 2>&1 | grep x",
	"ls | xargs -n1 echo",
	"xargs -I{} echo {}",
	"find . -name \"*.ts\" | xargs grep -l \"a\" | head",
	"cp a.ts /tmp/b.ts",
	"cp a /tmp/",
	"mv a.ts /tmp/b.ts",
	"cp -r a /tmp/b",
	"cp a.ts ~/.claude/x",
	"echo x > ~/.claude/projects/-Users-a-proj/memory/MEMORY.md",
	"cp a.ts /tmp/b.log",
	"ln -s a /tmp/b",
	"echo \"x\" >&2",
	"echo x 1>&2",
	"cmd 2>&-",
	"diff <(ls a) <(ls b)",
	"cat <(echo hi)",
	"echo \"a\\\"b > c\"",
	"echo 'a\"b' > /tmp/x",
	"echo \"$a\" | grep -E \"(a|b)>c\"",
	"mkdir -p a/b",
	"rm -rf /tmp/x",
	"touch /tmp/a",
	"chmod +x a.sh",
	"tar czf /tmp/a.tgz .",
	"echo a > /tmp/x; cat /tmp/x",
	"bun test --bail 2>&1 | tail",
	"npx tsc --noEmit",
	"git log -p -- \"*.ts\" | head -100",
	"git grep -n \"a > b\"",
	"git commit -m \"x\" -m \"a.ts > b\"",
	"rg \"foo|bar\" src",
	"rg \"a && b\"",
	"grep -E 'a|b' f",
	"echo \"a\" ; echo \"b\"",
	"cat <<EOF >/tmp/a.ts\nx\nEOF",
	"echo `git rev-parse HEAD` > /tmp/h",
	"python3 -c \"import sys; sys.stdout.write(1)\"",
	"for i in 1 2; do echo $((i>1)); done",
	"git commit -m \"a\" 2>&1 | tail -3",
	"echo done >> /tmp/log",
	"gh pr view 1 --json title -q \".title\"",
	"gh api repos/x/y --jq \".[] | .a\"",
	"git diff --name-only | while read f; do echo \"$f\"; done",
	"cat a.ts | grep -c \"=>\"",
	"echo \"a\" | awk '{print $1 > \"/dev/stderr\"}'",
	"cmd 3>&1",
	"cmd <<< \"a > b\"",
	"cat <<EOF | grep a\nx > y\nEOF",
	"echo x > /dev/stderr",
	"ls >/dev/tty",
	"echo x > \"$TMPDIR/../a.ts\"",
	"echo x > $TMPDIR/../a.ts",
	"echo x > ${TMPDIR:-/tmp}/a.ts",
	"echo x > \"${TMPDIR}/a.ts\"",
	"cat <<A <<B\nx\nA\ny\nB",
	"tee",
	"git apply --check --index p.diff",
	"git apply -R p.diff --stat",
	"sed -n \"s/i/j/p\" a.ts",
	"sed s/-i/x/ a.ts",
	"patch --dry-run -p1 < x.diff",
	"patch -p1 --dry-run < x.diff",
]

test(`isFileWrite regression table (${SHELL_BLOCKED.length} blocked, ${SHELL_ALLOWED.length} allowed)`, () => {
	const wrong: string[] = []
	for (const command of SHELL_BLOCKED) if (!isFileWrite(command, SHELL_CTX)) wrong.push(`should block: ${JSON.stringify(command)}`)
	for (const command of SHELL_ALLOWED) if (isFileWrite(command, SHELL_CTX)) wrong.push(`should allow: ${JSON.stringify(command)}`)
	expect(wrong).toEqual([])
})

test('round 3: each fix on its own', () => {
	const block = [
		'echo ${#a} > a.ts',
		'echo "$(echo x > a.ts)"',
		'x="$(cat a > b.ts)"',
		'echo "`echo x > a.ts`"',
		'echo "$(echo "$(echo x > a.ts)")"',
		'find . -name "*.ts" -exec sed -i s/a/b/ {} +',
		'find . -name "*.ts" -exec sed -i "" s/a/b/ {} \;',
		'find . -exec cp {} b.ts \;',
		'find . -execdir cp {} b.ts \;',
		'echo x >| a.ts',
		'echo x>|a.ts',
		'cat <<EOF | python3 -\nopen("a.py","w")\nEOF',
		'cat <<EOF | sudo node\nrequire("fs").writeFileSync("a","x")\nEOF',
		'sed --in-place=.bak s/a/b/ a.ts',
		'sed --in-place s/a/b/ a.ts',
	]
	for (const command of block) expect([command, isFileWrite(command, SHELL_CTX)]).toEqual([command, true])
	const allow = [
		'git commit -m "$(cat <<\'EOF\'\nIt\'s fixed: a > b\nEOF\n)"',
		'gh pr create --body "$(cat <<\'EOF\'\n## Summary\n- a > b\nEOF\n)"',
		'echo "$(date)" > /tmp/x',
		'find . -name "*.ts" -exec grep -l foo {} +',
		'find . -type f -exec sed -n 1,5p {} \;',
		'echo x >| /tmp/a.ts',
		'cat <<EOF | python3 -\nprint("hi")\nEOF',
		'cat <<EOF | grep a\nx > y\nEOF',
	]
	for (const command of allow) expect([command, isFileWrite(command, SHELL_CTX)]).toEqual([command, false])
})

test('session.end: a flush during the reset window is skipped', async ($, on) => {
	const world = engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
	const usage = (n: number) => ({ model: 'claude-sonnet-5-5', input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
	await turn($, usage(100))

	// While the snapshot is written, a turn lands, the 30 s timer fires and the person runs /model-policy week.
	// $.session.id() still says s1 there, so a flush would put the new tally under the old key.
	world.world.onSet = async () => {
		world.world.onSet = undefined
		await turn($, usage(50))
		await world.clock.advance(31_000)
		await slash($, 'week')
	}
	await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
	expect([...world.kv.keys()]).toEqual([`day-${dayKey(NOON)}-s1`])
	expect((world.kv.get(`day-${dayKey(NOON)}-s1`) as { families: { sonnet: { tokens: number } } }).families.sonnet.tokens).toBe(100)

	// After the end the new session flushes its own tally under its own key: 100 + 50, counted once.
	world.sid.id = 's2'
	expect((await slash($, 'week')).text).toMatch(/sonnet\s+150 tokens/)
	expect([...world.kv.keys()].sort()).toEqual([`day-${dayKey(NOON)}-s1`, `day-${dayKey(NOON)}-s2`])
})

// The engine's own answers for the start-of-session question, the /model switch, and the model read.
// Call it before engineTools: the first hook registered answers first.
function enginePicker(on: On, answer: string | Error) {
	const world = {
		asked: [] as Array<{ questions: Array<{ question: string; header: string; options: Array<{ label: string }> }> }>,
		ran: [] as Array<{ command: string; args: string }>,
		logs: [] as string[],
		turns: 0,
		// The main session's model. /model changes it when `switchWorks` is true.
		model: 'claude-opus-4-7',
		switchWorks: true,
	}
	on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
		world.asked.push(e as never)
		if (answer instanceof Error) throw answer
		const { questions } = e as { questions: Array<{ question: string }> }
		return { result: { questions, answers: { [questions[0]?.question ?? '']: answer } } } as never
	})
	on('command.run', { command: 'model' }, (_, e) => {
		world.ran.push({ command: e.command, args: e.args })
		if (!world.switchWorks) return { text: 'Unable to validate model' }
		world.model = `claude-${e.args}-5-5`
		return { text: '' }
	})
	on('session.turns', () => ({ value: world.turns }))
	on('session.model', () => ({ value: world.model }))
	on('ui.log', (_, e) => {
		world.logs.push(e.text)
		return { value: undefined }
	})
	return world
}

// The question is not awaited by session.start, so a test waits for it to settle.
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 20))

const START = { cwd: '/work/app', surface: 'terminal', isInteractive: true } as const

const CODER = { prompt: 'p', description: 'Write', subagentType: 'model-policy:coder' }

test('picker: the labels map to the /model aliases, and only a label is a pick', () => {
	expect(PICK_LABELS).toEqual(['Opus', 'Sonnet', 'Haiku'])
	expect(pickFromAnswer('Opus')).toBe('opus')
	expect(pickFromAnswer('Sonnet')).toBe('sonnet')
	expect(pickFromAnswer('Haiku')).toBe('haiku')
	expect(pickFromAnswer('haiku')).toBeUndefined()
	expect(pickFromAnswer('fable')).toBeUndefined()
	expect(pickFromAnswer('')).toBeUndefined()
})

test('picker: a Haiku main model puts every agent on Haiku, other models change nothing', () => {
	const coder = { subagentType: 'model-policy:coder' }
	const reviewer = { subagentType: 'model-policy:reviewer', model: 'sonnet' }
	for (const spawn of [coder, reviewer, { description: 'Write it' }, { model: 'opus' }, { subagentType: 'model-policy:mechanic', model: 'sonnet' }, { subagentType: 'Explore' }]) {
		expect(decideSpawn(spawn, { mechanicModel: 'sonnet', mainFamily: 'haiku' })).toEqual({ model: 'haiku' })
		for (const mainFamily of ['sonnet', 'opus', 'other', undefined] as const) {
			expect(decideSpawn(spawn, { mechanicModel: 'sonnet', mainFamily })).toEqual(decideSpawn(spawn, { mechanicModel: 'sonnet' }))
		}
	}
	// Opus is never an agent model, whatever the main model is.
	for (const mainFamily of ['opus', 'sonnet', 'haiku'] as const) {
		expect(decideSpawn({ model: 'opus' }, { mechanicModel: 'haiku', mainFamily })).not.toEqual({ model: 'opus' })
	}
	// An explicit Haiku id is kept as given, a fork is still denied, and a resume still passes.
	expect(decideSpawn({ model: 'claude-haiku-4-5' }, { mechanicModel: 'haiku', mainFamily: 'haiku' })).toEqual({ model: 'claude-haiku-4-5' })
	expect(decideSpawn({ fork: true }, { mechanicModel: 'haiku', mainFamily: 'haiku' })).toHaveProperty('deny')
	expect(decideSpawn({ resume: { agentId: 'a1' } }, { mechanicModel: 'haiku', mainFamily: 'haiku' })).toEqual({ allow: true })
})

test('picker: the fork denial does not say the main model is Opus', () => {
	const { deny } = decideSpawn({ fork: true }, { mechanicModel: 'haiku', mainFamily: 'haiku' }) as { deny: string }
	expect(deny).toMatch(/inherits the main session model, which may be Opus/)
	expect(deny).not.toMatch(/\(Opus\)/)
	expect(deny).toMatch(/coder, scout, mechanic, or reviewer/)
})

test('picker: a new session asks once, and the pick runs /model with its alias', async ($, on) => {
	const world = enginePicker(on, 'Sonnet')
	engineTools(on)
	await $.session.start(START)
	await settle()
	expect(world.asked).toHaveLength(1)
	const [question] = world.asked[0]?.questions ?? []
	expect(question?.options.map(o => o.label)).toEqual(['Opus', 'Sonnet', 'Haiku'])
	expect(question?.header).toBe('Model')
	expect(world.ran).toEqual([{ command: 'model', args: 'sonnet' }])
	expect(world.logs).toEqual([])
})

test('picker: Opus is picked while the model is Sonnet, so /model opus runs', async ($, on) => {
	const world = enginePicker(on, 'Opus')
	world.model = 'claude-sonnet-5-5'
	engineTools(on)
	await $.session.start(START)
	await settle()
	expect(world.ran).toEqual([{ command: 'model', args: 'opus' }])
})

test('picker: a pick in the family of the current model runs no /model', async ($, on) => {
	const world = enginePicker(on, 'Opus')
	world.model = 'claude-opus-4-7[1m]'
	engineTools(on)
	await $.session.start(START)
	await settle()
	expect(world.asked).toHaveLength(1)
	expect(world.ran).toEqual([])
	expect(world.model).toBe('claude-opus-4-7[1m]')
})

test('picker: session.start does not wait for the answer', async ($, on) => {
	let release = () => {}
	const gate = new Promise<void>(resolve => (release = resolve))
	on('tool.call', { tool: 'AskUserQuestion' }, async (_, e, next) => {
		await gate
		return next(e)
	})
	const world = enginePicker(on, 'Haiku')
	engineTools(on)
	await $.session.start(START)
	await settle()
	expect(world.ran).toEqual([])
	release()
	await settle()
	expect(world.ran).toEqual([{ command: 'model', args: 'haiku' }])
})

test('picker: a second session.start in the same session asks nothing, even while the first dialog is open', async ($, on) => {
	let release = () => {}
	const gate = new Promise<void>(resolve => (release = resolve))
	on('tool.call', { tool: 'AskUserQuestion' }, async (_, e, next) => {
		await gate
		return next(e)
	})
	const world = enginePicker(on, 'Haiku')
	engineTools(on)
	await $.session.start(START)
	await $.session.start(START)
	await settle()
	release()
	await settle()
	await $.session.start(START)
	await settle()
	expect(world.asked).toHaveLength(1)
	expect(world.ran).toHaveLength(1)
})

test('picker: a session that already has prompts, /clear, and a resume do not ask', async ($, on) => {
	const world = enginePicker(on, 'Haiku')
	engineTools(on)
	// Resumed at launch: the transcript already holds prompts.
	world.turns = 3
	await $.session.start(START)
	await settle()
	// /clear and a resume end the session with no session.start after it.
	await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
	await $.session.end({ reason: 'resume', sessionId: 's1', resume: {} } as never)
	await settle()
	expect(world.asked).toEqual([])
	expect(world.ran).toEqual([])
})

test('picker: closing the question leaves the model and the agents alone', async ($, on) => {
	const world = enginePicker(on, new Error('dismissed'))
	engineSpawn(on)
	engineTools(on)
	await $.session.start(START)
	await settle()
	expect(world.asked).toHaveLength(1)
	expect(world.ran).toEqual([])
	expect((await spawn($, CODER)).model).toBe('sonnet')
})

test('picker: a -p run does not ask and does not fail', async ($, on) => {
	const world = enginePicker(on, new Error('no one to ask'))
	engineTools(on)
	await $.session.start({ cwd: '/work/app', surface: null, isInteractive: false })
	await settle()
	expect(world.asked).toEqual([])
	expect(world.ran).toEqual([])
})

test('picker: a rejection with no one to ask is swallowed', async ($, on) => {
	const world = enginePicker(on, new Error('no one to ask'))
	engineTools(on)
	await $.session.start(START)
	await settle()
	expect(world.asked).toHaveLength(1)
	expect(world.logs).toEqual([])
})

test('picker: free text typed under Other is no pick', async ($, on) => {
	const world = enginePicker(on, 'something else')
	engineTools(on)
	await $.session.start(START)
	await settle()
	expect(world.ran).toEqual([])
})

test('picker: askModelAtStart off asks nothing', { options: { askModelAtStart: false } }, async ($, on) => {
	const world = enginePicker(on, 'Haiku')
	engineTools(on)
	await $.session.start(START)
	await settle()
	expect(world.asked).toEqual([])
	expect(world.ran).toEqual([])
})

test('picker: /model-policy off asks nothing', async ($, on) => {
	const world = enginePicker(on, 'Haiku')
	engineTools(on)
	await slash($, 'off')
	await $.session.start(START)
	await settle()
	expect(world.asked).toEqual([])
	expect(world.ran).toEqual([])
})

test('picker: a failed switch shows the command text and caps nothing', async ($, on) => {
	const world = enginePicker(on, 'Haiku')
	world.switchWorks = false
	engineSpawn(on)
	engineTools(on)
	await $.session.start(START)
	await settle()
	expect(world.ran).toEqual([{ command: 'model', args: 'haiku' }])
	expect(world.logs).toHaveLength(1)
	expect(world.logs[0]).toMatch(/could not switch to haiku/)
	expect(world.logs[0]).toMatch(/Unable to validate model/)
	expect((await spawn($, CODER)).model).toBe('sonnet')
})

test('picker: the cap follows the live main model, not the pick', async ($, on) => {
	const world = enginePicker(on, 'Haiku')
	engineSpawn(on)
	engineTools(on)
	await $.session.start(START)
	await settle()
	expect(world.ran).toEqual([{ command: 'model', args: 'haiku' }])
	expect((await spawn($, CODER)).model).toBe('haiku')
	expect((await spawn($, { ...CODER, subagentType: 'model-policy:reviewer', model: 'sonnet' })).model).toBe('haiku')
	// /clear keeps the model, so it keeps the cap.
	await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
	expect((await spawn($, CODER)).model).toBe('haiku')
	// A manual /model back to Sonnet lifts the cap.
	world.model = 'claude-sonnet-5-5'
	expect((await spawn($, CODER)).model).toBe('sonnet')
})

test('picker: a main model on Haiku caps agents with no pick made', { options: { askModelAtStart: false } }, async ($, on) => {
	const world = enginePicker(on, 'Haiku')
	world.model = 'claude-haiku-4-5'
	engineSpawn(on)
	engineTools(on)
	await $.session.start(START)
	expect((await spawn($, CODER)).model).toBe('haiku')
	expect((await spawn($, { ...CODER, subagentType: 'model-policy:reviewer' })).model).toBe('haiku')
})

for (const label of ['Sonnet', 'Opus']) {
	test(`picker: the ${label} pick leaves agents as before`, async ($, on) => {
		enginePicker(on, label)
		engineSpawn(on)
		engineTools(on)
		await $.session.start(START)
		await settle()
		const model = async (input: Record<string, unknown>) => (await spawn($, { prompt: 'p', description: 'Do', ...input })).model
		expect(await model({ subagentType: 'model-policy:coder' })).toBe('sonnet')
		expect(await model({ subagentType: 'model-policy:reviewer', model: 'opus' })).toBe('sonnet')
		expect(await model({ subagentType: 'model-policy:scout' })).toBe('haiku')
		expect(await model({ subagentType: 'model-policy:mechanic' })).toBe('haiku')
		expect(await model({ subagentType: 'Explore' })).toBe('haiku')
	})
}
