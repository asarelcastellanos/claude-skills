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

# The path with every symlink and junction on it resolved, and no trailing separator.
function Get-PhysicalPath([string]$path, [int]$depth = 0) {
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
}

# Absolute entries get ~ expanded and links resolved. Relative entries stay as written.
function Get-NormalizedPath([string]$entry) {
	$expanded = $entry
	if ($entry -eq "~" -or $entry -match '^~[\\/]') { $expanded = Join-Path $HOME $entry.Substring(1).TrimStart("\", "/") }
	if ([System.IO.Path]::IsPathRooted($expanded)) { return Get-PhysicalPath $expanded }
	return $expanded.Replace("/", "\").TrimEnd("\")
}

# The mod name when the entry is a folder named mods\<one of our mods>, else $null.
function Get-ModName([string]$entry, [string[]]$names) {
	$n = Get-NormalizedPath $entry
	$dir = [System.IO.Path]::GetDirectoryName($n)
	if (-not $dir) { return $null }
	$name = [System.IO.Path]::GetFileName($n)
	if (($names -contains $name) -and ([System.IO.Path]::GetFileName($dir) -eq "mods")) { return $name }
	return $null
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

function Read-JsonObject([string]$file) {
	$text = [System.IO.File]::ReadAllText($file, [System.Text.UTF8Encoding]::new($false)).TrimStart([char]0xFEFF)
	$data = ConvertFrom-Json -InputObject $text -ErrorAction Stop
	if ($data -isnot [pscustomobject]) { throw "$file does not hold a JSON object" }
	return $data
}

# Runs claude without letting stderr output end the script, since $ErrorActionPreference is Stop.
function Invoke-Claude([string[]]$CliArgs, [switch]$ShowErrors) {
	$previous = $ErrorActionPreference
	$ErrorActionPreference = "Continue"
	try {
		if ($ShowErrors) { $lines = & claude @CliArgs 2>&1 } else { $lines = & claude @CliArgs 2>$null }
		$code = $LASTEXITCODE
	} finally {
		$ErrorActionPreference = $previous
	}
	return [pscustomobject]@{ Code = $code; Text = (@($lines | ForEach-Object { "$_" }) -join "`n") }
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
		Write-Output "no mods found in $(Join-Path $physicalRepo "mods"), skipped the mods."
	} else {
		$marketplaces = "claude-workbench", "asarel-claude-skills"  # claude-workbench is the current name, the other is the name before the rename.
		$oldMarketplace = "asarel-claude-skills"
		$inline = "inline"  # the marketplace part of the id Claude Code gives a plugin loaded from CLAUDE_CODE_PLUGIN_DIRS
		$wanted = @($mods | ForEach-Object { $_.FullName })
		$names = @($mods | ForEach-Object { $_.Name })

		# Keep any folders already listed and add only the missing ones, so a second run changes nothing.
		# An unreadable settings.json stops the script before it writes or uninstalls anything.
		$settingsFile = Join-Path $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { $claude }) "settings.json"
		$configDir = Split-Path $settingsFile
		# A symlinked settings.json keeps its link: the write replaces the file it points to.
		$settingsPath = Get-PhysicalPath $settingsFile
		$text = ""
		if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
			try { $text = [System.IO.File]::ReadAllText($settingsPath, [System.Text.UTF8Encoding]::new($false)) }
			catch { throw "$settingsPath could not be read ($($_.Exception.Message)). Fix it and re-run this script." }
		}
		$text = $text.TrimStart([char]0xFEFF)
		$settings = [pscustomobject]@{}
		if ($text.Trim()) {
			try { $settings = ConvertFrom-Json -InputObject $text -ErrorAction Stop }
			catch { throw "$settingsPath is not valid JSON ($($_.Exception.Message)). Fix it and re-run this script." }
		}
		if ($settings -isnot [pscustomobject]) { throw "$settingsPath does not hold a JSON object. Fix it and re-run this script." }
		$settingsEnv = $settings.env
		if ($null -eq $settingsEnv) { $settingsEnv = [pscustomobject]@{} }
		if ($settingsEnv -isnot [pscustomobject]) { throw "$settingsPath has an `"env`" that is not an object. Fix it and re-run this script." }
		$current = $settingsEnv.CLAUDE_CODE_PLUGIN_DIRS
		if ($null -eq $current) { $current = "" }
		if ($current -isnot [string]) { throw "$settingsPath has an `"env.CLAUDE_CODE_PLUGIN_DIRS`" that is not a string. Fix it and re-run this script." }
		$configs = $settings.pluginConfigs
		if ($null -ne $configs -and $configs -isnot [pscustomobject]) { throw "$settingsPath has a `"pluginConfigs`" that is not an object. Fix it and re-run this script." }

		$listed = Invoke-Claude -CliArgs @("plugin", "list", "--json")
		if ($listed.Code -ne 0) { throw "claude plugin list --json failed (exit $($listed.Code)). Fix it and re-run this script." }
		$installed = @()
		if ($listed.Text.Trim()) {
			try { $installed = ConvertFrom-Json -InputObject $listed.Text -ErrorAction Stop }
			catch { throw "claude plugin list --json did not print JSON ($($_.Exception.Message)). Fix it and re-run this script." }
		}

		# Marketplace copies of our mods. Each entry names its own scope, and uninstall needs the same one.
		$doomed = @()
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
			}
		}
		$doomedIds = @($doomed | ForEach-Object { $_.Id })

		# The first entry for a plugin name wins, so a stale entry (another clone, an old clone, a deleted
		# folder) named mods\<our mod> would shadow this repo. Everything else in the list stays.
		$ours = @($wanted | ForEach-Object { Get-NormalizedPath $_ })
		$kept = @()
		$present = @()
		$messages = @()
		foreach ($entry in @($current -split ";" | Where-Object { $_ })) {
			$n = Get-NormalizedPath $entry
			if ($ours -contains $n) {
				$kept += $entry
				$present += $n
				continue
			}
			$modName = Get-ModName $entry $names
			if ($modName) {
				$messages += "removed $entry from CLAUDE_CODE_PLUGIN_DIRS, it shadows the $modName mod from this repo"
			} else {
				$kept += $entry
			}
		}
		$added = @($wanted | Where-Object { $present -notcontains (Get-NormalizedPath $_) })
		$value = (@($kept) + @($added)) -join ";"
		$changed = $value -ne $current
		foreach ($folder in $added) { $messages += "loading the $(Split-Path $folder -Leaf) mod from $folder" }

		# uninstall deletes pluginConfigs["<mod>@<marketplace>"]. A plugin loaded from CLAUDE_CODE_PLUGIN_DIRS
		# reads pluginConfigs["<mod>@inline"], so copy the entry there first. An existing entry there wins.
		if ($null -ne $configs) {
			foreach ($name in $names) {
				$target = "$name@$inline"
				if ($null -ne $configs.PSObject.Properties[$target]) { continue }
				foreach ($market in $marketplaces) {
					$source = "$name@$market"
					if (($doomedIds -contains $source) -and ($null -ne $configs.PSObject.Properties[$source])) {
						$sourceValue = $configs.$source
						Set-JsonProperty $configs $target $sourceValue
						$messages += "kept the $source plugin config as $target"
						$changed = $true
						break
					}
				}
			}
		}

		if ($changed) {
			if ($value -ne $current) {
				Set-JsonProperty $settingsEnv "CLAUDE_CODE_PLUGIN_DIRS" $value
				Set-JsonProperty $settings "env" $settingsEnv
			}
			try { Write-JsonFile $settingsPath $settings ".settings-" }
			catch { throw "$settingsPath could not be written ($($_.Exception.Message)). Fix it and re-run this script." }
		}
		foreach ($message in $messages) { Write-Output $message }

		# The plugin's $.store file is its saved data (the model-policy tally). Merge it into the inline
		# plugin's file and keep what is already there. This is best effort, the settings are already written.
		foreach ($name in $names) {
			$targetFile = Get-StoreFile $configDir "$name@$inline"
			foreach ($market in $marketplaces) {
				$sourceId = "$name@$market"
				if ($doomedIds -notcontains $sourceId) { continue }
				try {
					$sourceFile = Get-StoreFile $configDir $sourceId
					if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { continue }
					$source = Read-JsonObject $sourceFile
					$targetExists = Test-Path -LiteralPath $targetFile -PathType Leaf
					$existing = if ($targetExists) { Read-JsonObject $targetFile } else { [pscustomobject]@{} }
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
					Write-Warning "could not carry the $sourceId plugin data to $name@$inline ($($_.Exception.Message))"
				}
			}
		}

		# Settings are written, so the copies can go. One that will not uninstall (a project install seen
		# from another folder) is a warning, and the rest still go.
		foreach ($item in $doomed) {
			$result = Invoke-Claude -CliArgs @("plugin", "uninstall", $item.Id, "--scope", $item.Scope) -ShowErrors
			if ($result.Code -eq 0) {
				Write-Output "removed $($item.Id)"
			} else {
				$reason = @($result.Text -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1)
				if ($reason.Count -eq 0) { $reason = @("exit $($result.Code)") }
				$where = if ($item.Scope -eq "user") { "" } else { " in the project folder it was installed in" }
				Write-Warning "could not uninstall $($item.Id) ($($reason[0])). To remove it, run${where}: claude plugin uninstall $($item.Id) --scope $($item.Scope)"
			}
		}

		# Leaving the old marketplace registered makes "marketplace add" a no-op for the same folder,
		# so anyone who adds the repo again would see every mod under both names.
		$result = Invoke-Claude -CliArgs @("plugin", "marketplace", "list", "--json")
		if ($result.Code -ne 0) {
			Write-Warning "could not list the marketplaces, so the $oldMarketplace marketplace was not checked. Run: claude plugin marketplace remove $oldMarketplace"
		} else {
			$hasOld = $false
			try {
				foreach ($marketplace in (ConvertFrom-Json -InputObject $result.Text -ErrorAction Stop)) {
					if ($marketplace.name -eq $oldMarketplace) { $hasOld = $true }
				}
			} catch {
				Write-Warning "could not read the marketplace list, so the old marketplace was not checked"
			}
			if ($hasOld) {
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
	Write-Output "claude CLI not found, skipped the mods. Re-run this script after installing it."
}
