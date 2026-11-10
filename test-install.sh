#!/usr/bin/env bash
# Runs install.sh against the real claude CLI in a throwaway HOME and CLAUDE_CONFIG_DIR.
# Needs bash, python3 and claude. Never reads or writes the real ~/.claude.
# Usage: bash test-install.sh
set -uo pipefail

self="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"
repo="$(dirname "$self")"
for tool in claude python3; do
	command -v "$tool" >/dev/null 2>&1 || { echo "$tool not found, it is required to run this test." >&2; exit 2; }
done

# Each case runs in its own bash under env -i (see run_case). That child gets the root from the parent.
if [ "${1:-}" = "--case" ]; then
	root="$2"
else
	root="$(mktemp -d)"
	trap 'chmod -R u+w "$root" 2>/dev/null; rm -rf "$root"' EXIT
fi

old_marketplace="asarel-claude-skills"

die() {
	echo "  $*" >&2
	exit 1
}

assert_eq() { [ "$1" = "$2" ] || die "$3: expected [$2], got [$1]"; }
assert_has() { grep -qF -- "$2" <<<"$1" || die "missing [$2] in: $1"; }
assert_lacks() { ! grep -qF -- "$2" <<<"$1" || die "unexpected [$2] in: $1"; }

# A fresh sandbox per case. Every assertion below runs against these two paths only.
new_env() {
	T="$(mktemp -d "$root/case.XXXXXX")"
	export HOME="$T/home" CLAUDE_CONFIG_DIR="$T/home/.claude"
	mkdir -p "$CLAUDE_CONFIG_DIR" "$T/cwd"
	cd "$T/cwd" || exit 1
	case "$CLAUDE_CONFIG_DIR" in "$root"/*) ;; *) die "sandbox escaped to $CLAUDE_CONFIG_DIR" ;; esac
	settings="$CLAUDE_CONFIG_DIR/settings.json"
	installed_file="$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
}

# Sets out and rc. The || keeps a failing installer from ending a case that expects the failure.
run_installer() {
	out="$(bash "${1:-$repo/install.sh}" 2>&1)" && rc=0 || rc=$?
}

# pyj <json file> <python expression over s>
pyj() {
	python3 -I -c 'import json, sys
s = json.load(open(sys.argv[1], encoding="utf-8-sig"))
print(eval(sys.argv[2]))' "$1" "$2"
}

# edit_settings <python statements over s>
edit_settings() {
	python3 -I -c 'import json, sys
p = sys.argv[1]
s = json.load(open(p))
exec(sys.argv[2])
json.dump(s, open(p, "w"), indent=2)' "$settings" "$1"
}

expected_dirs() {
	local d
	for d in "$repo"/mods/*/; do
		[ -d "$d" ] && echo "${d%/}"
	done | sort
}

