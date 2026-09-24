<#
.SYNOPSIS
  Stops and removes the Scheduled Task made by register-backend-task.ps1.

.DESCRIPTION
  Stops the task if it is running and unregisters it. It does not delete the log file, the
  build, or backend\.env, and does not touch cloudflared. Run with -WhatIf to preview.

.PARAMETER TaskName
  The Scheduled Task's name. Default: SatisfactoryDashBackend.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$TaskName = "SatisfactoryDashBackend"
)

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "No Scheduled Task named '$TaskName'; nothing to do."
  return
}

if ($PSCmdlet.ShouldProcess($TaskName, "Stop and unregister Scheduled Task")) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed '$TaskName'. If the backend process is still running, stop it: Get-Process node."
}
