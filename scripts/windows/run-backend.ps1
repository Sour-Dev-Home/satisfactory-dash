<#
.SYNOPSIS
  Runs the satisfactory-dash backend and restarts it if it exits with a failure.

.DESCRIPTION
  Started by the Scheduled Task that register-backend-task.ps1 creates. Task Scheduler's own
  restart-on-failure did not restart a killed `cmd.exe /c node ...` action (tested), so the
  restart loop lives here instead.

  Runs `node dist\server.cjs` from the backend folder (so dotenv finds backend\.env) with
  NODE_ENV=production, and appends its output to the log file. A clean exit (code 0) ends the
  loop. A non-zero exit is retried up to -MaxRestarts times, -DelaySeconds apart, so a
  configuration error doesn't loop forever. A run that stayed up for at least
  -HealthyAfterSeconds resets the retry count, since that was not a startup failure.

.PARAMETER BackendDir
  The backend folder to run from. Default: ..\..\backend relative to this script.

.PARAMETER Log
  The log file to append to. Its folder is created if missing.

.PARAMETER Node
  Path to node.exe. Default: the first `node` on PATH.

.PARAMETER Bundle
  The bundle to run, relative to -BackendDir. Default: dist\server.cjs.
#>
[CmdletBinding()]
param(
  [string]$BackendDir = (Join-Path $PSScriptRoot "..\..\backend"),
  [Parameter(Mandatory = $true)][string]$Log,
  [string]$Node = "",
  [string]$Bundle = "dist\server.cjs",
  [int]$MaxRestarts = 3,
  [int]$DelaySeconds = 60,
  [int]$HealthyAfterSeconds = 300
)

$ErrorActionPreference = "Stop"

$BackendDir = (Resolve-Path $BackendDir).Path
if (-not $Node) { $Node = (Get-Command node -ErrorAction Stop).Source }
$Log = [System.IO.Path]::GetFullPath($Log)
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null

# Set explicitly so a machine-wide NODE_ENV=development can't turn on error `detail` in
# responses.
$env:NODE_ENV = "production"
Set-Location $BackendDir

function Write-Log([string]$message) {
  $line = "[run-backend $(Get-Date -Format o)] $message"
  Write-Host $line
  Add-Content -Path $Log -Value $line -Encoding utf8
}

$restarts = 0
while ($true) {
  Write-Log "starting $Bundle (restarts used: $restarts of $MaxRestarts)"
  $started = Get-Date
  # Native stderr becomes error records under 2>&1; they must not stop the script.
  $ErrorActionPreference = "Continue"
  & $Node $Bundle 2>&1 | ForEach-Object {
    $text = "$_"
    Write-Host $text
    Add-Content -Path $Log -Value $text -Encoding utf8
  }
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  $uptime = [int]((Get-Date) - $started).TotalSeconds

  if ($code -eq 0) {
    Write-Log "exited cleanly (code 0) after ${uptime}s; not restarting"
    break
  }
  if ($uptime -ge $HealthyAfterSeconds) { $restarts = 0 }
  if ($restarts -ge $MaxRestarts) {
    Write-Log "exited with code $code after ${uptime}s; $MaxRestarts restarts used, giving up"
    exit $code
  }
  $restarts++
  Write-Log "exited with code $code after ${uptime}s; restart $restarts of $MaxRestarts in ${DelaySeconds}s"
  Start-Sleep -Seconds $DelaySeconds
}
