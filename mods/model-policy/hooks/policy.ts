// Pure decision helpers for the model-policy mod. No engine calls here, so tests call them directly.

import type { ModelPolicyDay } from '../types'

export const WORKER_MODEL = 'sonnet'

// The main session may write prose, logs, and anything under a temp dir or a .claude/ directory.
const WRITABLE_EXTENSIONS = ['.md', '.mdx', '.markdown', '.txt', '.log']

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

export type SpawnDecision = { deny: string } | { model: string } | { allow: true }

export type SpawnInput = {
	subagentType?: string
	description?: string
	model?: string
	fork?: boolean
	resume?: unknown
}

export type SpawnContext = {
	/** Model for model-policy:mechanic: "haiku" or "sonnet". */
	mechanicModel: string
}

export const DEFAULT_CONTEXT: SpawnContext = { mechanicModel: 'haiku' }

// Agent types that default to Haiku. An explicit Sonnet request is kept, since it stays
// within the Sonnet ceiling; unset or Opus gets Haiku. Mechanic defaults to the config instead.
const HAIKU_TYPES = new Set(['Explore', 'model-policy:scout'])

/** Reads the five_hour window from `$.session.usage().rateLimits`. */
export function fiveHourPercent(limits: ReadonlyArray<{ kind: string; percentUsed: number }>): number | undefined {
	return limits.find(limit => limit.kind === 'five_hour')?.percentUsed
}

/** Opus runs only in the main session. Subagents get Sonnet at most, Haiku for cheap types. */
export function decideSpawn(spawn: SpawnInput, ctx: SpawnContext = DEFAULT_CONTEXT): SpawnDecision {
	// A resume can only be refused, and a rewrite is logged as a failure. Leave it alone.
	if (spawn.resume !== undefined) return { allow: true }
	// A fork inherits the parent's model and context, so it would run on Opus.
	if (spawn.fork) {
		return {
			deny:
				'Model policy: forks run on the main session model (Opus), and only the main session runs on Opus. ' +
				'Spawn a model-policy:coder, scout, mechanic, or reviewer agent with a self-contained prompt instead.',
		}
	}
	if (family(spawn.model) === 'haiku') return { model: spawn.model ?? 'haiku' }
	const type = spawn.subagentType ?? ''
	const cheap = HAIKU_TYPES.has(type) || type === 'model-policy:mechanic'
	if (cheap && family(spawn.model) === 'sonnet') return { model: spawn.model ?? 'sonnet' }
	if (HAIKU_TYPES.has(type)) return { model: 'haiku' }
	if (type === 'model-policy:mechanic') return { model: ctx.mechanicModel === 'sonnet' ? 'sonnet' : 'haiku' }
	return { model: WORKER_MODEL }
}

// ---- Paths ----

export type PathContext = {
	home?: string
	cwd?: string
	/** The TMPDIR environment value, when set. */
	tmpdir?: string
}

const TEMP_ROOTS = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders']

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

function inside(abs: string, root: string): boolean {
	return abs === root || abs.startsWith(root + '/')
}

/**
 * The main session may write prose and logs (.md, .mdx, .markdown, .txt, .log), anything
 * under a temp dir (/tmp, /private/tmp, /var/folders, TMPDIR), and anything inside a
 * .claude/ directory at any level. Everything else is code, which Sonnet writes.
 */
export function mainSessionMayWrite(path: string, home: string, cwd: string, tmpdir = ''): boolean {
	const expanded = home && /^~(?:\/|$)/.test(path) ? home + path.slice(1) : path
	const abs = normalize(expanded, cwd)
	const lower = abs.toLowerCase()
	if (WRITABLE_EXTENSIONS.some(ext => lower.endsWith(ext))) return true
	if (abs.split('/').slice(0, -1).includes('.claude')) return true
	const temps = tmpdir && tmpdir !== '/' ? [...TEMP_ROOTS, normalize(tmpdir, '/')] : TEMP_ROOTS
	return temps.some(root => inside(abs, root))
}

// ---- Shell writes ----

