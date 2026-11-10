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

# The mods need the claude CLI. Skip them with a note when the CLI is missing.
# The marketplace is this repo's folder, so edits to a mod apply after /reload-plugins.
# Each folder under mods/ is named after its plugin, so the folder name is the install name.
if (Get-Command claude -ErrorAction SilentlyContinue) {
	claude plugin marketplace add $repo --scope user | Out-Null
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
	foreach ($mod in Get-ChildItem (Join-Path $repo "mods") -Directory) {
		claude plugin install "$($mod.Name)@claude-workbench" --scope user | Out-Null
		if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
		Write-Output "installed the $($mod.Name) mod"
	}
} else {
	Write-Output "claude CLI not found, skipped the mods. Re-run this script after installing it."
}

if (Test-Path $backup) { Write-Output "replaced skills were moved to $backup" }
