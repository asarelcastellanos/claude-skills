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

# The mods need the claude CLI. Skip them with a note when the CLI is missing.
# The marketplace is this repo's folder, so edits to a mod apply after /reload-plugins.
# Each folder under mods/ is named after its plugin, so the folder name is the install name.
if command -v claude >/dev/null 2>&1; then
	claude plugin marketplace add "$repo" --scope user >/dev/null
	for mod in "$repo"/mods/*/; do
		name="$(basename "$mod")"
		claude plugin install "$name@claude-workbench" --scope user >/dev/null
		echo "installed the $name mod"
	done
else
	echo "claude CLI not found, skipped the mods. Re-run this script after installing it." >&2
fi

if [ -d "$backup" ]; then echo "replaced skills were moved to $backup"; fi
