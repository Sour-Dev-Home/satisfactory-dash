<#
.SYNOPSIS
  Registers a Scheduled Task that starts the satisfactory-dash backend at logon.

.DESCRIPTION
  Runs `node dist\server.cjs` from the backend folder (so dotenv finds backend\.env),
  restarts it if it exits with a failure, and appends its output to a log file OUTSIDE
  the repository. Build first: `npm run build -w backend`.

  It only registers the task for the current user. It changes nothing else: no service,
  no firewall rule, no .env edit. Run with -WhatIf to see what it would do without doing it.
  Undo with unregister-backend-task.ps1.

.PARAMETER TaskName
  The Scheduled Task's name. Default: SatisfactoryDashBackend.

.PARAMETER LogDir
  Where the log file goes. Default: %LOCALAPPDATA%\satisfactory-dash\logs (outside the repo).

.PARAMETER Start
  Also start the task right now (otherwise it starts at the next logon).

.EXAMPLE
  .\scripts\windows\register-backend-task.ps1 -WhatIf
  .\scripts\windows\register-backend-task.ps1 -Start
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$TaskName = "SatisfactoryDashBackend",
  [string]$LogDir = (Join-Path $env:LOCALAPPDATA "satisfactory-dash\logs"),
  [switch]$Start
)

$ErrorActionPreference = "Stop"

# The repo is found from this script's own location, so nothing here is machine-specific.
$backendDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\backend")).Path
$bundle = Join-Path $backendDir "dist\server.cjs"
if (-not (Test-Path $bundle)) {
  throw "Missing $bundle. Build first: npm run build -w backend"
}
if (-not (Test-Path (Join-Path $backendDir ".env"))) {
  throw "Missing backend\.env. Create it first (see the go-live runbook, step 1)."
}
$node = (Get-Command node -ErrorAction Stop).Source
$log = Join-Path $LogDir "backend.log"

# cmd.exe does the log redirection; the working directory makes dotenv find backend\.env.
$action = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument "/c `"`"$node`" dist\server.cjs >> `"$log`" 2>&1`"" `
  -WorkingDirectory $backendDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

# Restart after a crash (a non-zero exit), never stop it for running long, ignore a second start.
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew

# The current user, interactive logon, no elevation: the backend needs no admin rights.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive -RunLevel Limited

if ($PSCmdlet.ShouldProcess($TaskName, "Register Scheduled Task (node $bundle, log $log)")) {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description "satisfactory-dash backend: starts at logon, restarts on failure." -Force | Out-Null
  Write-Host "Registered '$TaskName'. Log file: $log"
  if ($Start) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Started. Check: Invoke-RestMethod http://127.0.0.1:3001/api/health"
  } else {
    Write-Host "It will start at your next logon; run again with -Start to start it now."
  }
}
