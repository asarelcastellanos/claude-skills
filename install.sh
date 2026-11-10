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
		# Keep any folders already listed and add only the missing ones, so a second run changes nothing.
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


def mod_name_of(entry):
	"""The mod name when the entry is a folder named mods/<one of our mods>, else None."""
	n = norm(entry)
	name = os.path.basename(n)
	if name in names and os.path.basename(os.path.dirname(n)) == "mods":
		return name
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


# Read settings.json. A BOM is accepted, and the write below has none.
try:
	with open(path, encoding="utf-8-sig") as f:
		text = f.read()
except FileNotFoundError:
	text = ""
except (OSError, UnicodeDecodeError) as e:
	fail(f"could not be read ({e})")
settings = {}
if text.strip():
	try:
		settings = json.loads(text)
	except ValueError as e:
		fail(f"is not valid JSON ({e})")
if not isinstance(settings, dict):
	fail("does not hold a JSON object")
env = settings.get("env")
if env is None:
	env = {}
if not isinstance(env, dict):
	fail('has an "env" that is not an object')
current = env.get(KEY)
if current is None:
	current = ""
if not isinstance(current, str):
	fail(f'has an "env.{KEY}" that is not a string')
configs = settings.get("pluginConfigs")
if configs is not None and not isinstance(configs, dict):
	fail('has a "pluginConfigs" that is not an object')

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
for entry in installed:
	ident = entry.get("id") if isinstance(entry, dict) else None
	if not isinstance(ident, str):
		continue
	scope = entry.get("scope")
	if any(ident == f"{name}@{market}" for name in names for market in MARKETPLACES):
		doomed.append((ident, scope if isinstance(scope, str) else "user"))
doomed_ids = {ident for ident, _ in doomed}

# The first entry for a plugin name wins, so a stale entry (another clone, an old clone, a deleted
# folder) named mods/<our mod> would shadow this repo. Everything else in the list stays.
ours = {norm(w) for w in wanted}
kept = []
present = set()
messages = []
for entry in [p for p in current.split(os.pathsep) if p]:
	n = norm(entry)
	if n in ours:
		kept.append(entry)
		present.add(n)
	elif mod_name_of(entry) is not None:
		messages.append(f"removed {entry} from {KEY}, it shadows the {mod_name_of(entry)} mod from this repo")
	else:
		kept.append(entry)
added = [w for w in wanted if norm(w) not in present]
value = os.pathsep.join(kept + added)
changed = value != current
for folder in added:
	messages.append(f"loading the {os.path.basename(folder)} mod from {folder}")

# uninstall deletes pluginConfigs["<mod>@<marketplace>"]. A plugin loaded from CLAUDE_CODE_PLUGIN_DIRS
# reads pluginConfigs["<mod>@inline"], so copy the entry there first. An existing entry there wins.
if configs is not None:
	for name in names:
		target = f"{name}@{INLINE}"
		if target in configs:
			continue
		for market in MARKETPLACES:
			source = f"{name}@{market}"
			if source in doomed_ids and source in configs:
				configs[target] = copy.deepcopy(configs[source])
				messages.append(f"kept the {source} plugin config as {target}")
				changed = True
				break

if changed:
	if value != current:
		env[KEY] = value
		settings["env"] = env
	try:
		write_json(path, settings, ".settings-")
	except OSError as e:
		fail(f"could not be written ({e})")
for message in messages:
	say(message)

# The plugin's $.store file is its saved data (the model-policy tally). Merge it into the inline
# plugin's file and keep what is already there. This is best effort, the settings are already written.
for name in names:
	target = store_file(f"{name}@{INLINE}")
	for market in MARKETPLACES:
		source_id = f"{name}@{market}"
		if source_id not in doomed_ids:
			continue
		try:
			source = read_store(store_file(source_id))
			if source is None:
				continue
			merged = dict(source)
			merged.update(read_store(target) or {})
			if merged != read_store(target):
				write_json(target, merged, ".store-")
				say(f"kept the {source_id} plugin data as {name}@{INLINE}")
		except (OSError, ValueError) as e:
			warn(f"could not carry the {source_id} plugin data to {name}@{INLINE} ({e})")

# Settings are written, so the copies can go. One that will not uninstall (a project install seen
# from another folder) is a warning, and the rest still go.
for ident, scope in doomed:
	result = claude("plugin", "uninstall", ident, "--scope", scope)
	if result.returncode == 0:
		say(f"removed {ident}")
	else:
		reason = (result.stdout + result.stderr).strip().splitlines()
		where = "" if scope == "user" else " in the project folder it was installed in"
		warn(f"could not uninstall {ident} ({reason[-1] if reason else 'exit ' + str(result.returncode)}). To remove it, run{where}: claude plugin uninstall {ident} --scope {scope}")

# Leaving the old marketplace registered makes "marketplace add" a no-op for the same folder,
# so anyone who adds the repo again would see every mod under both names.
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
	if has_old:
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
