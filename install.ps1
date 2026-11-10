# Links each skill in this repo into ~/.claude/skills and imports this repo's CLAUDE.md.
# Junctions instead of symlinks: they need no admin rights or Developer Mode on Windows.

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
$claude = Join-Path $HOME ".claude"
$skillsDir = Join-Path $claude "skills"
$backup = Join-Path $claude ("skills-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss-fff"))

# The path with every symlink and junction on it resolved, and no trailing separator.
# It never throws: a path it cannot resolve (missing drive, unreadable folder) comes back as written.
function Get-PhysicalPath([string]$path, [int]$depth = 0) {
	try {
		$full = [System.IO.Path]::GetFullPath($path)
		$root = [System.IO.Path]::GetPathRoot($full)
		if ($full.Length -gt $root.Length) { $full = $full.TrimEnd("\", "/") }
		$parent = [System.IO.Path]::GetDirectoryName($full)
		if (-not $parent -or $depth -gt 32) { return $full }
		$resolved = Join-Path (Get-PhysicalPath $parent ($depth + 1)) ([System.IO.Path]::GetFileName($full))
		$item = Get-Item -LiteralPath $resolved -Force -ErrorAction SilentlyContinue
		if ($item -and ($item.LinkType -eq "SymbolicLink" -or $item.LinkType -eq "Junction") -and $item.Target) {
			$target = @($item.Target)[0]
			if (-not [System.IO.Path]::IsPathRooted($target)) { $target = Join-Path (Split-Path $resolved) $target }
			return Get-PhysicalPath $target ($depth + 1)
		}
		return $resolved
	} catch {
		return $path
	}
}

# A linked worktree is deleted with "git worktree remove". The skill links and mod paths would then
# point every session at a folder that is gone, so run this from the main checkout.
# Skipped when git is missing or this folder is not a git checkout.
if (Get-Command git -ErrorAction SilentlyContinue) {
	$previousPreference = $ErrorActionPreference
	$ErrorActionPreference = "Continue"
	try {
		$gitDir = @(git -C $repo rev-parse --git-dir 2>$null)
		$gitCode = $LASTEXITCODE
		$commonDir = @(git -C $repo rev-parse --git-common-dir 2>$null)
		if ($LASTEXITCODE -ne 0 -or $commonDir.Count -eq 0) { $commonDir = $gitDir }
	} finally {
		$ErrorActionPreference = $previousPreference
	}
	if ($gitCode -eq 0 -and $gitDir.Count -gt 0) {
		# git prints these relative to the repo folder, or absolute for a linked worktree.
		$gitPaths = @("$($gitDir[0])", "$($commonDir[0])") | ForEach-Object {
			Get-PhysicalPath $(if ([System.IO.Path]::IsPathRooted($_)) { $_ } else { Join-Path $repo $_ })
		}
		$gitDirPath, $commonDirPath = $gitPaths
		if ($gitDirPath -ne $commonDirPath) {
			throw "$repo is a linked git worktree. Removing it would leave every session pointing at a deleted folder. Run install.ps1 from the main checkout instead."
		}
	}
}

New-Item -ItemType Directory -Force $skillsDir | Out-Null

foreach ($skill in Get-ChildItem (Join-Path $repo "skills") -Directory) {
	$target = Join-Path $skillsDir $skill.Name
	if (Test-Path $target) {
		$item = Get-Item $target -Force
		if ($item.LinkType -eq "Junction" -and $item.Target -contains $skill.FullName) { continue }
		# Keep a copy of anything we replace, in case it had local edits.
		New-Item -ItemType Directory -Force $backup | Out-Null
		Move-Item $target (Join-Path $backup $skill.Name)
		Write-Output "moved the existing $($skill.Name) to $(Join-Path $backup $skill.Name)"
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
# The order is: read and check settings.json and the plugin list, write settings.json, and only then
# uninstall the copies. A failure before the write leaves the installed copies in place, so the mods stay loaded.

# Absolute entries get ~ expanded and links resolved. Relative entries stay as written.
function Get-NormalizedPath([string]$entry) {
	$expanded = $entry
	if ($entry -eq "~" -or $entry -match '^~[\\/]') { $expanded = Join-Path $HOME $entry.Substring(1).TrimStart("\", "/") }
	if ([System.IO.Path]::IsPathRooted($expanded)) { return Get-PhysicalPath $expanded }
	return $expanded.Replace("/", "\").TrimEnd("\")
}

# Windows PowerShell 5.1 and PowerShell before 7.5 turn ISO 8601 date strings in the JSON into dates,
# so such a string in settings.json may be written back in another format. 7.5 and later keep them as strings.
function ConvertFrom-JsonText([string]$text) {
	if ($PSVersionTable.PSVersion -ge [version]"7.5") {
		return ConvertFrom-Json -InputObject $text -ErrorAction Stop -DateKind String
	}
	return ConvertFrom-Json -InputObject $text -ErrorAction Stop
}

function Read-FileBytes([string]$file) {
	if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return , [byte[]]@() }
	return , [System.IO.File]::ReadAllBytes($file)
}

function Test-SameBytes([byte[]]$a, [byte[]]$b) {
	return [Convert]::ToBase64String($a) -eq [Convert]::ToBase64String($b)
}

# Strict UTF-8, so invalid bytes stop the script like they stop the bash version. A BOM is accepted.
function ConvertFrom-Utf8Bytes([byte[]]$bytes, [string]$what) {
	try { $text = [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes) }
	catch { throw "$what is not valid UTF-8 ($($_.Exception.Message)). Fix it and re-run this script." }
	return $text.TrimStart([char]0xFEFF)
}

# Parses a JSON file that must hold an object. ConvertFrom-Json unrolls a one-element array, so
# the first character of the text decides what the root is.
function Read-JsonObject([byte[]]$bytes, [string]$what) {
	$text = (ConvertFrom-Utf8Bytes $bytes $what).Trim()
	if (-not $text) { return [pscustomobject]@{} }
	try { $data = ConvertFrom-JsonText $text }
	catch { throw "$what is not valid JSON ($($_.Exception.Message)). Fix it and re-run this script." }
	if (-not $text.StartsWith("{") -or $data -isnot [pscustomobject]) { throw "$what does not hold a JSON object. Fix it and re-run this script." }
	return $data
}

function Set-JsonProperty($object, [string]$name, $value) {
	if ($null -eq $object.PSObject.Properties[$name]) {
		$object | Add-Member -NotePropertyName $name -NotePropertyValue $value
	} else {
		$object.$name = $value
	}
}

# Writes through a unique temp file in the same folder, so a failure leaves the old file whole.
function Write-JsonFile([string]$path, $data, [string]$prefix) {
	$directory = Split-Path $path
	New-Item -ItemType Directory -Force $directory | Out-Null
	$tmp = Join-Path $directory ($prefix + [guid]::NewGuid().ToString("N") + ".tmp")
	try {
		[System.IO.File]::WriteAllText($tmp, ((ConvertTo-Json -InputObject $data -Depth 100) + "`n"), [System.Text.UTF8Encoding]::new($false))
		Move-Item -LiteralPath $tmp -Destination $path -Force
	} catch {
		Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
		throw
	}
}

# Claude Code names a plugin's $.store file <name>_<marketplace>-<first 12 hex of sha256(id)>.json.
function Get-StoreFile([string]$configDir, [string]$id) {
	$name, $market = $id -split "@", 2
	$sha = [System.Security.Cryptography.SHA256]::Create()
	try { $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($id)) } finally { $sha.Dispose() }
	$digest = ([System.BitConverter]::ToString($bytes) -replace "-", "").ToLower().Substring(0, 12)
	return Join-Path $configDir "plugins\store\$($name)_$market-$digest.json"
}

# Runs claude without letting stderr output end the script, since $ErrorActionPreference is Stop.
# The empty array on the pipeline closes stdin at once, so claude never waits for input.
function Invoke-Claude([string[]]$CliArgs, [switch]$ShowErrors) {
	$previous = $ErrorActionPreference
	$ErrorActionPreference = "Continue"
	try {
		if ($ShowErrors) { $lines = @() | & claude @CliArgs 2>&1 } else { $lines = @() | & claude @CliArgs 2>$null }
		$code = $LASTEXITCODE
	} finally {
		$ErrorActionPreference = $previous
	}
	return [pscustomobject]@{ Code = $code; Text = (@($lines | ForEach-Object { "$_" }) -join "`n") }
}

# Why an entry that is not ours should go, or $null to keep it.
function Get-StaleReason([string]$entry) {
	$n = Get-NormalizedPath $entry
	if (-not [System.IO.Path]::IsPathRooted($n)) { return $null }
	$modsDir = [System.IO.Path]::GetDirectoryName($n)
	if (-not $modsDir -or [System.IO.Path]::GetFileName($modsDir) -ne "mods") { return $null }
	if (($names -contains [System.IO.Path]::GetFileName($n)) -and (-not (Test-Path -LiteralPath $n))) { return "its folder is missing" }
	$cloneRoot = [System.IO.Path]::GetDirectoryName($modsDir)
	if ($cloneRoot) {
		$manifest = Join-Path $cloneRoot ".claude-plugin\marketplace.json"
		if (Test-Path -LiteralPath $manifest -PathType Leaf) {
			try {
				$marketplace = ConvertFrom-JsonText ([System.IO.File]::ReadAllText($manifest))
				if ($marketplaces -contains $marketplace.name) { return "it is inside another clone of this repo" }
			} catch {
				return $null
			}
		}
	}
	return $null
}

# Parses and checks the bytes of settings.json. $settingsPath, and everything below, come from the script scope.
function Read-Settings([byte[]]$bytes) {
	$settings = Read-JsonObject $bytes $settingsPath
	$settingsEnv = $settings.env
	if ($null -ne $settingsEnv -and $settingsEnv -isnot [pscustomobject]) { throw "$settingsPath has an `"env`" that is not an object. Fix it and re-run this script." }
	if ($null -ne $settingsEnv) {
		$current = $settingsEnv.CLAUDE_CODE_PLUGIN_DIRS
		if ($null -ne $current -and $current -isnot [string]) { throw "$settingsPath has an `"env.CLAUDE_CODE_PLUGIN_DIRS`" that is not a string. Fix it and re-run this script." }
	}
	foreach ($key in "pluginConfigs", "enabledPlugins") {
		$section = $settings.$key
		if ($null -ne $section -and $section -isnot [pscustomobject]) { throw "$settingsPath has a `"$key`" that is not an object. Fix it and re-run this script." }
	}
	return $settings
}

# Applies every settings.json change to the parsed bytes.
function Get-SettingsPlan([byte[]]$bytes) {
	$settings = Read-Settings $bytes
	$settingsEnv = $settings.env
	if ($null -eq $settingsEnv) { $settingsEnv = [pscustomobject]@{} }
	$current = $settingsEnv.CLAUDE_CODE_PLUGIN_DIRS
	if ($null -eq $current) { $current = "" }
	$messages = @()
	$changed = $false

	# The first entry for a plugin name wins, so our paths go first and every other entry keeps its
	# order after them. Only an entry that cannot work is dropped: a missing mods\<our mod> folder,
	# or a folder inside another clone of this repo. Duplicates of our own paths collapse into one.
	$ours = @($wanted | ForEach-Object { Get-NormalizedPath $_ })
	$others = @()
	$present = @()
	foreach ($entry in @($current -split ";" | Where-Object { $_ })) {
		$n = Get-NormalizedPath $entry
		if ($ours -contains $n) {
			$present += $n
			continue
		}
		$reason = Get-StaleReason $entry
		if ($reason) {
			$messages += "removed $entry from CLAUDE_CODE_PLUGIN_DIRS, $reason"
		} else {
			$others += $entry
		}
	}
	foreach ($folder in $wanted) {
		if ($present -notcontains (Get-NormalizedPath $folder)) { $messages += "loading the $(Split-Path $folder -Leaf) mod from $folder" }
	}
	$value = (@($wanted) + @($others)) -join ";"
	if ($value -ne $current) {
		Set-JsonProperty $settingsEnv "CLAUDE_CODE_PLUGIN_DIRS" $value
		Set-JsonProperty $settings "env" $settingsEnv
		$changed = $true
	}

	# uninstall deletes pluginConfigs["<mod>@<marketplace>"]. A plugin loaded from CLAUDE_CODE_PLUGIN_DIRS
	# reads pluginConfigs["<mod>@inline"], so copy the entry there first. An existing entry there wins.
	$configs = $settings.pluginConfigs
	foreach ($name in $names) {
		$target = "$name@$inline"
		if ($null -ne $configs -and $null -eq $configs.PSObject.Properties[$target]) {
			foreach ($market in $marketplaces) {
				$source = "$name@$market"
				if ($copies.ContainsKey($source) -and $null -ne $configs.PSObject.Properties[$source]) {
					$sourceValue = $configs.$source
					Set-JsonProperty $configs $target $sourceValue
					$messages += "kept the $source plugin config as $target"
					$changed = $true
					break
				}
			}
		}
		# A copy that is switched off stays off once it loads from the repo.
		foreach ($market in $marketplaces) {
			$source = "$name@$market"
			if ($copies.ContainsKey($source)) {
				$copy = $copies[$source]
				if (($copy.enabled -is [bool]) -and (-not $copy.enabled)) {
					$enabled = $settings.enabledPlugins
					if ($null -eq $enabled -or $null -eq $enabled.PSObject.Properties[$target]) {
						if ($null -eq $enabled) {
							$enabled = [pscustomobject]@{}
							Set-JsonProperty $settings "enabledPlugins" $enabled
						}
						Set-JsonProperty $enabled $target $false
						$messages += "kept $source disabled as $target"
						$changed = $true
					}
				}
				break
			}
		}
	}
	return [pscustomobject]@{ Settings = $settings; Changed = $changed; Messages = $messages }
}

if (Get-Command claude -ErrorAction SilentlyContinue) {
	# The physical path (links resolved) is what Claude Code opens, and what the entries are compared against.
	$physicalRepo = Get-PhysicalPath $repo
	$mods = @(Get-ChildItem (Join-Path $physicalRepo "mods") -Directory -ErrorAction SilentlyContinue)
	foreach ($mod in $mods) {
		# The path list uses ; as its separator, so a path with one cannot be listed.
		if ($mod.FullName.Contains(";")) {
			throw "$($mod.FullName) contains a semicolon, which separates the paths in CLAUDE_CODE_PLUGIN_DIRS. Move the repo to a path without one and re-run this script."
		}
	}
	if ($mods.Count -eq 0) {
		[Console]::Error.WriteLine("no mods found in $(Join-Path $physicalRepo "mods"), skipped the mods.")
	} else {
		$marketplaces = "claude-workbench", "asarel-claude-skills"  # claude-workbench is the current name, the other is the name before the rename.
		$oldMarketplace = "asarel-claude-skills"
		$inline = "inline"  # the marketplace part of the id Claude Code gives a plugin loaded from CLAUDE_CODE_PLUGIN_DIRS
		$wanted = @($mods | ForEach-Object { $_.FullName })
		$names = @($mods | ForEach-Object { $_.Name })

		# A relative CLAUDE_CONFIG_DIR is resolved once, against the current folder, and only the absolute path is used after that.
		$configDir = if ($env:CLAUDE_CONFIG_DIR) { $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($env:CLAUDE_CONFIG_DIR) } else { $claude }
		# A symlinked settings.json keeps its link: the write replaces the file it points to.
		$settingsPath = Get-PhysicalPath (Join-Path $configDir "settings.json")

		# Read settings.json first, and check it before anything else runs.
		$raw = Read-FileBytes $settingsPath
		Read-Settings $raw | Out-Null

		$listed = Invoke-Claude -CliArgs @("plugin", "list", "--json")
		if ($listed.Code -ne 0) { throw "claude plugin list --json failed (exit $($listed.Code)). Fix it and re-run this script." }
		$listText = $listed.Text.Trim()
		if (-not $listText.StartsWith("[")) { throw "claude plugin list --json did not print a JSON list. Fix it and re-run this script." }
		try { $installed = ConvertFrom-JsonText $listText }
		catch { throw "claude plugin list --json did not print JSON ($($_.Exception.Message)). Fix it and re-run this script." }

		# Marketplace copies of our mods. Each entry names its own scope, and uninstall needs the same one.
		$doomed = @()
		$copies = @{}
		foreach ($entry in $installed) {
			if ($entry.id -isnot [string]) { continue }
			$isOurs = $false
			foreach ($name in $names) {
				foreach ($market in $marketplaces) {
					if ($entry.id -eq "$name@$market") { $isOurs = $true }
				}
			}
			if ($isOurs) {
				$scope = if (($entry.scope -is [string]) -and $entry.scope) { $entry.scope } else { "user" }
				$doomed += [pscustomobject]@{ Id = $entry.id; Scope = $scope }
				$copies[$entry.id] = $entry
			}
		}
		$doomedIds = @($doomed | ForEach-Object { $_.Id })

		# The plugin list above can take a while, so another program may have edited settings.json since the
		# first read. Right before the write, read it again. If it changed, plan again from the new content,
		# once. A second change stops the script with nothing written.
		$done = $false
		for ($attempt = 0; $attempt -lt 2; $attempt++) {
			$plan = Get-SettingsPlan $raw
			if (-not $plan.Changed) { $done = $true; break }
			$fresh = Read-FileBytes $settingsPath
			if (Test-SameBytes $fresh $raw) {
				try { Write-JsonFile $settingsPath $plan.Settings ".settings-" }
				catch { throw "$settingsPath could not be written ($($_.Exception.Message)). Fix it and re-run this script." }
				$done = $true
				break
			}
			$raw = $fresh
		}
		if (-not $done) { throw "$settingsPath changed while this script was running. Fix it and re-run this script." }
		foreach ($message in $plan.Messages) { Write-Output $message }

		# The plugin's $.store file is its saved data (the model-policy tally). Merge it into the inline
		# plugin's file and keep what is already there. If that fails, the mod's marketplace copy stays
		# installed, so a re-run tries again.
		$skipped = @()
		foreach ($name in $names) {
			$targetFile = Get-StoreFile $configDir "$name@$inline"
			foreach ($market in $marketplaces) {
				$sourceId = "$name@$market"
				if ($doomedIds -notcontains $sourceId) { continue }
				$sourceFile = Get-StoreFile $configDir $sourceId
				try {
					if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { continue }
					$source = Read-JsonObject (Read-FileBytes $sourceFile) $sourceFile
					$targetExists = Test-Path -LiteralPath $targetFile -PathType Leaf
					$existing = if ($targetExists) { Read-JsonObject (Read-FileBytes $targetFile) $targetFile } else { [pscustomobject]@{} }
					$carried = 0
					foreach ($property in $source.PSObject.Properties) {
						if ($null -eq $existing.PSObject.Properties[$property.Name]) {
							$existing | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value
							$carried++
						}
					}
					if ($carried -gt 0 -or -not $targetExists) {
						Write-JsonFile $targetFile $existing ".store-"
						Write-Output "kept the $sourceId plugin data as $name@$inline"
					}
				} catch {
					$skipped += $sourceId
					Write-Warning "could not carry the $sourceId plugin data from $sourceFile to $targetFile ($($_.Exception.Message)). The $sourceId copy stays installed, so re-run this script to try again."
				}
			}
		}

		# Settings are written, so the copies can go. One that will not uninstall (a project install seen
		# from another folder) is a warning, and the rest still go.
		$keptMarkets = @()
		foreach ($item in $doomed) {
			$market = ($item.Id -split "@", 2)[1]
			if ($skipped -contains $item.Id) {
				$keptMarkets += $market
				continue
			}
			$result = Invoke-Claude -CliArgs @("plugin", "uninstall", $item.Id, "--scope", $item.Scope) -ShowErrors
			if ($result.Code -eq 0) {
				Write-Output "removed $($item.Id)"
			} else {
				$keptMarkets += $market
				$reason = @($result.Text -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1)
				if ($reason.Count -eq 0) { $reason = @("exit $($result.Code)") }
				$where = if ($item.Scope -eq "user") { "" } else { " in the project folder it was installed in" }
				Write-Warning "could not uninstall $($item.Id) ($($reason[0])). To remove it, run${where}: claude plugin uninstall $($item.Id) --scope $($item.Scope)"
			}
		}

		# Leaving the old marketplace registered makes "marketplace add" a no-op for the same folder,
		# so anyone who adds the repo again would see every mod under both names. It stays while a plugin
		# from it is still installed.
		$result = Invoke-Claude -CliArgs @("plugin", "marketplace", "list", "--json")
		if ($result.Code -ne 0) {
			Write-Warning "could not list the marketplaces, so the $oldMarketplace marketplace was not checked. Run: claude plugin marketplace remove $oldMarketplace"
		} else {
			$hasOld = $false
			try {
				foreach ($marketplace in (ConvertFrom-JsonText $result.Text)) {
					if ($marketplace.name -eq $oldMarketplace) { $hasOld = $true }
				}
			} catch {
				Write-Warning "could not read the marketplace list, so the old marketplace was not checked"
			}
			if ($hasOld -and ($keptMarkets -contains $oldMarketplace)) {
				Write-Warning "kept the $oldMarketplace marketplace registered, because a plugin from it is still installed. Once it is uninstalled, run: claude plugin marketplace remove $oldMarketplace"
			} elseif ($hasOld) {
				$result = Invoke-Claude -CliArgs @("plugin", "marketplace", "remove", $oldMarketplace) -ShowErrors
				if ($result.Code -eq 0) {
					Write-Output "removed the $oldMarketplace marketplace"
				} else {
					Write-Warning "could not remove the $oldMarketplace marketplace. Run: claude plugin marketplace remove $oldMarketplace"
				}
			}
		}
	}
} else {
	[Console]::Error.WriteLine("claude CLI not found, skipped the mods. Re-run this script after installing it.")
}