mod_names() {
	local d
	for d in "$repo"/mods/*/; do
		[ -d "$d" ] && basename "$d"
	done
}

settings_dirs() {
	python3 -I -c 'import json, sys
s = json.load(open(sys.argv[1], encoding="utf-8-sig"))
for p in s.get("env", {}).get("CLAUDE_CODE_PLUGIN_DIRS", "").split(":"):
	if p:
		print(p)' "${1:-$settings}"
}

list_ids() {
	claude plugin list --json | python3 -I -c 'import json, sys
for e in json.load(sys.stdin):
	print(e["id"])'
}

install_copies() {
	claude plugin marketplace add "$repo" >/dev/null
	local name
	for name in "$@"; do
		claude plugin install "$name@claude-workbench" --scope user >/dev/null
	done
	assert_installs_in_sandbox
}

# Every marketplace install must live under this case's folder, never in a real config.
assert_installs_in_sandbox() {
	local bad physical
	physical="$(cd "$T" && pwd -P)"
	bad="$(claude plugin list --json | python3 -I -c 'import json, sys
roots = sys.argv[1:]
for e in json.load(sys.stdin):
	if not e["id"].endswith("@inline") and not any(e["installPath"].startswith(r) for r in roots):
		print(e["id"], e["installPath"])' "$T" "$physical")"
	[ -z "$bad" ] || die "installs outside the case root: $bad"
}

# "<name> <installPath>" for every plugin loaded from CLAUDE_CODE_PLUGIN_DIRS.
inline_paths() {
	claude plugin list --json | python3 -I -c 'import json, sys
for e in json.load(sys.stdin):
	if e["id"].endswith("@inline"):
		print(e["id"].split("@")[0], e["installPath"])' | sort
}

# make_mod <folder> <name>: the smallest folder Claude Code loads as a plugin.
make_mod() {
	mkdir -p "$1/.claude-plugin"
	echo "{\"name\":\"$2\",\"version\":\"0.0.1\"}" >"$1/.claude-plugin/plugin.json"
}

# A copy of this repo's marketplace under the name it had before the rename.
add_old_marketplace() {
	local dir="$T/old-marketplace"
	mkdir -p "$dir/.claude-plugin"
	cp -R "$repo/mods" "$dir/mods"
	python3 -I -c 'import json, sys
m = json.load(open(sys.argv[1]))
m["name"] = sys.argv[3]
json.dump(m, open(sys.argv[2], "w"))' "$repo/.claude-plugin/marketplace.json" "$dir/.claude-plugin/marketplace.json" "$old_marketplace"
	claude plugin marketplace add "$dir" >/dev/null
}

# A minimal repo copy for the cases that need a different layout around install.sh.
make_repo() {
	local dir="$1"
	mkdir -p "$dir/skills/sample" "$dir/mods"
	cp "$repo/install.sh" "$dir/install.sh"
	echo "# test" >"$dir/CLAUDE.md"
}

store_name() {
	python3 -I -c 'import hashlib, sys
ident = sys.argv[1]
name, market = ident.split("@")
print(name + "_" + market + "-" + hashlib.sha256(ident.encode()).hexdigest()[:12] + ".json")' "$1"
}

# ---- cases ----

case_fresh_install() {
	new_env
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(settings_dirs | sort)" "$(expected_dirs)" "env.CLAUDE_CODE_PLUGIN_DIRS"
	local ids name count expected=""
	ids="$(list_ids)"
	for name in $(mod_names); do
		assert_has "$ids" "$name@inline"
		expected="$expected$name $repo/mods/$name"$'\n'
	done
	count="$(grep -c '@inline$' <<<"$ids")"
	assert_eq "$count" "$(mod_names | wc -l | tr -d ' ')" "number of @inline plugins"
	assert_eq "$(inline_paths)" "$(printf '%s' "$expected" | sort)" "installPath of each @inline plugin"
}

case_second_run_identical() {
	new_env
	run_installer
	[ "$rc" -eq 0 ] || die "first run exited $rc: $out"
	local before after
	before="$(cksum <"$settings")"
	run_installer
	[ "$rc" -eq 0 ] || die "second run exited $rc: $out"
	after="$(cksum <"$settings")"
	assert_eq "$after" "$before" "settings.json checksum"
	assert_lacks "$out" "loading the"
}

case_marketplace_copies_removed() {
	new_env
	install_copies model-policy session-coach
	add_old_marketplace
	claude plugin install "session-monitor@$old_marketplace" --scope user >/dev/null
	assert_installs_in_sandbox
	local ids
	ids="$(list_ids)"
	assert_has "$ids" "model-policy@claude-workbench"
	assert_has "$ids" "session-monitor@$old_marketplace"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	ids="$(list_ids)"
	assert_lacks "$ids" "@claude-workbench"
	assert_lacks "$ids" "@$old_marketplace"
	assert_has "$ids" "model-policy@inline"
	assert_lacks "$(claude plugin marketplace list --json)" "\"name\": \"$old_marketplace\""
}

case_unrelated_settings_survive() {
	new_env
	cat >"$settings" <<JSON
{
  "theme": "dark",
  "permissions": { "allow": ["Bash(ls)"] },
  "env": { "FOO": "bar", "CLAUDE_CODE_PLUGIN_DIRS": "/foreign/plugins/thing" }
}
JSON
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(pyj "$settings" 's["theme"]')" "dark" "theme"
	assert_eq "$(pyj "$settings" 's["permissions"]["allow"]')" "['Bash(ls)']" "permissions"
	assert_eq "$(pyj "$settings" 's["env"]["FOO"]')" "bar" "env.FOO"
	assert_eq "$(settings_dirs | head -3)" "$(expected_dirs)" "our entries come first"
	assert_eq "$(settings_dirs | tail -1)" "/foreign/plugins/thing" "foreign entry stays after ours"
}

case_stale_entries_removed() {
	new_env
	# Two other clones of this repo (they hold the marketplace manifest), one under each marketplace name.
	local c
	for c in clone-a:claude-workbench clone-b:asarel-claude-skills; do
		mkdir -p "$T/${c%%:*}/.claude-plugin" "$T/${c%%:*}/mods/session-monitor"
		echo "{\"name\":\"${c##*:}\"}" >"$T/${c%%:*}/.claude-plugin/marketplace.json"
	done
	# A folder of the user's own that happens to share a mod name, and an unrelated plugin.
	mkdir -p "$T/mine/mods/session-monitor" "$T/foreign/mods/other-mod"
	local list="$T/clone-a/mods/session-monitor:$T/clone-b/mods/session-monitor:$T/gone/mods/model-policy:~/clone/mods/session-coach/:$T/mine/mods/session-monitor:$T/foreign/mods/other-mod"
	echo "{\"env\":{\"CLAUDE_CODE_PLUGIN_DIRS\":\"$list\"}}" >"$settings"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	local dirs
	dirs="$(settings_dirs)"
	assert_lacks "$dirs" "$T/clone-a"
	assert_lacks "$dirs" "$T/clone-b"
	assert_lacks "$dirs" "$T/gone/mods/model-policy"
	assert_lacks "$dirs" "~/clone/mods/session-coach"
	assert_has "$out" "removed $T/clone-a/mods/session-monitor"
	assert_has "$out" "removed $T/gone/mods/model-policy"
	assert_eq "$(sed -n '1,3p' <<<"$dirs")" "$(expected_dirs)" "our entries come first"
	assert_eq "$(sed -n '4,$p' <<<"$dirs")" "$T/mine/mods/session-monitor"$'\n'"$T/foreign/mods/other-mod" "kept entries and their order"
}

case_equivalent_spellings_not_duplicated() {
	new_env
	ln -s "$repo" "$T/link"
	local first second
	first="$(mod_names | sed -n 1p)"
	second="$(mod_names | sed -n 2p)"
	echo "{\"env\":{\"CLAUDE_CODE_PLUGIN_DIRS\":\"$repo/mods/$second/:$repo/mods/$first:$T/link/mods/$first/:$repo/mods/$first/\"}}" >"$settings"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(settings_dirs)" "$(expected_dirs)" "each of our paths once, in order"
}

case_invalid_json_changes_nothing() {
	new_env
	install_copies model-policy
	printf '{"theme":' >"$settings"
	local before_settings before_installed
	before_settings="$(cksum <"$settings")"
	before_installed="$(cksum <"$installed_file")"
	run_installer
	[ "$rc" -ne 0 ] || die "installer exited 0 on invalid JSON"
	assert_has "$out" "is not valid JSON"
	assert_eq "$(cksum <"$settings")" "$before_settings" "settings.json checksum"
	assert_eq "$(cksum <"$installed_file")" "$before_installed" "installed_plugins.json checksum"
	assert_has "$(cat "$installed_file")" "model-policy@claude-workbench"
	assert_eq "$(ls -A "$CLAUDE_CONFIG_DIR" | grep -c '^\.settings-' || true)" "0" "leftover temp files"
}

case_bad_settings_shape_changes_nothing() {
	new_env
	install_copies model-policy
	local before_installed shape
	before_installed="$(cksum <"$installed_file")"
	for shape in '{"env":"text"}' '{"env":["x"]}' '[1]' '{"env":{"CLAUDE_CODE_PLUGIN_DIRS":5}}'; do
		echo "$shape" >"$settings"
		local before_settings
		before_settings="$(cksum <"$settings")"
		run_installer
		[ "$rc" -ne 0 ] || die "installer exited 0 for $shape"
		assert_eq "$(cksum <"$settings")" "$before_settings" "settings.json for $shape"
		assert_eq "$(cksum <"$installed_file")" "$before_installed" "installed_plugins.json for $shape"
	done
	assert_has "$(cat "$installed_file")" "model-policy@claude-workbench"
}

case_python_that_does_not_run() {
	new_env
	install_copies model-policy
	mkdir -p "$T/bin"
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/python3"
	chmod +x "$T/bin/python3"
	local before_installed
	before_installed="$(cksum <"$installed_file")"
	out="$(PATH="$T/bin:$PATH" bash "$repo/install.sh" 2>&1)" && rc=0 || rc=$?
	[ "$rc" -ne 0 ] || die "installer exited 0 with a broken python3"
	assert_has "$out" "does not run"
	assert_lacks "$(cat "$settings" 2>/dev/null)" "CLAUDE_CODE_PLUGIN_DIRS"
	assert_eq "$(cksum <"$installed_file")" "$before_installed" "installed_plugins.json checksum"
}

case_project_scope_does_not_abort() {
	new_env
	mkdir -p "$T/proj"
	claude plugin marketplace add "$repo" >/dev/null
	claude plugin install model-policy@claude-workbench --scope user >/dev/null
	(cd "$T/proj" && claude plugin install session-coach@claude-workbench --scope project >/dev/null)
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_has "$out" "removed model-policy@claude-workbench"
	assert_has "$out" "claude plugin uninstall session-coach@claude-workbench --scope project"
	local ids name
	ids="$(list_ids)"
	assert_lacks "$ids" "model-policy@claude-workbench"
	for name in $(mod_names); do assert_has "$ids" "$name@inline"; done
	# From the project folder the same copy uninstalls with its own scope.
	cd "$T/proj"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc from the project folder: $out"
	assert_has "$out" "removed session-coach@claude-workbench"
	assert_lacks "$(list_ids)" "@claude-workbench"
}

case_symlinked_settings_stays_a_symlink() {
	new_env
	mkdir -p "$T/dotfiles"
	echo '{"theme":"dark"}' >"$T/dotfiles/settings.json"
	ln -s "$T/dotfiles/settings.json" "$settings"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	[ -L "$settings" ] || die "settings.json is no longer a symlink"
	assert_eq "$(pyj "$T/dotfiles/settings.json" 's["theme"]')" "dark" "theme in the target"
	assert_eq "$(settings_dirs "$T/dotfiles/settings.json" | sort)" "$(expected_dirs)" "dirs in the target"
}

case_plugin_config_survives() {
	new_env
	install_copies model-policy
	claude plugin install model-policy@claude-workbench --scope user --config mechanicModel=sonnet >/dev/null
	assert_eq "$(pyj "$settings" 's["pluginConfigs"]["model-policy@claude-workbench"]["options"]["mechanicModel"]')" "sonnet" "config before"
	local store="$CLAUDE_CONFIG_DIR/plugins/store" inline_store
	mkdir -p "$store"
	echo '{"day-2026-01-01-abc":{"count":2},"shared":"old"}' >"$store/$(store_name model-policy@claude-workbench)"
	inline_store="$store/$(store_name model-policy@inline)"
	echo '{"shared":"new"}' >"$inline_store"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(pyj "$settings" 's["pluginConfigs"]["model-policy@inline"]["options"]["mechanicModel"]')" "sonnet" "config after"
	assert_lacks "$(list_ids)" "model-policy@claude-workbench"
	assert_eq "$(pyj "$inline_store" 's["day-2026-01-01-abc"]["count"]')" "2" "store key carried"
	assert_eq "$(pyj "$inline_store" 's["shared"]')" "new" "existing store key kept"
}

case_plugin_config_does_not_overwrite() {
	new_env
	install_copies model-policy
	claude plugin install model-policy@claude-workbench --scope user --config mechanicModel=sonnet >/dev/null
	edit_settings 's.setdefault("pluginConfigs", {})["model-policy@inline"] = {"options": {"mechanicModel": "haiku"}}'
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(pyj "$settings" 's["pluginConfigs"]["model-policy@inline"]["options"]["mechanicModel"]')" "haiku" "existing inline config"
}

# Proves the key the installer writes is the one a CLAUDE_CODE_PLUGIN_DIRS plugin reads.
# The engine logs an error for an option value that is not allowed, so a bad value shows where it looks.
case_engine_reads_the_inline_key() {
	new_env
	install_copies model-policy
	edit_settings 's.setdefault("pluginConfigs", {})["model-policy@claude-workbench"] = {"options": {"mechanicModel": "not-a-model"}}'
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	claude -p "hi" --debug-file "$T/debug.log" </dev/null >/dev/null 2>&1 || true
	assert_has "$(cat "$T/debug.log")" "option mechanicModel in settings is not one of"
}

case_bom_file_parses() {
	new_env
	printf '\xef\xbb\xbf{"theme":"dark"}\n' >"$settings"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(pyj "$settings" 's["theme"]')" "dark" "theme"
	assert_eq "$(settings_dirs | sort)" "$(expected_dirs)" "dirs"
	assert_eq "$(head -c 1 "$settings" | od -An -tx1 | tr -d ' ')" "7b" "first byte (no BOM)"
}

case_backup_path_is_printed_before_a_failure() {
	new_env
	local skill
	skill="$(basename "$(ls -d "$repo"/skills/*/ | head -1)")"
	mkdir -p "$HOME/.claude/skills/$skill"
	echo local >"$HOME/.claude/skills/$skill/edited.txt"
	printf '{' >"$settings"
	run_installer
	[ "$rc" -ne 0 ] || die "installer exited 0 on invalid JSON"
	assert_has "$out" "moved the existing $skill to $HOME/.claude/skills-backup-"
	[ -f "$(ls -d "$HOME"/.claude/skills-backup-*/"$skill" | head -1)/edited.txt" ] || die "backup does not hold the old skill"
}

