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

if [ -d "$backup" ]; then echo "replaced skills were moved to $backup"; fi
