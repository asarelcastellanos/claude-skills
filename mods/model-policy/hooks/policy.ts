// Pure decision helpers for the model-policy mod. No engine calls here, so tests call them directly.

import type { ModelPolicyDay, ModelPolicyPick } from '../types'

export const WORKER_MODEL = 'sonnet'

// Prose files. Sonnet writes them. The main session writes only the auto-memory notes.
const DOC_EXTENSIONS = ['.md', '.mdx', '.markdown', '.txt']

// The main session may write logs, and anything under a temp dir or a .claude/ directory that is not prose.
const LOG_EXTENSIONS = ['.log']

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
	/** The family of the main session's model right now. Unset when it could not be read. */
	mainFamily?: Family
}

export const DEFAULT_CONTEXT: SpawnContext = { mechanicModel: 'haiku' }

// Agent types that default to Haiku. An explicit Sonnet request is kept, since it stays
// within the Sonnet ceiling; unset or Opus gets Haiku. Mechanic defaults to the config instead.
const HAIKU_TYPES = new Set(['Explore', 'model-policy:scout'])

/** Reads the five_hour window from `$.session.usage().rateLimits`. */
export function fiveHourPercent(limits: ReadonlyArray<{ kind: string; percentUsed: number }>): number | undefined {
	return limits.find(limit => limit.kind === 'five_hour')?.percentUsed
}

// The start-of-session question's labels, each with the alias /model takes.
const PICKS = new Map<string, ModelPolicyPick>([
	['Opus', 'opus'],
	['Sonnet', 'sonnet'],
	['Haiku', 'haiku'],
])

export const PICK_LABELS: readonly string[] = [...PICKS.keys()]

/** Maps the dialog's answer to a pick. Text typed under "Other" matches no label, so it is no pick. */
export function pickFromAnswer(answer: string): ModelPolicyPick | undefined {
	return PICKS.get(answer)
}