case_colon_in_path_is_rejected() {
	new_env
	install_copies model-policy
	local fake="$T/a:b"
	make_repo "$fake"
	mkdir "$fake/mods/sample-mod"
	local before_installed
	before_installed="$(cksum <"$installed_file")"
	run_installer "$fake/install.sh"
	[ "$rc" -ne 0 ] || die "installer exited 0 for a path with a colon"
	assert_has "$out" "colon"
	assert_lacks "$(cat "$settings")" "CLAUDE_CODE_PLUGIN_DIRS"
	assert_eq "$(cksum <"$installed_file")" "$before_installed" "installed_plugins.json checksum"
}

case_empty_mods_folder() {
	new_env
	local fake="$T/emptyrepo"
	make_repo "$fake"
	run_installer "$fake/install.sh"
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_has "$out" "no mods found"
	assert_lacks "$out" 'mods/*'
	[ ! -e "$settings" ] || assert_lacks "$(cat "$settings")" "CLAUDE_CODE_PLUGIN_DIRS"
}

# A ~/ spelling of our own path (the repo sits under $HOME) is the same entry, so it is not listed twice.
case_tilde_spelling_is_one_entry() {
	new_env
	make_repo "$HOME/clone"
	make_mod "$HOME/clone/mods/alpha" alpha
	echo '{"env":{"CLAUDE_CODE_PLUGIN_DIRS":"~/clone/mods/alpha"}}' >"$settings"
	run_installer "$HOME/clone/install.sh"
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(settings_dirs)" "$(cd "$HOME/clone" && pwd -P)/mods/alpha" "one entry"
}

