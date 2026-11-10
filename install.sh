#!/usr/bin/env bash
# Links each skill in this repo into ~/.claude/skills and imports this repo's CLAUDE.md.
set -euo pipefail

# Git Bash and Cygwin copy instead of linking without Developer Mode, so updates would never reach ~/.claude.
case "$(uname -s)" in
	MINGW* | MSYS* | CYGWIN*)
		echo "On Windows, run install.ps1 instead." >&2
		exit 1
		;;
esac

repo="$(cd "$(dirname "$0")" && pwd)"

# A linked worktree is deleted with "git worktree remove". The skill links and mod paths would then
# point every session at a folder that is gone, so run this from the main checkout.
if command -v git >/dev/null 2>&1 && git_dir="$(git -C "$repo" rev-parse --git-dir 2>/dev/null)"; then
	common_dir="$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null)" || common_dir="$git_dir"
	if [ "$(cd "$repo" && cd "$git_dir" && pwd -P)" != "$(cd "$repo" && cd "$common_dir" && pwd -P)" ]; then
		echo "$repo is a linked git worktree. Removing it would leave every session pointing at a deleted folder. Run install.sh from the main checkout instead." >&2
		exit 1
	fi
fi
skills_dir="$HOME/.claude/skills"
backup="$HOME/.claude/skills-backup-$(date +%Y%m%d-%H%M%S)-$$"

mkdir -p "$skills_dir"

for skill in "$repo"/skills/*/; do
	name="$(basename "$skill")"
	target="$skills_dir/$name"
	if [ -L "$target" ] && [ "$(readlink "$target")" = "${skill%/}" ]; then continue; fi
	if [ -e "$target" ] || [ -L "$target" ]; then
		# Keep a copy of anything we replace, in case it had local edits.
		mkdir -p "$backup"
		mv "$target" "$backup/$name"
		echo "moved the existing $name to $backup/$name"
	fi
	ln -s "${skill%/}" "$target"
	echo "linked $name"
done

global_md="$HOME/.claude/CLAUDE.md"
import_line="@$repo/CLAUDE.md"
touch "$global_md"
if ! grep -qxF "$import_line" "$global_md"; then
	printf '\n%s\n' "$import_line" >> "$global_md"
	echo "added import to $global_md"
fi

# The mods need the claude CLI to remove old installs. Skip them with a note when the CLI is missing.
# Claude Code loads the mods straight from this repo's mods/ folders: their absolute paths go in
# CLAUDE_CODE_PLUGIN_DIRS in settings.json, which Claude Code reads like --plugin-dir and watches.
# An edit to a mod file reloads in a running session, and /reload-plugins applies it on demand.
# An installed marketplace copy would load the same mod twice and run from a cached folder, so this
# script removes any copy installed from this repo's marketplace under either of its names.
# Each folder under mods/ is named after its plugin, so the folder name is the plugin name.
# The order is: check python3, write settings.json, and only then uninstall the copies. A failure
# before the write leaves the installed copies in place, so the mods stay loaded.
if command -v claude >/dev/null 2>&1; then
	if ! command -v python3 >/dev/null 2>&1; then
		echo "python3 not found, it edits settings.json. Install Python 3.7 or later and re-run this script." >&2
		exit 1
	fi
	# On macOS without the developer tools, python3 is a stub that exists but does not run.
	if ! python3 -I -c '' >/dev/null 2>&1; then
		echo "python3 is installed but does not run, and it edits settings.json. Install Python 3.7 or later (on macOS, run xcode-select --install) and re-run this script." >&2
		exit 1
	fi
	if ! python3 -I -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' >/dev/null 2>&1; then
		echo "python3 is older than 3.7, and this script needs 3.7 or later to edit settings.json. Install a newer Python and re-run this script." >&2
		exit 1
	fi
	# The path list uses : as its separator, so a path with one cannot be listed. The physical path
	# (symlinks resolved) is what Claude Code opens, and what the entries are compared against.
	physical_repo="$(cd "$repo" && pwd -P)"
	mod_dirs=()
	for mod in "$physical_repo"/mods/*/; do
		[ -d "$mod" ] || continue
		mod="${mod%/}"
		case "$mod" in
			*:*)
				echo "$mod contains a colon, which separates the paths in CLAUDE_CODE_PLUGIN_DIRS. Move the repo to a path without one and re-run this script." >&2
				exit 1
				;;
		esac
		mod_dirs+=("$mod")
	done
	if [ "${#mod_dirs[@]}" -eq 0 ]; then
		echo "no mods found in $physical_repo/mods, skipped the mods." >&2
	else
		# Our paths go first in the list and the other entries keep their order, so a second run changes nothing.
		# Python reads and checks settings.json and the plugin list first, so a bad file stops the
		# script before it writes or uninstalls anything.
		python3 -I - "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" "${mod_dirs[@]}" <<'PY'