/** Opus runs only in the main session. Subagents get Sonnet at most, Haiku for cheap types. */
export function decideSpawn(spawn: SpawnInput, ctx: SpawnContext = DEFAULT_CONTEXT): SpawnDecision {
	// A resume can only be refused, and a rewrite is logged as a failure. Leave it alone.
	if (spawn.resume !== undefined) return { allow: true }
	// A fork inherits the parent's model and context, so it would run on Opus.
	if (spawn.fork) {
		return {
			deny:
				'Model policy: a fork inherits the main session model, which may be Opus, and only the main session runs on Opus. ' +
				'Spawn a model-policy:coder, scout, mechanic, or reviewer agent with a self-contained prompt instead.',
		}
	}
	if (family(spawn.model) === 'haiku') return { model: spawn.model ?? 'haiku' }
	// A main session on Haiku means the person wants the cheapest run, so no agent goes above it.
	if (ctx.mainFamily === 'haiku') return { model: 'haiku' }
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

function resolvePath(path: string, home: string, cwd: string): string {
	const expanded = home && /^~(?:\/|$)/.test(path) ? home + path.slice(1) : path
	return normalize(expanded, cwd)
}

/** True when `path` is a Markdown or plain-text file. */
export function isDocPath(path: string, home: string, cwd: string): boolean {
	const lower = resolvePath(path, home, cwd).toLowerCase()
	return DOC_EXTENSIONS.some(ext => lower.endsWith(ext))
}

// A file under <home>/.claude/projects/<project>/memory/, the auto-memory directory.
function inMemoryDir(abs: string, home: string): boolean {
	if (!home) return false
	const root = normalize(home, '/') + '/.claude/projects/'
	if (!abs.startsWith(root)) return false
	const [project, dir, file] = abs.slice(root.length).split('/')
	return !!project && dir === 'memory' && !!file
}

/**
 * The main session may not write prose (.md, .mdx, .markdown, .txt) anywhere, except in the
 * auto-memory directory (~/.claude/projects/<project>/memory/). Sonnet writes prose.
 * Otherwise it may write logs, anything under a temp dir (/tmp, /private/tmp, /var/folders,
 * TMPDIR), and anything inside a .claude/ directory at any level. Everything else is code,
 * which Sonnet writes.
 */
export function mainSessionMayWrite(path: string, home: string, cwd: string, tmpdir = ''): boolean {
	const abs = resolvePath(path, home, cwd)
	const lower = abs.toLowerCase()
	if (DOC_EXTENSIONS.some(ext => lower.endsWith(ext))) return inMemoryDir(abs, home)
	if (LOG_EXTENSIONS.some(ext => lower.endsWith(ext))) return true
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
	// $TMPDIR, ${TMPDIR} and ${TMPDIR:-/tmp}, only as a whole leading path segment.
	target = target.replace(/^\$(?:TMPDIR|\{TMPDIR(?::?-[^}]*)?\})(?=\/|$)/, ctx.tmpdir || '/tmp')
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

type Scan = { text: string; quotes: string[]; scripts: string[]; subs: string[] }

// A quoted token that looks like a path stays visible, so `> "README.md"` is judged by its path.
// Any other quoted text becomes "Q#<index>", with the text kept in `quotes`.
const PATH_LIKE = /^[\w./~${}@+-]+$/

// The index just past the `)` that closes a `$(` opened at `open` (the index of the `$`), or the end of
// the text. It knows quotes, nested parentheses and heredoc bodies, so an apostrophe in a commit message does not end it.
function substitutionEnd(command: string, open: number): number {
	const n = command.length
	let depth = 1
	let i = open + 2
	let heredoc: string | undefined
	while (i < n) {
		const c = command[i] ?? ''
		if (c === '\\') i += 2
		else if (c === "'") {
			const j = command.indexOf("'", i + 1)
			i = j < 0 ? n : j + 1
		} else if (c === '"') {
			let j = i + 1
			while (j < n && command[j] !== '"') j += command[j] === '\\' ? 2 : 1
			i = j + 1
		} else if (c === '<' && command.startsWith('<<', i) && command[i + 2] !== '<' && command[i - 1] !== '<') {
			const word = /^<<-?[ \t]*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_]\w*))/.exec(command.slice(i))
			heredoc = word?.[1] ?? word?.[2] ?? word?.[3]
			i += word ? word[0].length : 2
		} else if (c === '\n' && heredoc !== undefined) {
			i++
			while (i < n) {
				const j = command.indexOf('\n', i)
				const line = command.slice(i, j < 0 ? n : j)
				i = j < 0 ? n : j + 1
				if (line.trim() === heredoc) break
			}
			heredoc = undefined
		} else {
			if (c === '(') depth++
			else if (c === ')' && --depth === 0) return i + 1
			i++
		}
	}
	return n
}

