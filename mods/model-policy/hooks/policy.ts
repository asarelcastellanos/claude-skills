// Pure decision helpers for the model-policy mod. No engine calls here, so tests call them directly.

export const REVIEW_MODEL = 'opus'
export const WORKER_MODEL = 'sonnet'

const WRITABLE_EXTENSIONS = ['.md', '.mdx', '.markdown', '.txt']

export const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'other'] as const
export type Family = (typeof FAMILIES)[number]

/** Maps a model id such as "claude-sonnet-5-5" to its family. */
export function family(modelId: string | undefined): Family {
	const id = (modelId ?? '').toLowerCase()
	for (const name of ['opus', 'sonnet', 'haiku', 'fable'] as const) {
		if (id.includes(name)) return name
	}
	return 'other'
}

/**
 * A review agent has an agent type containing "review" (model-policy:reviewer,
 * security-reviewer) or a description that starts with the word "review".
 */
export function isReview(spawn: { subagentType?: string; description?: string }): boolean {
	return /review/i.test(spawn.subagentType ?? '') || /^review\b/i.test((spawn.description ?? '').trim())
}

export type SpawnDecision = { deny: string } | { model: string } | { allow: true }

export function decideSpawn(spawn: { subagentType?: string; description?: string; fork?: boolean }): SpawnDecision {
	const review = isReview(spawn)
	// A fork inherits the parent's model, so a non-review fork would run on Opus.
	if (spawn.fork) {
		return review
			? { allow: true }
			: {
					deny:
						'Model policy: forks inherit the parent model (Opus), and only review agents run on Opus. ' +
						'Spawn model-policy:coder (or a general-purpose agent with model "sonnet") with a self-contained prompt instead.',
				}
	}
	return { model: review ? REVIEW_MODEL : WORKER_MODEL }
}

const TEMP_TARGET = /^(?:\/private)?\/tmp\/|^\/var\/folders\/|^\/dev\/(?:null|stderr|stdout)$/

/** Resolves `path` against `cwd` and collapses "." and ".." segments. Separators become "/". */
function normalize(path: string, cwd: string): string {
	const slashed = path.replace(/\\/g, '/')
	const joined = /^(?:\/|[A-Za-z]:\/)/.test(slashed) ? slashed : `${cwd.replace(/\\/g, '/')}/${slashed}`
	const out: string[] = []
	for (const part of joined.split('/')) {
		if (part === '' || part === '.') continue
		if (part === '..') out.pop()
		else out.push(part)
	}
	return (joined.startsWith('/') ? '/' : '') + out.join('/')
}

/**
 * The main session may write prose (.md, .mdx, .markdown, .txt) and anything
 * inside the user's ~/.claude/ directory. Everything else is code, which Sonnet writes.
 */
export function mainSessionMayWrite(path: string, home: string, cwd: string): boolean {
	const abs = normalize(path, cwd)
	const lower = abs.toLowerCase()
	if (WRITABLE_EXTENSIONS.some(ext => lower.endsWith(ext))) return true
	if (home) {
		const claudeDir = normalize('.claude', home)
		if (abs.startsWith(claudeDir + '/')) return true
	}
	return false
}

// Heredoc bodies are data, not shell. Cut them so `>` inside a here-document is not read as a redirect.
function stripHeredocBodies(command: string): string {
	const lines = command.split('\n')
	const kept: string[] = []
	let end: string | undefined
	for (const line of lines) {
		if (end !== undefined) {
			if (line.trim() === end) end = undefined
			continue
		}
		kept.push(line)
		const match = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
		if (match) end = match[2]
	}
	return kept.join('\n')
}

// Quoted text is not shell syntax: `git commit -m "a > b"` has no redirect. Quoted
// temp paths stay visible so `> "/tmp/x"` is still recognised as a temp target.
function maskQuotes(command: string): string {
	return command.replace(/"((?:\\.|[^"\\])*)"|'([^']*)'/g, (whole, dq?: string, sq?: string) => {
		const body = dq ?? sq ?? ''
		return TEMP_TARGET.test(body) ? body : '"Q"'
	})
}

/** True when the shell command writes a file: in-place edits, redirects, tee, patches, one-liner writes. */
export function isFileWrite(command: string): boolean {
	const code = maskQuotes(stripHeredocBodies(command))

	if (/(?:^|[\s;&|(])sed\b[^\n;&|]*\s(?:-[A-Za-z]*i|--in-place)/.test(code)) return true
	if (/(?:^|[\s;&|(])perl\b[^\n;&|]*\s-[A-Za-z]*i/.test(code)) return true
	if (/(?:^|[\s;&|(])git\s+(?:-\S+\s+)*apply\b/.test(code)) return true
	if (/(?:^|[\s;&|(])patch(?:\s|$)/.test(code)) return true

	// tee writes every file it is given. Allow it only when all targets are temp paths.
	for (const match of code.matchAll(/(?:^|[\s;&|(])tee\b([^\n;&|]*)/g)) {
		const targets = (match[1] ?? '').split(/\s+/).filter(arg => arg !== '' && !arg.startsWith('-'))
		if (targets.length === 0 || targets.some(target => !TEMP_TARGET.test(target))) return true
	}

	// Redirects: `>`, `>>`, `&>`, `2>`, `>|`. `>&2` and `2>&1` have `&` where the target would be, so they never match.
	for (const match of code.matchAll(/(?:&>>?|\d*>>?\|?)[ \t]*([^\s&|;<>()]+)/g)) {
		if (!TEMP_TARGET.test(match[1] ?? '')) return true
	}

	// python -c "...write..." and node -e "...writeFile..." one-liners. Checked on the raw text, since the code is quoted.
	if (/(?:^|[\s;&|(])(?:python3?|node)\s+(?:-\S+\s+)*-[ce]\b[\s\S]*(?:write|appendFile)/i.test(command)) return true

	return false
}
