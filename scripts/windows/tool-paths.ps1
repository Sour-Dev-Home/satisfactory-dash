<#
.SYNOPSIS
  Where the backup's command-line tools live, shared by backup-task.ps1 and deploy-update.ps1.

.DESCRIPTION
  Dot-source this file (`. (Join-Path $PSScriptRoot "tool-paths.ps1")`); it only defines functions and
  changes nothing when loaded. The backup (`npm run backup -w backend`) runs pg_dump, age and the AWS CLI by
  name, and a Scheduled Task or a plain shell often does not have their folders on PATH. Both scripts
  put those folders in front of PATH for their own process only.

  The defaults follow the standard install locations; each can be overridden by the calling script's
  -PostgresBin, -AgeDir and -AwsDir parameters.
#>

# The newest PostgreSQL bin folder under %ProgramFiles%\PostgreSQL, or "" when there is none.
function Get-DefaultPostgresBin {
  $newest = Get-ChildItem (Join-Path $env:ProgramFiles 'PostgreSQL') -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Name -replace '\D', '') } -Descending | Select-Object -First 1
  if ($newest) { return (Join-Path $newest.FullName 'bin') }
  return ''
}

function Get-DefaultAgeDir {
  return (Join-Path $env:USERPROFILE '.local\bin')
}

function Get-DefaultAwsDir {
  return (Join-Path $env:ProgramFiles 'Amazon\AWSCLIV2')
}

# The given folders that are set and exist, in the given order (empty or missing ones are skipped).
function Get-ExistingToolDirs([string[]]$Dirs) {
  return @($Dirs | Where-Object { $_ -and (Test-Path $_) })
}

# Puts the folders in front of PATH for THIS process only (a script's own run, never the machine or user PATH).
function Add-ToolDirsToPath([string[]]$Dirs) {
  $existing = Get-ExistingToolDirs $Dirs
  if ($existing) { $env:Path = ($existing -join ';') + ';' + $env:Path }
}