// One pass over the command. It masks quoted text (`git commit -m "a > b"` has no redirect),
// drops comments, `$(( ))`, `(( ))` and `[[ ]]`, turns `$(` and backticks into separators,
// and cuts heredoc bodies out. A body fed to an interpreter is kept in `scripts`, since it is code.
// The bodies of `$(...)` and backticks inside double quotes go to `subs`, to be checked as commands.
// A heredoc opener is `<<` or `<<-` and a word, outside quotes. `<<<` is a here-string.
function scan(command: string): Scan {
	let out = ''
	let lineStart = 0
	let i = 0
	const quotes: string[] = []
	const scripts: string[] = []
	const subs: string[] = []
	const pending: Array<{ end: string; feeds: boolean }> = []
	const n = command.length
	const atWordStart = () => out === '' || /[\s;&|({]$/.test(out)
	const mask = (body: string) => (PATH_LIKE.test(body) ? body : `"Q#${quotes.push(body) - 1}"`)

	while (i < n) {
		const c = command[i] ?? ''
		if (c === '\\') {
			out += command[i + 1] === '\n' ? ' ' : command.slice(i, i + 2)
			i += 2
		} else if (c === "'") {
			const j = command.indexOf("'", i + 1)
			out += mask(command.slice(i + 1, j < 0 ? n : j))
			i = j < 0 ? n : j + 1
		} else if (c === '"') {
			// Inside double quotes `$(...)` and backticks still run, so their bodies are commands too.
			let j = i + 1
			while (j < n && command[j] !== '"') {
				if (command[j] === '\\') j += 2
				else if (command.startsWith('$(', j) && !command.startsWith('$((', j)) {
					const end = substitutionEnd(command, j)
					subs.push(command.slice(j + 2, Math.max(j + 2, end - 1)))
					j = end
				} else if (command[j] === '`') {
					const close = command.indexOf('`', j + 1)
					subs.push(command.slice(j + 1, close < 0 ? n : close))
					j = close < 0 ? n : close + 1
				} else j++
			}
			out += mask(command.slice(i + 1, Math.min(j, n)))
			i = j + 1
		} else if (command.startsWith('${', i)) {
			// `${#a}` and `${a:-x}` are one word: a # inside is not a comment.
			const j = command.indexOf('}', i)
			out += command.slice(i, j < 0 ? n : j + 1)
			i = j < 0 ? n : j + 1
		} else if (c === '#' && atWordStart()) {
			const j = command.indexOf('\n', i)
			i = j < 0 ? n : j
		} else if (command.startsWith('$((', i) || (command.startsWith('((', i) && atWordStart())) {
			const j = command.indexOf('))', i + 2)
			out += ' '
			i = j < 0 ? n : j + 2
		} else if (command.startsWith('[[', i) && atWordStart()) {
			const j = command.indexOf(']]', i + 2)
			out += ' '
			i = j < 0 ? n : j + 2
		} else if (command.startsWith('$(', i)) {
			out += ';'
			i += 2
		} else if (c === '`') {
			out += ';'
			i++
		} else if (c === '<' && command.startsWith('<<', i) && command[i + 2] !== '<' && command[i - 1] !== '<') {
			let k = i + 2
			if (command[k] === '-') k++
			while (command[k] === ' ' || command[k] === '\t') k++
			const word = /^(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_]\w*))/.exec(command.slice(k))
			const end = word?.[1] ?? word?.[2] ?? word?.[3]
			if (word && end) {
				i = k + word[0].length
				const eol = command.indexOf('\n', i)
				const after = command.slice(i, eol < 0 ? n : eol)
				// The body is code when this line runs an interpreter or pipes into one: cat <<EOF | python3 -
				const feeds = INTERPRETER.test(out.slice(lineStart)) || /\|[^|;&]*?\b(?:python3?|node|ruby|perl|deno|bun)\b/.test(after)
				pending.push({ end, feeds })
			} else {
				out += c
				i++
			}
		} else if (c === '\n') {
			out += '\n'
			i++
			lineStart = out.length
			for (const doc of pending.splice(0)) {
				const body: string[] = []
				while (i < n) {
					const j = command.indexOf('\n', i)
					const line = command.slice(i, j < 0 ? n : j)
					i = j < 0 ? n : j + 1
					if (line.trim() === doc.end) break
					body.push(line)
				}
				if (doc.feeds) scripts.push(body.join('\n'))
			}
		} else {
			out += c
			i++
		}
	}
	return { text: out, quotes, scripts, subs }
}

// Segments are simple commands: split on && || ; | newline, a lone &, parentheses.
// `>&`, `&>` and `2>&1` keep their &, and `>|` is a redirect, not a pipe.
const SEGMENT = /\|\||&&|[;\n()]|(?<!>)\||(?<![>&])&(?![>&])/

const WRAPPERS = new Set(['sudo', 'command', 'exec', 'time', 'nohup', 'xargs', 'env', 'nice'])
const KEYWORDS = new Set(['if', 'then', 'do', 'else', 'elif', 'while', 'until', '{', '}', '!'])

function dest(args: readonly string[]): string | undefined {
	const plain: string[] = []
	let dir: string | undefined
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? ''
		if (arg === '-t') dir = args[++i]
		else if (arg.startsWith('--target-directory=')) dir = arg.slice('--target-directory='.length)
		else if (/^-t.+/.test(arg) && !arg.startsWith('--')) dir = arg.slice(2)
		else if (!arg.startsWith('-')) plain.push(arg)
	}
	return dir ?? (plain.length >= 2 ? plain[plain.length - 1] : undefined)
}

const READ_ONLY_APPLY = /^--(?:check|stat|numstat|summary)$/

// Removes the redirects from a segment, so their targets are not read as arguments of the command.
// Returns the arguments and whether a redirect wrote somewhere the main session may not.
function withoutRedirects(segment: string, ctx: PathContext): { words: string[]; writes: boolean } {
	let writes = false
	const rest = segment
		.replace(/<<<\s*\S+/g, ' ')
		.replace(/(?<![<\d])\d*<\s*[^\s<>&|;()]+/g, ' ')
		.replace(/\d*>&(?:\d+|-)/g, ' ')
		.replace(/(?:&>>?|\d*>>?\|?|\d*>&(?![\d-]))[ \t]*([^\s&|;<>()]+)/g, (_match, target: string) => {
			if (!targetAllowed(target, ctx)) writes = true
			return ' '
		})
	return { words: rest.trim().split(/\s+/).filter(Boolean), writes }
}

