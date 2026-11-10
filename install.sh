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
if command -v claude >/dev/null 2>&1; then
	if ! command -v python3 >/dev/null 2>&1; then
		echo "python3 not found, it edits settings.json. Install it and re-run this script." >&2
		exit 1
	fi
	installed="$(claude plugin list --json)"
	for mod in "$repo"/mods/*/; do
		name="$(basename "$mod")"
		# claude-workbench is the current marketplace name. asarel-claude-skills is the name before the rename.
		for marketplace in claude-workbench asarel-claude-skills; do
			if grep -qF "\"id\": \"$name@$marketplace\"" <<<"$installed"; then
				claude plugin uninstall "$name@$marketplace" --scope user >/dev/null
				echo "removed $name@$marketplace"
			fi
		done
	done
	# Leaving the old marketplace registered makes "marketplace add" a no-op for the same folder,
	# so anyone who adds the repo again would see every mod under both names.
	old_marketplace="asarel-claude-skills"
	if claude plugin marketplace list --json | grep -qF "\"name\": \"$old_marketplace\""; then
		claude plugin marketplace remove "$old_marketplace" >/dev/null
		echo "removed the $old_marketplace marketplace"
	fi
	mod_dirs=()
	for mod in "$repo"/mods/*/; do mod_dirs+=("${mod%/}"); done
	# Keep any folders already listed and add only the missing ones, so a second run changes nothing.
	# An unreadable settings.json stops the script before it writes anything.
	python3 -I - "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" "${mod_dirs[@]}" <<'PY'
import json
import os
import sys
import tempfile

KEY = "CLAUDE_CODE_PLUGIN_DIRS"
path = os.path.realpath(sys.argv[1])
wanted = sys.argv[2:]


def fail(reason):
	print(f"{path} {reason}. Fix it and re-run this script.", file=sys.stderr)
	sys.exit(1)


def same(a, b):
	return a.rstrip("/") == b.rstrip("/")


try:
	with open(path, encoding="utf-8") as f:
		text = f.read()
except FileNotFoundError:
	text = ""
settings = {}
if text.strip():
	try:
		settings = json.loads(text)
	except ValueError as e:
		fail(f"is not valid JSON ({e})")
if not isinstance(settings, dict):
	fail("does not hold a JSON object")
env = settings.get("env", {})
if not isinstance(env, dict):
	fail('has an "env" that is not an object')
current = env.get(KEY, "")
if not isinstance(current, str):
	fail(f'has an "env.{KEY}" that is not a string')

folders = [p for p in current.split(os.pathsep) if p]
added = [w for w in wanted if not any(same(w, p) for p in folders)]
if not added:
	sys.exit(0)

env[KEY] = os.pathsep.join(folders + added)
settings["env"] = env
os.makedirs(os.path.dirname(path), exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".settings-", suffix=".tmp")
try:
	with os.fdopen(fd, "w", encoding="utf-8") as f:
		json.dump(settings, f, indent=2, ensure_ascii=False)
		f.write("\n")
	if os.path.exists(path):
		os.chmod(tmp, os.stat(path).st_mode & 0o777)
	os.replace(tmp, path)
except BaseException:
	os.unlink(tmp)
	raise
for folder in added:
	print(f"loading the {os.path.basename(folder)} mod from {folder}")
PY
else
	echo "claude CLI not found, skipped the mods. Re-run this script after installing it." >&2
fi

if [ -d "$backup" ]; then echo "replaced skills were moved to $backup"; fi