const SPECIAL_TARGET = /^\/dev\/(?:null|stderr|stdout|tty)$/

/** A redirect, tee, or cp/mv destination: may the main session write it? */
function targetAllowed(raw: string, ctx: PathContext): boolean {
	let target = raw.replace(/^["']|["']$/g, '')
	if (SPECIAL_TARGET.test(target)) return true
	target = target.replace(/^\$\{?TMPDIR\}?/, ctx.tmpdir || '/tmp')
	// Any other variable or substitution is unknown, so it is not allowed.
	if (/[$`]/.test(target)) return false
	return mainSessionMayWrite(target, ctx.home ?? '', ctx.cwd ?? '/', ctx.tmpdir ?? '')
}

// An interpreter's source that writes a file: open() in a write mode, write_text, writeFile, and so on.
// stdout.write is not here, so printing is not a file write.
const WRITE_CODE = [
	/\bopen\s*\((?:[^()]|\([^()]*\))*,\s*(?:mode\s*=\s*)?(['"])[wax][b+t]*\1/,
	/\bopen\s*\((?:[^()]|\([^()]*\))*mode\s*=\s*(['"])[wax]/,
	/\bopen\s*\(?[^;]*?,\s*(['"])\s*\+?>>?/,
	/\.write_(?:text|bytes)\s*\(/,
	/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/,
	/\bFile\s*\.\s*(?:write|binwrite)\s*\(/,
]

function writesFile(source: string): boolean {
	return WRITE_CODE.some(pattern => pattern.test(source))
}

const INTERPRETER = /\b(?:python3?|node|ruby|perl|deno|bun)\b/

type Split = { code: string; scripts: string[] }

// Heredoc bodies are data, not shell: cut them so `>` inside a here-document is not read as a redirect.
// A body fed to an interpreter is kept apart, since it is code that may write files.
// `<<<` is a here-string, not a heredoc.
function splitHeredocs(command: string): Split {
	const kept: string[] = []
	const scripts: string[] = []
	let end: string | undefined
	let feedsInterpreter = false
	let body: string[] = []
	for (const line of command.split('\n')) {
		if (end !== undefined) {
			if (line.trim() === end) {
				if (feedsInterpreter) scripts.push(body.join('\n'))
				end = undefined
				body = []
			} else body.push(line)
			continue
		}
		kept.push(line)
		const match = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line)
		if (match) {
			end = match[2]
			feedsInterpreter = INTERPRETER.test(line.slice(0, match.index))
		}
	}
	// An unterminated heredoc still runs to the end of the input.
	if (end !== undefined && feedsInterpreter) scripts.push(body.join('\n'))
	return { code: kept.join('\n'), scripts }
}

// Quoted text is not shell syntax: `git commit -m "a > b"` has no redirect. A quoted
// token that looks like a path stays visible, so `> "README.md"` is judged by its path.
function maskQuotes(command: string): string {
	return command.replace(/"((?:\\.|[^"\\])*)"|'([^']*)'/g, (_whole, dq?: string, sq?: string) => {
		const body = dq ?? sq ?? ''
		return /^[\w./~${}@+-]+$/.test(body) ? body : '"Q"'
	})
}

const CMD = String.raw`(?:^|[;&|(\n]|&&)\s*(?:(?:sudo|command|exec)\s+)?`

function fileOpDestinations(code: string): string[] {
	const out: string[] = []
	const re = new RegExp(`${CMD}(?:git\\s+)?(cp|mv|install|ln)\\s+([^;&|\\n]*)`, 'g')
	for (const match of code.matchAll(re)) {
		const args = (match[2] ?? '').split(/\s+/).filter(Boolean)
		const plain: string[] = []
		let dir: string | undefined
		for (let i = 0; i < args.length; i++) {
			const arg = args[i] ?? ''
			if (arg === '-t') dir = args[++i]
			else if (arg.startsWith('--target-directory=')) dir = arg.slice('--target-directory='.length)
			else if (/^-t.+/.test(arg) && !arg.startsWith('--')) dir = arg.slice(2)
			else if (!arg.startsWith('-')) plain.push(arg)
		}
		const dest = dir ?? (plain.length >= 2 ? plain[plain.length - 1] : undefined)
		if (dest !== undefined) out.push(dest)
	}
	return out
}

/** True when the shell command writes a file the main session may not write. */
export function isFileWrite(command: string, ctx: PathContext = {}): boolean {
	const { code: unmasked, scripts } = splitHeredocs(command)

	// python - <<'PY' ... PY and the like: the body is code.
	if (scripts.some(writesFile)) return true

	// python -c "...", node -e "...": inspect only the script argument.
	for (const match of unmasked.matchAll(
		/(?:^|[\s;&|(])(?:python3?|node|ruby|perl|deno|bun)\b[^|;&\n]*?\s-[A-Za-z]*[ce]\s+("(?:\\.|[^"\\])*"|'[^']*')/g,
	)) {
		if (writesFile(match[1] ?? '')) return true
	}

	const code = maskQuotes(unmasked)
		.replace(/\$\(\([^)]*\)\)/g, ' ')
		.replace(/(?:^|[;&|\s])\(\([^)]*\)\)/g, ' ')
		.replace(/\[\[[^\]]*\]\]/g, ' ')

	if (/(?:^|[\s;&|(])sed\b[^\n;&|]*\s(?:-[A-Za-z]*i|--in-place)/.test(code)) return true
	// -i alone or in a cluster of switches that take no argument (-pi, -pie, -i.bak). -Mstrict and -I are not it.
	if (/(?:^|[\s;&|(])perl\b[^\n;&|]*\s-[pnalwWsStTuUc]*i[pnalwWsStTuUce]*(?:\.\S*)?(?=\s|$)/.test(code)) return true

	// git apply writes the tree unless it only checks or reports.
	if (/(?:^|[\s;&|(])git\s+(?:-\S+\s+)*apply\b/.test(code) && !/--(?:check|stat|numstat|summary)\b/.test(code)) return true
	if (/(?:^|[\s;&|(])patch(?:\s|$)/.test(code) && !/--dry-run\b/.test(code)) return true

	// tee writes every file it is given.
	for (const match of code.matchAll(/(?:^|[\s;&|(])tee\b([^\n;&|]*)/g)) {
		const targets = (match[1] ?? '').split(/\s+/).filter(arg => arg !== '' && !arg.startsWith('-'))
		if (targets.length === 0 || targets.some(target => !targetAllowed(target, ctx))) return true
	}

	// Redirects: `>`, `>>`, `&>`, `2>`, `>|`. `>&2` and `2>&1` have `&` where the target would be, so they never match.
	for (const match of code.matchAll(/(?:&>>?|\d*>>?\|?)[ \t]*([^\s&|;<>()]+)/g)) {
		if (!targetAllowed(match[1] ?? '', ctx)) return true
	}

	return fileOpDestinations(code).some(dest => !targetAllowed(dest, ctx))
}

// ---- Per-day log ----

export type DayLog = ModelPolicyDay

export const KEEP_DAYS = 30

export function emptyDay(): DayLog {
	return { families: {}, types: {} }
}

const two = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD of `ms` in the process's local time zone. */
export function dayKey(ms: number): string {
	const d = new Date(ms)
	return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** `day` moved by `n` calendar days. */
export function shiftDay(day: string, n: number): string {
	const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
	const t = new Date(Date.UTC(y, m - 1, d + n))
	return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}`
}

// One store key per session and day: day-YYYY-MM-DD-<sessionId>. A session writes only its own keys.
export const DAY_PREFIX = 'day-'

export function dayStoreKey(day: string, sessionId: string): string {
	return `${DAY_PREFIX}${day}-${sessionId}`
}

/** The date inside a day key, or undefined for a key that is not one. */
export function dateOfKey(key: string): string | undefined {
	const match = /^day-(\d{4}-\d{2}-\d{2})-/.exec(key)
	return match?.[1]
}

/** The store keys of days older than the last 30, counting `today`. */
export function staleKeys(keys: readonly string[], today: string): string[] {
	const oldest = shiftDay(today, -(KEEP_DAYS - 1))
	return keys.filter(key => {
		const date = dateOfKey(key)
		return date !== undefined && date < oldest
	})
}

/** Adds the counts of `from` into `into`. */
export function mergeDay(into: DayLog, from: DayLog): DayLog {
	for (const [fam, v] of Object.entries(from.families)) {
		const prev = into.families[fam] ?? { tokens: 0, cache: 0 }
		into.families[fam] = { tokens: prev.tokens + v.tokens, cache: prev.cache + v.cache }
	}
	for (const [type, v] of Object.entries(from.types)) {
		const prev = into.types[type] ?? { spawns: 0, tokens: 0, model: '' }
		into.types[type] = { spawns: prev.spawns + v.spawns, tokens: prev.tokens + v.tokens, model: v.model || prev.model }
	}
	return into
}

export function addTurn(day: DayLog, fam: string, tokens: number, cache: number, type?: string): DayLog {
	const prev = day.families[fam] ?? { tokens: 0, cache: 0 }
	day.families[fam] = { tokens: prev.tokens + tokens, cache: prev.cache + cache }
	if (type !== undefined) {
		const t = day.types[type] ?? { spawns: 0, tokens: 0, model: '' }
		day.types[type] = { ...t, tokens: t.tokens + tokens }
	}
	return day
}

export function addSpawn(day: DayLog, type: string, model: string): DayLog {
	const t = day.types[type] ?? { spawns: 0, tokens: 0, model: '' }
	day.types[type] = { ...t, spawns: t.spawns + 1, model }
	return day
}

export function compact(n: number): string {
	if (n < 1000) return String(n)
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`
	return `${(n / 1_000_000).toFixed(1)}m`
}

/** The last 7 days, ending `today`, oldest first. */
export function weekDays(today: string): string[] {
	return Array.from({ length: 7 }, (_, i) => shiftDay(today, i - 6))
}

/** Text for `/model-policy week`. `days` holds the logs that exist, by date. */
export function formatWeek(today: string, days: Readonly<Record<string, DayLog>>): string {
	const range = weekDays(today)
	const sum = emptyDay()
	let counted = 0
	for (const date of range) {
		const log = days[date]
		if (!log) continue
		counted++
		for (const [fam, v] of Object.entries(log.families)) {
			const prev = sum.families[fam] ?? { tokens: 0, cache: 0 }
			sum.families[fam] = { tokens: prev.tokens + v.tokens, cache: prev.cache + v.cache }
		}
		for (const [type, v] of Object.entries(log.types)) {
			const prev = sum.types[type] ?? { spawns: 0, tokens: 0, model: '' }
			sum.types[type] = { spawns: prev.spawns + v.spawns, tokens: prev.tokens + v.tokens, model: v.model || prev.model }
		}
	}
	const head = `Last 7 days (${range[0]} to ${today}), ${counted} with activity.`
	if (counted === 0) return `${head}\nNothing logged yet.`
	const total = Object.values(sum.families).reduce((n, v) => n + v.tokens, 0)
	const fams = Object.entries(sum.families)
		.sort((a, b) => b[1].tokens - a[1].tokens)
		.map(([fam, v]) => {
			const pct = total > 0 ? Math.round((v.tokens / total) * 100) : 0
			return `  ${fam.padEnd(7)} ${compact(v.tokens).padStart(7)} tokens  ${String(pct).padStart(3)}%  cache ${compact(v.cache)}`
		})
	const types = Object.entries(sum.types)
		.sort((a, b) => b[1].tokens - a[1].tokens)
		.map(([type, v]) => `  ${type}  ${v.spawns} spawns  ${compact(v.tokens)} tokens  ${v.model || 'unknown'}`)
	return [
		head,
		'By model (input + output tokens, cache read + creation shown separately):',
		...fams,
		'By agent type:',
		...(types.length > 0 ? types : ['  none']),
	].join('\n')
}