case_our_paths_first_and_same_named_foreign_kept() {
	new_env
	mkdir -p "$T/foreign/mods/model-policy" "$T/foreign/other"
	echo "{\"env\":{\"CLAUDE_CODE_PLUGIN_DIRS\":\"$T/foreign/mods/model-policy:$T/foreign/other\"}}" >"$settings"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(settings_dirs | sed -n '1,3p')" "$(expected_dirs)" "our entries come first"
	assert_eq "$(settings_dirs | sed -n '4,$p')" "$T/foreign/mods/model-policy"$'\n'"$T/foreign/other" "foreign entries keep their order"
	assert_eq "$(inline_paths | grep '^model-policy ')" "model-policy $repo/mods/model-policy" "the repo's model-policy is the one loaded"
}

case_write_failure_keeps_the_copies() {
	new_env
	if [ "$(id -u)" -eq 0 ]; then echo "  skipped, a root user can write to a read-only folder"; return 0; fi
	install_copies model-policy
	mkdir "$T/ro"
	mv "$settings" "$T/ro/settings.json"
	ln -s "$T/ro/settings.json" "$settings"
	chmod a-w "$T/ro"
	local before_installed
	before_installed="$(cksum <"$installed_file")"
	run_installer
	chmod u+w "$T/ro"
	[ "$rc" -ne 0 ] || die "installer exited 0 when settings.json could not be written"
	assert_has "$out" "could not be written"
	assert_eq "$(cksum <"$installed_file")" "$before_installed" "installed_plugins.json checksum"
	assert_has "$(cat "$installed_file")" "model-policy@claude-workbench"
}