import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile

KEY = "CLAUDE_CODE_PLUGIN_DIRS"
# claude-workbench is the current marketplace name. asarel-claude-skills is the name before the rename.
MARKETPLACES = ("claude-workbench", "asarel-claude-skills")
OLD_MARKETPLACE = "asarel-claude-skills"
# The marketplace part of the id Claude Code gives a plugin loaded from CLAUDE_CODE_PLUGIN_DIRS.
INLINE = "inline"

settings_arg = sys.argv[1]
wanted = sys.argv[2:]
path = os.path.realpath(settings_arg)
config_dir = os.path.dirname(os.path.abspath(settings_arg))
names = [os.path.basename(w) for w in wanted]


def say(message):
	print(message, flush=True)


def warn(message):
	print(f"warning: {message}", file=sys.stderr, flush=True)


def die(message):
	print(message, file=sys.stderr, flush=True)
	sys.exit(1)


def fail(reason):
	die(f"{path} {reason}. Fix it and re-run this script.")


def claude(*args):
	return subprocess.run(
		["claude", *args],
		stdin=subprocess.DEVNULL,
		stdout=subprocess.PIPE,
		stderr=subprocess.PIPE,
		encoding="utf-8",
		errors="replace",
	)


def norm(entry):
	"""Absolute entries: ~ expanded, symlinks and trailing slashes resolved. Relative entries stay lexical."""
	expanded = os.path.expanduser(entry)
	if os.path.isabs(expanded):
		return os.path.realpath(expanded)
	return os.path.normpath(expanded)


def in_other_clone(n):
	"""True when n is <clone>/mods/<x> and <clone> holds this repo's marketplace manifest."""
	mods_dir = os.path.dirname(n)
	if os.path.basename(mods_dir) != "mods":
		return False
	manifest = os.path.join(os.path.dirname(mods_dir), ".claude-plugin", "marketplace.json")
	try:
		with open(manifest, encoding="utf-8-sig") as f:
			return json.load(f).get("name") in MARKETPLACES
	except (OSError, ValueError, AttributeError):
		return False


def stale_reason(entry):
	"""Why an entry that is not ours should go, or None to keep it."""
	n = norm(entry)
	if not os.path.isabs(n):
		return None
	if os.path.basename(n) in names and os.path.basename(os.path.dirname(n)) == "mods" and not os.path.exists(n):
		return "its folder is missing"
	if in_other_clone(n):
		return "it is inside another clone of this repo"
	return None


def write_json(target, data, prefix):
	directory = os.path.dirname(target)
	os.makedirs(directory, exist_ok=True)
	fd, tmp = tempfile.mkstemp(dir=directory, prefix=prefix, suffix=".tmp")
	try:
		with os.fdopen(fd, "w", encoding="utf-8") as f:
			json.dump(data, f, indent=2, ensure_ascii=False)
			f.write("\n")
		if os.path.exists(target):
			os.chmod(tmp, os.stat(target).st_mode & 0o777)
		os.replace(tmp, target)
	except BaseException:
		try:
			os.unlink(tmp)
		except FileNotFoundError:
			pass
		raise


def store_file(ident):
	# Claude Code names a plugin's $.store file <name>_<marketplace>-<first 12 hex of sha256(id)>.json.
	name, market = ident.split("@", 1)
	digest = hashlib.sha256(ident.encode("utf-8")).hexdigest()[:12]
	return os.path.join(config_dir, "plugins", "store", f"{name}_{market}-{digest}.json")


