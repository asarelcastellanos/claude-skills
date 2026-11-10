#!/usr/bin/env bash
# Runs install.sh against the real claude CLI in a throwaway HOME and CLAUDE_CONFIG_DIR.
# Needs bash, python3 and claude. Never reads or writes the real ~/.claude.
# Usage: bash test-install.sh
set -uo pipefail

repo="$(cd "$(dirname "$0")" && pwd -P)"
for tool in claude python3; do
	command -v "$tool" >/dev/null 2>&1 || { echo "$tool not found, it is required to run this test." >&2; exit 2; }
done

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

# Keep the run offline and keep the caller's plugin setup out of it.
unset CLAUDE_CODE_PLUGIN_DIRS ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN

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
	local ids name count
	ids="$(list_ids)"
	for name in $(mod_names); do assert_has "$ids" "$name@inline"; done
	count="$(grep -c '@inline$' <<<"$ids")"
	assert_eq "$count" "$(mod_names | wc -l | tr -d ' ')" "number of @inline plugins"
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
	assert_eq "$(settings_dirs | head -1)" "/foreign/plugins/thing" "foreign entry stays first"
	assert_eq "$(settings_dirs | sort | grep -vxF /foreign/plugins/thing)" "$(expected_dirs)" "our entries"
}

case_stale_entries_removed() {
	new_env
	mkdir -p "$T/other/mods/session-monitor" "$T/foreign/session-monitor" "$T/foreign/mods/other-mod"
	local list="$T/other/mods/session-monitor:$T/gone/mods/model-policy:~/clone/mods/session-coach/:$T/foreign/session-monitor:$T/foreign/mods/other-mod"
	echo "{\"env\":{\"CLAUDE_CODE_PLUGIN_DIRS\":\"$list\"}}" >"$settings"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	local dirs
	dirs="$(settings_dirs)"
	assert_lacks "$dirs" "$T/other/mods/session-monitor"
	assert_lacks "$dirs" "$T/gone/mods/model-policy"
	assert_lacks "$dirs" "~/clone/mods/session-coach"
	assert_has "$dirs" "$T/foreign/session-monitor"
	assert_has "$dirs" "$T/foreign/mods/other-mod"
	assert_has "$out" "removed $T/other/mods/session-monitor"
	assert_eq "$(sort <<<"$dirs" | grep -vF "$T/foreign")" "$(expected_dirs)" "our entries"
}

case_equivalent_spellings_not_duplicated() {
	new_env
	ln -s "$repo" "$T/link"
	local first second
	first="$(mod_names | sed -n 1p)"
	second="$(mod_names | sed -n 2p)"
	echo "{\"env\":{\"CLAUDE_CODE_PLUGIN_DIRS\":\"$T/link/mods/$first/:$repo/mods/$second/\"}}" >"$settings"
	run_installer
	[ "$rc" -eq 0 ] || die "installer exited $rc: $out"
	assert_eq "$(settings_dirs | wc -l | tr -d ' ')" "$(mod_names | wc -l | tr -d ' ')" "entry count"
	assert_has "$(settings_dirs)" "$T/link/mods/$first/"
	assert_lacks "$(settings_dirs)" "$repo/mods/$first"
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

# ---- runner ----

passed=0
failed=0
run_case() {
	local label="$1" fn="$2" log="$root/log.$2"
	( set -e; "$fn" ) >"$log" 2>&1
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
run_case "stale entries for other clones of a mod are removed" case_stale_entries_removed
run_case "equivalent spellings of our paths are not duplicated" case_equivalent_spellings_not_duplicated
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
run_case "an empty mods folder is skipped" case_empty_mods_folder

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