case_old_marketplace_config_and_store_carry() {
	new_env
	add_old_marketplace
	claude plugin install "model-policy@$old_marketplace" --scope user --config mechanicModel=sonnet >/dev/null
	assert_installs_in_sandbox
	local store="$CLAUDE_CONFIG_DIR/plugins/store" inline_store
	mkdir -p "$store"
	echo '{"day-2026-01-01-abc":{"count":3}}' >"$store/$(store_name "model-policy@$old_marketplace")"
	inline_store="$store/$(store_name model-policy@inline)"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(pyj "$settings" 's["pluginConfigs"]["model-policy@inline"]["options"]["mechanicModel"]')" "sonnet" "config"
	assert_eq "$(pyj "$inline_store" 's["day-2026-01-01-abc"]["count"]')" "3" "store"
	assert_lacks "$(list_ids)" "@$old_marketplace"
}

# The dirs are already right, so the config copy is the only change and must still be written.
case_config_only_change_is_written() {
	new_env
	install_copies model-policy
	claude plugin install model-policy@claude-workbench --scope user --config mechanicModel=sonnet >/dev/null
	DIRS="$(expected_dirs | paste -sd: -)" edit_settings 's["env"] = {"CLAUDE_CODE_PLUGIN_DIRS": __import__("os").environ["DIRS"]}'
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_lacks "$out" "loading the"
	assert_eq "$(pyj "$settings" 's["pluginConfigs"]["model-policy@inline"]["options"]["mechanicModel"]')" "sonnet" "config"
}

