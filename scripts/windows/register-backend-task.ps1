<#
.SYNOPSIS
  Registers a Scheduled Task that starts the satisfactory-dash backend at logon.

.DESCRIPTION
  Runs run-backend.ps1, which runs `node dist\server.cjs` from the backend folder (so dotenv
  finds backend\.env) with NODE_ENV=production, restarts it if it exits with a failure (3
  tries, one minute apart, so a configuration error doesn't loop forever), and appends its
  output to a log file OUTSIDE the repository. Build first: `npm run build -w backend`.

  LIMITS: the task starts when YOU log on and runs in your session, in a visible console
  window (closing that window stops the backend). It does not start after a reboot until you
  log on, so use Windows auto-logon if this PC must recover unattended. Only the current
  user is involved; no admin rights are needed.

  It changes nothing else: no service, no firewall rule, no .env edit. Run with -WhatIf to
  see what it would do without doing it. Undo with unregister-backend-task.ps1.

.PARAMETER TaskName
  The Scheduled Task's name. Default: SatisfactoryDashBackend.

.PARAMETER LogDir
  Where the log file goes. Default: %LOCALAPPDATA%\satisfactory-dash\logs (outside the repo).

.PARAMETER Port
  The port the backend listens on, checked before starting. Default: 3001.

.PARAMETER Start
  Also start the task right now (otherwise it starts at the next logon). If the task is
  already running it is stopped first, and it refuses to start while anything else is
  listening on the port.

.EXAMPLE
  .\scripts\windows\register-backend-task.ps1 -WhatIf
  .\scripts\windows\register-backend-task.ps1 -Start
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$TaskName = "SatisfactoryDashBackend",
  [string]$LogDir = (Join-Path $env:LOCALAPPDATA "satisfactory-dash\logs"),
  [int]$Port = 3001,
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
  throw "Missing backend\.env. Create it first (see the go-live runbook, section 1)."
}
$node = (Get-Command node -ErrorAction Stop).Source
# run-backend.ps1 changes directory to backend\, so make the log path absolute.
$LogDir = [System.IO.Path]::GetFullPath($LogDir)
$log = Join-Path $LogDir "backend.log"
if (-not (Test-Path (Join-Path $PSScriptRoot "run-backend.ps1"))) {
  throw "Missing run-backend.ps1 next to this script."
}

# run-backend.ps1 runs node from backend\ (so dotenv finds backend\.env) with
# NODE_ENV=production, appends to the log, and restarts node after a failure. Task Scheduler's
# own restart-on-failure did not restart a killed backend (tested), hence the wrapper.
$wrapper = Join-Path $PSScriptRoot "run-backend.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`" -BackendDir `"$backendDir`" -Node `"$node`" -Log `"$log`"" `
  -WorkingDirectory $backendDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

# Restarts after a crash are handled by run-backend.ps1 (3 tries, a minute apart), not by
# Task Scheduler. Never stop it for running long; ignore a second start.
$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew

# The current user, interactive logon, no elevation: the backend needs no admin rights.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive -RunLevel Limited

if ($PSCmdlet.ShouldProcess($TaskName, "Register Scheduled Task (node $node, bundle $bundle, log $log)")) {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description "satisfactory-dash backend: starts at logon, restarts on failure (3 tries)." -Force | Out-Null
  Write-Host "Registered '$TaskName'. Log file: $log"
  if ($Start) {
    # -Force replaced the definition, but a running instance keeps the OLD one: stop it first.
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($busy) {
      # A leftover backend from an earlier run of this task (or a backend started by hand) is
      # ours to stop; anything else holding the port is not.
      $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($busy[0].OwningProcess)" -ErrorAction SilentlyContinue
      if ($owner -and $owner.Name -eq "node.exe" -and $owner.CommandLine -match "server\.cjs") {
        Write-Host "Stopping the leftover backend (process id $($owner.ProcessId)) that still holds port $Port."
        Stop-Process -Id $owner.ProcessId -Force
        Start-Sleep -Seconds 2
        $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
      }
    }
    if ($busy) {
      throw "Port $Port is still in use by process id $($busy[0].OwningProcess). Stop that process first (a foreground backend, or a dev server), then run this again with -Start."
    }
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Started. Check: Invoke-RestMethod http://127.0.0.1:$Port/api/health"
  } else {
    Write-Host "It will start at your next logon; run again with -Start to start it now."
  }
}
