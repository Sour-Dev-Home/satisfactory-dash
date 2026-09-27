<#
.SYNOPSIS
  The nightly database backup, with retries: what the "SatisfactoryDashBackup" Scheduled Task runs.

.DESCRIPTION
  Runs `npm run backup -w backend` (ADR-0025 decision 7, docs-vault/wiki/runbooks/backups.md). If it
  exits non-zero, for example because the internet dropped during the S3 upload, it waits and tries again,
  up to -Attempts times in total, -RetryMinutes apart, and appends everything to a log file OUTSIDE the
  repository. If every attempt fails it exits 1, so Task Scheduler's history shows the failure. The
  missed-backup heartbeat is pinged by the backup itself, only after a really uploaded backup, so the
  monitor alerts when all attempts fail.

  Why a wrapper: Task Scheduler's "restart on failure" setting only covers a task that failed to LAUNCH,
  not one that ran and exited non-zero, so the retry has to live here.

  It changes nothing else: no service, no firewall rule, no .env edit. It puts the tool folders it needs
  in front of PATH for this run only (pg_dump, age and the AWS CLI are often not on the task's PATH).

.PARAMETER RepoDir
  The satisfactory-dash checkout to run from (its backend\.env is read). Default: the repository that
  contains this script.

.PARAMETER Attempts
  Total tries, including the first. Default: 4.

.PARAMETER RetryMinutes
  Minutes to wait between tries. Default: 30.

.PARAMETER Log
  The log file. Default: %LOCALAPPDATA%\satisfactory-dash\logs\backup.log (outside the repo).

.PARAMETER PostgresBin
  Folder holding pg_dump. Default: the newest bin folder under %ProgramFiles%\PostgreSQL, if any.

.PARAMETER AgeDir
  Folder holding age. Default: %USERPROFILE%\.local\bin.

.PARAMETER AwsDir
  Folder holding the AWS CLI. Default: %ProgramFiles%\Amazon\AWSCLIV2.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\backup-task.ps1 -Attempts 1
#>
param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [int]$Attempts = 4,
  [int]$RetryMinutes = 30,
  [string]$Log = (Join-Path $env:LOCALAPPDATA 'satisfactory-dash\logs\backup.log'),
  [string]$PostgresBin = '',
  [string]$AgeDir = '',
  [string]$AwsDir = ''
)
$ErrorActionPreference = 'Continue'

# The defaults and the PATH setup are shared with deploy-update.ps1 (tool-paths.ps1). A parameter default cannot
# call a function from a dot-sourced file, so an empty parameter means "the default" and is resolved here.
$toolPathsFile = Join-Path $PSScriptRoot 'tool-paths.ps1'
if (-not (Test-Path -LiteralPath $toolPathsFile)) {
  # Stop instead of running without the tool folders: exit 1 shows in Task Scheduler's history.
  Write-Error "tool-paths.ps1 is missing next to backup-task.ps1 ($PSScriptRoot); the backup was not run."
  exit 1
}
. $toolPathsFile
if (-not $PostgresBin) { $PostgresBin = Get-DefaultPostgresBin }
if (-not $AgeDir) { $AgeDir = Get-DefaultAgeDir }
if (-not $AwsDir) { $AwsDir = Get-DefaultAwsDir }

# Tool folders first, for this process only. Empty or missing folders are skipped.
Add-ToolDirsToPath @($PostgresBin, $AgeDir, $AwsDir)

New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
Set-Location $RepoDir

function Write-Log([string]$text) {
  Add-Content -Path $Log -Value "[backup-task $(Get-Date -Format o)] $text" -Encoding utf8
}

for ($i = 1; $i -le $Attempts; $i++) {
  Write-Log "attempt $i of $Attempts"
  & npm.cmd run backup -w backend 2>&1 | ForEach-Object {
    $t = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
    Add-Content -Path $Log -Value $t -Encoding utf8
  }
  $code = $LASTEXITCODE
  if ($code -eq 0) { Write-Log "succeeded on attempt $i"; exit 0 }
  Write-Log "attempt $i failed with exit code $code"
  if ($i -lt $Attempts) { Start-Sleep -Seconds ($RetryMinutes * 60) }
}
Write-Log "all $Attempts attempts failed"
exit 1