case_disabled_copy_stays_disabled() {
	new_env
	install_copies model-policy
	claude plugin disable model-policy@claude-workbench --scope user >/dev/null
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(pyj "$settings" 's["enabledPlugins"]["model-policy@inline"]')" "False" "enabledPlugins"
	assert_eq "$(claude plugin list --json | python3 -I -c 'import json, sys
for e in json.load(sys.stdin):
	if e["id"] == "model-policy@inline":
		print(e["enabled"])')" "False" "enabled in the plugin list"
}

case_failed_uninstall_keeps_the_old_marketplace() {
	new_env
	mkdir -p "$T/proj"
	add_old_marketplace
	(cd "$T/proj" && claude plugin install "session-coach@$old_marketplace" --scope project >/dev/null)
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_has "$out" "kept the $old_marketplace marketplace registered"
	assert_has "$out" "claude plugin marketplace remove $old_marketplace"
	assert_has "$(claude plugin marketplace list --json)" "\"name\": \"$old_marketplace\""
	# From the project folder the uninstall works, and then the marketplace goes too.
	cd "$T/proj"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc from the project folder: $out"
	assert_has "$out" "removed the $old_marketplace marketplace"
	assert_lacks "$(claude plugin marketplace list --json)" "\"name\": \"$old_marketplace\""
}