function segmentWrites(segment: string, quotes: readonly string[], ctx: PathContext): boolean {
	const { words, writes } = withoutRedirects(segment, ctx)
	if (writes) return true

	// Skip what comes before the command: keywords, VAR=value, sudo and friends with their flags.
	let at = 0
	for (; at < words.length; at++) {
		const word = (words[at] ?? '').replace(/^[{!]+/, '')
		if (word === '' || KEYWORDS.has(word) || /^\w+=\S*$/.test(word)) continue
		if (WRAPPERS.has(word)) {
			while ((words[at + 1] ?? '').startsWith('-')) at++
			continue
		}
		break
	}
	const cmd = (words[at] ?? '').split('/').pop() ?? ''
	const args = words.slice(at + 1)

	// find -exec CMD ... ; (or +): the words up to the terminator are a command of their own.
	if (cmd === 'find') {
		for (let i = 0; i < args.length; i++) {
			if (!/^-(?:exec|execdir|ok|okdir)$/.test(args[i] ?? '')) continue
			const inner: string[] = []
			for (i++; i < args.length && !/^(?:\\?;|\+|\\)$/.test(args[i] ?? ''); i++) inner.push(args[i] ?? '')
			if (segmentWrites(inner.join(' '), quotes, ctx)) return true
		}
		return false
	}
	if (cmd === 'sed') return args.some(arg => /^-[A-Za-z]*i/.test(arg) || arg === '--in-place' || arg.startsWith('--in-place='))
	// -i alone or in a cluster of switches that take no argument (-pi, -pie, -i.bak). -Mstrict and -I are not it.
	if (cmd === 'perl' && args.some(arg => /^-[pnalwWsStTuUc]*i[pnalwWsStTuUce]*(?:\.\S*)?$/.test(arg))) return true
	if (cmd === 'patch') return !args.includes('--dry-run')
	if (cmd === 'tee') return args.filter(arg => !arg.startsWith('-')).some(target => !targetAllowed(target, ctx))
	if (cmd === 'cp' || cmd === 'mv' || cmd === 'install' || cmd === 'ln') {
		const to = dest(args)
		return to !== undefined && !targetAllowed(to, ctx)
	}
	if (cmd === 'git') {
		let i = 0
		while (i < args.length && (args[i] ?? '').startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
		const rest = args.slice(i + 1)
		// git apply writes the tree unless it only checks or reports.
		if (args[i] === 'apply') return !rest.some(arg => READ_ONLY_APPLY.test(arg))
		if (args[i] === 'mv') {
			const to = dest(rest)
			return to !== undefined && !targetAllowed(to, ctx)
		}
		return false
	}
	// python -c "...", node -e "...": inspect only the script argument.
	if (/^(?:python[\d.]*|node|ruby|perl|deno|bun)$/.test(cmd)) {
		for (let i = 0; i < args.length - 1; i++) {
			const index = /^"Q#(\d+)"$/.exec(args[i + 1] ?? '')?.[1]
			if (/^-[A-Za-z]*[ce]$/.test(args[i] ?? '') && index !== undefined && writesFile(quotes[Number(index)] ?? '')) return true
		}
	}
	return false
}

/**
 * True when the shell command writes a file the main session may not write.
 *
 * This is a best-effort guard against the main session writing code through the shell. The
 * model-roles skill is the primary rule. Known gaps: `sh -c` and `bash -c` strings, `dd of=`,
 * `curl -o`, `git checkout` and `git restore`, and PowerShell.
 */
export function isFileWrite(command: string, ctx: PathContext = {}): boolean {
	const { text, quotes, scripts, subs } = scan(command)
	// python - <<'PY' ... PY and the like: the body is code.
	if (scripts.some(writesFile)) return true
	if (subs.some(sub => isFileWrite(sub, ctx))) return true
	return text.split(SEGMENT).some(segment => segmentWrites(segment, quotes, ctx))
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
