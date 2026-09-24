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

$BackendDir = (Resolve-Path -LiteralPath $BackendDir).Path
# Node writes UTF-8; decode it as UTF-8 (the default is the OEM code page, which garbles it).
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
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
  # A launch failure (bad -Node path) leaves $LASTEXITCODE stale or null, and `exit $null` is
  # exit 0, so start from null and treat "never set" as a failure below.
  $global:LASTEXITCODE = $null
  try {
    & $Node $Bundle 2>&1 | ForEach-Object {
      # Windows PowerShell 5.1 renders an empty stderr line as "...RemoteException".
      $text = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
      if ($text -eq "System.Management.Automation.RemoteException") { $text = "" }
      Write-Host $text
      Add-Content -Path $Log -Value $text -Encoding utf8
    }
  } catch {
    Write-Log "could not launch ${Node}: $($_.Exception.Message)"
  }
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 1 }
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