case_store_carry_failure_keeps_the_copy() {
	new_env
	install_copies model-policy
	local store="$CLAUDE_CONFIG_DIR/plugins/store" target
	mkdir -p "$store"
	echo '{"day-2026-01-01-abc":{"count":1}}' >"$store/$(store_name model-policy@claude-workbench)"
	target="$store/$(store_name model-policy@inline)"
	mkdir "$target"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_has "$out" "could not carry the model-policy@claude-workbench plugin data from $store/$(store_name model-policy@claude-workbench) to $target"
	assert_has "$(list_ids)" "model-policy@claude-workbench"
	rmdir "$target"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc on the re-run: $out"
	assert_lacks "$(list_ids)" "model-policy@claude-workbench"
	assert_eq "$(pyj "$target" 's["day-2026-01-01-abc"]["count"]')" "1" "store after the re-run"
}

case_worktree_is_refused() {
	new_env
	local main="$T/main"
	make_repo "$main"
	make_mod "$main/mods/alpha" alpha
	git -C "$main" init -q
	git -C "$main" add -A
	git -C "$main" -c user.name=test -c user.email=test@example.com -c commit.gpgsign=false commit -q -m init
	git -C "$main" worktree add -q "$T/wt"
	run_installer "$T/wt/install.sh"
	[ "$rc" -ne 0 ] || die "installer exited 0 in a linked worktree"
	assert_has "$out" "linked git worktree"
	[ ! -e "$HOME/.claude/skills" ] || die "the worktree run linked skills"
	run_installer "$main/install.sh"
	[ "$rc" -eq 0 ] || die "installer exited $rc in the main checkout: $out"
}

# Another program edits settings.json while the plugin list runs. The edit must survive.
case_concurrent_edit_is_kept() {
	new_env
	echo '{"theme":"dark"}' >"$settings"
	mkdir -p "$T/bin"
	local real
	real="$(command -v claude)"
	cat >"$T/bin/claude" <<STUB
#!/bin/sh
if [ "\$1" = plugin ] && [ "\$2" = list ] && [ ! -e "$T/hooked" ]; then
	: >"$T/hooked"
	python3 -I -c 'import json, sys
p = sys.argv[1]
s = json.load(open(p))
s["concurrent"] = True
json.dump(s, open(p, "w"))' "$settings"
fi
exec "$real" "\$@"
STUB
	chmod +x "$T/bin/claude"
	out="$(PATH="$T/bin:$PATH" bash "$repo/install.sh" 2>&1)" && rc=0 || rc=$?
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	[ -e "$T/hooked" ] || die "the claude stub never ran"
	assert_eq "$(pyj "$settings" 's["concurrent"]')" "True" "the concurrent edit"
	assert_eq "$(pyj "$settings" 's["theme"]')" "dark" "theme"
	assert_eq "$(settings_dirs | sort)" "$(expected_dirs)" "dirs"
}