def read_store(target):
	try:
		with open(target, encoding="utf-8-sig") as f:
			data = json.load(f)
	except FileNotFoundError:
		return None
	if not isinstance(data, dict):
		raise ValueError(f"{target} does not hold a JSON object")
	return data


def read_raw():
	try:
		with open(path, "rb") as f:
			return f.read()
	except FileNotFoundError:
		return b""
	except OSError as e:
		fail(f"could not be read ({e})")


def parse_settings(raw):
	"""Parses and checks the bytes of settings.json (a BOM is accepted). Returns the settings dict."""
	try:
		text = raw.decode("utf-8-sig")
	except UnicodeDecodeError as e:
		fail(f"is not valid UTF-8 ({e})")
	settings = {}
	if text.strip():
		try:
			settings = json.loads(text)
		except ValueError as e:
			fail(f"is not valid JSON ({e})")
	if not isinstance(settings, dict):
		fail("does not hold a JSON object")
	env = settings.get("env")
	if env is not None and not isinstance(env, dict):
		fail('has an "env" that is not an object')
	current = (env or {}).get(KEY)
	if current is not None and not isinstance(current, str):
		fail(f'has an "env.{KEY}" that is not a string')
	for key in ("pluginConfigs", "enabledPlugins"):
		if settings.get(key) is not None and not isinstance(settings[key], dict):
			fail(f'has a "{key}" that is not an object')
	return settings


# Read settings.json first, and check it before anything else runs.
raw = read_raw()
parse_settings(raw)

listed = claude("plugin", "list", "--json")
if listed.returncode != 0:
	die(f"claude plugin list --json failed ({listed.stderr.strip() or 'exit ' + str(listed.returncode)}). Fix it and re-run this script.")
try:
	installed = json.loads(listed.stdout)
except ValueError:
	installed = None
if not isinstance(installed, list):
	die("claude plugin list --json did not print a JSON list. Fix it and re-run this script.")

# Marketplace copies of our mods. Each entry names its own scope, and uninstall needs the same one.
doomed = []
copies = {}
for entry in installed:
	ident = entry.get("id") if isinstance(entry, dict) else None
	if not isinstance(ident, str):
		continue
	scope = entry.get("scope")
	if any(ident == f"{name}@{market}" for name in names for market in MARKETPLACES):
		doomed.append((ident, scope if isinstance(scope, str) else "user"))
		copies[ident] = entry
doomed_ids = set(copies)


def plan(raw):
	"""Applies every settings.json change to the parsed bytes. Returns (settings, changed, messages)."""
	settings = parse_settings(raw)
	env = settings.get("env") or {}
	current = env.get(KEY) or ""
	messages = []
	changed = False

	# The first entry for a plugin name wins, so our paths go first and every other entry keeps its
	# order after them. Only an entry that cannot work is dropped: a missing mods/<our mod> folder,
	# or a folder inside another clone of this repo. Duplicates of our own paths collapse into one.
	ours = {norm(w) for w in wanted}
	others = []
	present = set()
	for entry in [p for p in current.split(os.pathsep) if p]:
		n = norm(entry)
		if n in ours:
			present.add(n)
			continue
		reason = stale_reason(entry)
		if reason is None:
			others.append(entry)
		else:
			messages.append(f"removed {entry} from {KEY}, {reason}")
	for folder in wanted:
		if norm(folder) not in present:
			messages.append(f"loading the {os.path.basename(folder)} mod from {folder}")
	value = os.pathsep.join(wanted + others)
	if value != current:
		env[KEY] = value
		settings["env"] = env
		changed = True

	# uninstall deletes pluginConfigs["<mod>@<marketplace>"]. A plugin loaded from CLAUDE_CODE_PLUGIN_DIRS
	# reads pluginConfigs["<mod>@inline"], so copy the entry there first. An existing entry there wins.
	configs = settings.get("pluginConfigs")
	for name in names:
		target = f"{name}@{INLINE}"
		if configs is not None and target not in configs:
			for market in MARKETPLACES:
				source = f"{name}@{market}"
				if source in doomed_ids and source in configs:
					configs[target] = copy.deepcopy(configs[source])
					messages.append(f"kept the {source} plugin config as {target}")
					changed = True
					break
		# A copy that is switched off stays off once it loads from the repo.
		for market in MARKETPLACES:
			source = f"{name}@{market}"
			if source in copies:
				if copies[source].get("enabled") is False:
					enabled = settings.get("enabledPlugins")
					if enabled is None:
						enabled = settings["enabledPlugins"] = {}
					if target not in enabled:
						enabled[target] = False
						messages.append(f"kept {source} disabled as {target}")
						changed = True
				break
	return settings, changed, messages


