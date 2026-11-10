# Links each skill in this repo into ~/.claude/skills and imports this repo's CLAUDE.md.
# Junctions instead of symlinks: they need no admin rights or Developer Mode on Windows.

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
$claude = Join-Path $HOME ".claude"
$skillsDir = Join-Path $claude "skills"
$backup = Join-Path $claude ("skills-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss-fff"))

New-Item -ItemType Directory -Force $skillsDir | Out-Null

foreach ($skill in Get-ChildItem (Join-Path $repo "skills") -Directory) {
	$target = Join-Path $skillsDir $skill.Name
	if (Test-Path $target) {
		$item = Get-Item $target -Force
		if ($item.LinkType -eq "Junction" -and $item.Target -contains $skill.FullName) { continue }
		# Keep a copy of anything we replace, in case it had local edits.
		New-Item -ItemType Directory -Force $backup | Out-Null
		Move-Item $target (Join-Path $backup $skill.Name)
	}
	New-Item -ItemType Junction -Path $target -Target $skill.FullName | Out-Null
	Write-Output "linked $($skill.Name)"
}

$globalMd = Join-Path $claude "CLAUDE.md"
$importLine = "@" + (Join-Path $repo "CLAUDE.md").Replace("\", "/")
$existing = if (Test-Path $globalMd) { Get-Content $globalMd -Raw } else { "" }
if ($existing -notmatch [regex]::Escape($importLine)) {
	Add-Content -Path $globalMd -Value "`n$importLine" -Encoding utf8
	Write-Output "added import to $globalMd"
}

# The mods need the claude CLI to remove old installs. Skip them with a note when the CLI is missing.
# Claude Code loads the mods straight from this repo's mods\ folders: their absolute paths go in
# CLAUDE_CODE_PLUGIN_DIRS in settings.json, which Claude Code reads like --plugin-dir and watches.
# An edit to a mod file reloads in a running session, and /reload-plugins applies it on demand.
# An installed marketplace copy would load the same mod twice and run from a cached folder, so this
# script removes any copy installed from this repo's marketplace under either of its names.
# Each folder under mods\ is named after its plugin, so the folder name is the plugin name.
if (Get-Command claude -ErrorAction SilentlyContinue) {
	$installed = (claude plugin list --json) -join "`n"
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
	$installedIds = ($installed | ConvertFrom-Json).id
	$mods = Get-ChildItem (Join-Path $repo "mods") -Directory
	foreach ($mod in $mods) {
		# claude-workbench is the current marketplace name. asarel-claude-skills is the name before the rename.
		foreach ($marketplace in "claude-workbench", "asarel-claude-skills") {
			if ($installedIds -contains "$($mod.Name)@$marketplace") {
				claude plugin uninstall "$($mod.Name)@$marketplace" --scope user | Out-Null
				if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
				Write-Output "removed $($mod.Name)@$marketplace"
			}
		}
	}
	# Leaving the old marketplace registered makes "marketplace add" a no-op for the same folder,
	# so anyone who adds the repo again would see every mod under both names.
	$oldMarketplace = "asarel-claude-skills"
	$marketplaces = (claude plugin marketplace list --json) -join "`n"
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
	if (($marketplaces | ConvertFrom-Json).name -contains $oldMarketplace) {
		claude plugin marketplace remove $oldMarketplace | Out-Null
		if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
		Write-Output "removed the $oldMarketplace marketplace"
	}

	# Keep any folders already listed and add only the missing ones, so a second run changes nothing.
	# An unreadable settings.json stops the script before it writes anything.
	$settingsFile = Join-Path $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { $claude }) "settings.json"
	$settings = [pscustomobject]@{}
	if (Test-Path $settingsFile) {
		$text = Get-Content $settingsFile -Raw
		if ($text -and $text.Trim()) {
			try { $settings = $text | ConvertFrom-Json -ErrorAction Stop }
			catch { throw "$settingsFile is not valid JSON ($($_.Exception.Message)). Fix it and re-run this script." }
		}
	}
	if ($settings -isnot [pscustomobject]) { throw "$settingsFile does not hold a JSON object. Fix it and re-run this script." }
	$settingsEnv = $settings.env
	if ($null -eq $settingsEnv) {
		$settingsEnv = [pscustomobject]@{}
		$settings | Add-Member -NotePropertyName env -NotePropertyValue $settingsEnv
	}
	if ($settingsEnv -isnot [pscustomobject]) { throw "$settingsFile has an `"env`" that is not an object. Fix it and re-run this script." }
	$current = $settingsEnv.CLAUDE_CODE_PLUGIN_DIRS
	if ($null -eq $current) { $current = "" }
	if ($current -isnot [string]) { throw "$settingsFile has an `"env.CLAUDE_CODE_PLUGIN_DIRS`" that is not a string. Fix it and re-run this script." }
	$folders = @($current -split ";" | Where-Object { $_ })
	$listed = @($folders | ForEach-Object { $_.TrimEnd("\", "/") })
	$added = @($mods | Where-Object { $listed -notcontains $_.FullName.TrimEnd("\", "/") })
	if ($added.Count -gt 0) {
		$value = (@($folders) + @($added | ForEach-Object { $_.FullName })) -join ";"
		if ($null -eq $settingsEnv.PSObject.Properties["CLAUDE_CODE_PLUGIN_DIRS"]) {
			$settingsEnv | Add-Member -NotePropertyName CLAUDE_CODE_PLUGIN_DIRS -NotePropertyValue $value
		} else {
			$settingsEnv.CLAUDE_CODE_PLUGIN_DIRS = $value
		}
		New-Item -ItemType Directory -Force (Split-Path $settingsFile) | Out-Null
		$tmp = "$settingsFile.tmp"
		[System.IO.File]::WriteAllText($tmp, (($settings | ConvertTo-Json -Depth 100) + "`n"), (New-Object System.Text.UTF8Encoding $false))
		Move-Item $tmp $settingsFile -Force
		foreach ($mod in $added) { Write-Output "loading the $($mod.Name) mod from $($mod.FullName)" }
	}
} else {
	Write-Output "claude CLI not found, skipped the mods. Re-run this script after installing it."
}

if (Test-Path $backup) { Write-Output "replaced skills were moved to $backup" }