# ---- runner ----

# A child run: execute one case and exit. The parent starts it under env -i.
if [ "${1:-}" = "--case" ]; then
	( set -e; "$3" )
	exit $?
fi

passed=0
failed=0
run_case() {
	local label="$1" fn="$2" log="$root/log.$2" v
	# Only these variables reach a case, so CLAUDE_CODE_PLUGIN_CACHE_DIR, XDG_*, provider keys and
	# base URLs from the caller cannot leak in. HOME and CLAUDE_CONFIG_DIR point into the root.
	local allowed=()
	for v in PATH TMPDIR TERM LANG USER LOGNAME SHELL $(compgen -e | grep '^LC_' || true); do
		if [ -n "${!v+x}" ]; then allowed+=("$v=${!v}"); fi
	done
	env -i "${allowed[@]}" HOME="$root/nohome" CLAUDE_CONFIG_DIR="$root/nohome/.claude" bash "$self" --case "$root" "$fn" >"$log" 2>&1
	local code=$?
	if [ "$code" -eq 0 ]; then
		echo "PASS $label"
		passed=$((passed + 1))
	else
		echo "FAIL $label"
		sed 's/^/    /' "$log"
		failed=$((failed + 1))
	fi
}

run_case "fresh install sets the mod paths and loads each mod as @inline" case_fresh_install
run_case "second run leaves settings.json byte-identical" case_second_run_identical
run_case "marketplace copies (current and old marketplace) are removed" case_marketplace_copies_removed
run_case "unrelated settings keys and a foreign plugin dir survive" case_unrelated_settings_survive
run_case "entries in other clones and missing mod folders are removed, others kept" case_stale_entries_removed
run_case "duplicate spellings of our paths collapse to one, in order" case_equivalent_spellings_not_duplicated
run_case "invalid JSON exits non-zero and changes nothing" case_invalid_json_changes_nothing
run_case "non-object settings, env and dirs change nothing" case_bad_settings_shape_changes_nothing
run_case "a python3 that does not run changes nothing" case_python_that_does_not_run
run_case "a project-scope copy does not abort the script" case_project_scope_does_not_abort
run_case "a symlinked settings.json stays a symlink" case_symlinked_settings_stays_a_symlink
run_case "a pluginConfigs entry and the plugin store survive the migration" case_plugin_config_survives
run_case "an existing inline pluginConfigs entry is not overwritten" case_plugin_config_does_not_overwrite
run_case "the engine reads the key the installer copies the config to" case_engine_reads_the_inline_key
run_case "a settings.json with a BOM parses and is written without one" case_bom_file_parses
run_case "the skills backup path is printed before a later failure" case_backup_path_is_printed_before_a_failure
run_case "a repo path with a colon is rejected" case_colon_in_path_is_rejected
run_case "a ~/ spelling of our own path is kept as one entry" case_tilde_spelling_is_one_entry
run_case "our paths come first and a same-named foreign plugin is kept after them" case_our_paths_first_and_same_named_foreign_kept
run_case "a settings write failure keeps the marketplace copies" case_write_failure_keeps_the_copies
run_case "config and store from the old marketplace carry to @inline" case_old_marketplace_config_and_store_carry
run_case "a config-only change is written when the dirs are already right" case_config_only_change_is_written
run_case "a disabled marketplace copy stays disabled as @inline" case_disabled_copy_stays_disabled
run_case "a failed uninstall keeps the old marketplace registered" case_failed_uninstall_keeps_the_old_marketplace
run_case "a store that cannot be carried keeps the marketplace copy" case_store_carry_failure_keeps_the_copy
run_case "a linked worktree is refused" case_worktree_is_refused
run_case "an edit made to settings.json during the run is kept" case_concurrent_edit_is_kept
run_case "an empty mods folder is skipped" case_empty_mods_folder

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