# The plugin list above can take a while, so another program may have edited settings.json since the
# first read. Right before the write, read it again. If it changed, plan again from the new content,
# once. A second change stops the script with nothing written.
for attempt in range(2):
	settings, changed, messages = plan(raw)
	if not changed:
		break
	fresh = read_raw()
	if fresh == raw:
		try:
			write_json(path, settings, ".settings-")
		except OSError as e:
			fail(f"could not be written ({e})")
		break
	raw = fresh
else:
	fail("changed while this script was running")
for message in messages:
	say(message)

# The plugin's $.store file is its saved data (the model-policy tally). Merge it into the inline
# plugin's file and keep what is already there. If that fails, the mod's marketplace copy stays
# installed, so a re-run tries again.
skipped = set()
for name in names:
	target = store_file(f"{name}@{INLINE}")
	for market in MARKETPLACES:
		source_id = f"{name}@{market}"
		if source_id not in doomed_ids:
			continue
		source_path = store_file(source_id)
		try:
			source = read_store(source_path)
			if source is None:
				continue
			existing = read_store(target)
			merged = dict(source)
			merged.update(existing or {})
			if merged != existing:
				write_json(target, merged, ".store-")
				say(f"kept the {source_id} plugin data as {name}@{INLINE}")
		except (OSError, ValueError) as e:
			skipped.add(source_id)
			warn(f"could not carry the {source_id} plugin data from {source_path} to {target} ({e}). The {source_id} copy stays installed, so re-run this script to try again.")

# Settings are written, so the copies can go. One that will not uninstall (a project install seen
# from another folder) is a warning, and the rest still go.
kept_markets = set()
for ident, scope in doomed:
	market = ident.split("@", 1)[1]
	if ident in skipped:
		kept_markets.add(market)
		continue
	result = claude("plugin", "uninstall", ident, "--scope", scope)
	if result.returncode == 0:
		say(f"removed {ident}")
	else:
		kept_markets.add(market)
		reason = (result.stdout + result.stderr).strip().splitlines()
		where = "" if scope == "user" else " in the project folder it was installed in"
		warn(f"could not uninstall {ident} ({reason[-1] if reason else 'exit ' + str(result.returncode)}). To remove it, run{where}: claude plugin uninstall {ident} --scope {scope}")

# Leaving the old marketplace registered makes "marketplace add" a no-op for the same folder,
# so anyone who adds the repo again would see every mod under both names. It stays while a plugin
# from it is still installed.
result = claude("plugin", "marketplace", "list", "--json")
if result.returncode != 0:
	warn(f"could not list the marketplaces, so the {OLD_MARKETPLACE} marketplace was not checked. Run: claude plugin marketplace remove {OLD_MARKETPLACE}")
else:
	try:
		marketplaces = json.loads(result.stdout)
		has_old = any(isinstance(m, dict) and m.get("name") == OLD_MARKETPLACE for m in marketplaces)
	except (ValueError, TypeError):
		warn("could not read the marketplace list, so the old marketplace was not checked")
		has_old = False
	if has_old and OLD_MARKETPLACE in kept_markets:
		warn(f"kept the {OLD_MARKETPLACE} marketplace registered, because a plugin from it is still installed. Once it is uninstalled, run: claude plugin marketplace remove {OLD_MARKETPLACE}")
	elif has_old:
		result = claude("plugin", "marketplace", "remove", OLD_MARKETPLACE)
		if result.returncode == 0:
			say(f"removed the {OLD_MARKETPLACE} marketplace")
		else:
			warn(f"could not remove the {OLD_MARKETPLACE} marketplace. Run: claude plugin marketplace remove {OLD_MARKETPLACE}")
PY
	fi
else
	echo "claude CLI not found, skipped the mods. Re-run this script after installing it." >&2
fi
