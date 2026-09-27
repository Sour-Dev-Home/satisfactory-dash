<#
.SYNOPSIS
  Updates the deployed satisfactory-dash backend to origin/main and restarts it.

.DESCRIPTION
  Run this on the game PC, in the shell you use for deployments, against the DEPLOY checkout (the
  folder the backend Scheduled Task runs from). It does, in order:

    1. git fetch, then check out origin/main DETACHED in the deploy checkout;
    2. npm ci --include=dev, then build the backend (npm run build -w backend);
    3. npm run db:migrate (every time: migrations are forward-only and idempotent);
    4. restart the backend Scheduled Task with scripts\windows\register-backend-task.ps1 -Start,
       taken from the NEW checkout;
    5. wait for /api/health/ready and, if the backend does not come up, fail with the tail of the
       wrapper log;
    6. print the old and the new commit.

  It stops at the first failing step. A failure BEFORE step 4 leaves the running backend untouched
  (the old process keeps serving); the checkout, node_modules and backend\dist have already changed (a wrapper restart of the old process would load the new build).

  Secrets: it reads none and prints none. Step 3 needs MIGRATOR_DATABASE_URL, which db-migrate.ts
  reads itself from this shell's environment (or backend\.env, as it always did): set it in the
  shell before running (runbooks\database.md). This script never looks at .env or the variable.
  The log tail in step 5 is the wrapper log (backend.log), which run-backend.ps1 already writes.

  Use -WhatIf to print the steps without doing any of them. It still reads (never changes) the
  checkout to show the current commit.

  If -Ref is older than the checked-out commit (a rollback of the code), it warns: the database
  migrations do not go back.

.PARAMETER DeployDir
  The deploy checkout (the repository root the task runs from). Default: the environment variable
  SATISFACTORY_DASH_DEPLOY_DIR. There is no built-in default path: without either, it stops.

.PARAMETER Remote
  The git remote to fetch. Default: origin.

.PARAMETER Ref
  The branch to deploy from -Remote. Default: main.

.PARAMETER TaskName
  The backend Scheduled Task. Default: SatisfactoryDashBackend.

.PARAMETER Port
  The port the backend listens on. Default: 3001.

.PARAMETER LogDir
  The folder of the wrapper log (backend.log). Default: %LOCALAPPDATA%\satisfactory-dash\logs,
  the same default as register-backend-task.ps1.

.PARAMETER HealthTimeoutSeconds
  How long to wait for the backend to answer /api/health/ready with 200. Default: 90.

.PARAMETER LogTailLines
  How many lines of backend.log to print when the wait fails. Default: 40.

.EXAMPLE
  $env:SATISFACTORY_DASH_DEPLOY_DIR = "<the deploy checkout>"
  .\scripts\windows\deploy-update.ps1 -WhatIf
  .\scripts\windows\deploy-update.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$DeployDir = $env:SATISFACTORY_DASH_DEPLOY_DIR,
  [string]$Remote = "origin",
  [string]$Ref = "main",
  [string]$TaskName = "SatisfactoryDashBackend",
  [int]$Port = 3001,
  [string]$LogDir = (Join-Path $env:LOCALAPPDATA "satisfactory-dash\logs"),
  [int]$HealthTimeoutSeconds = 90,
  [int]$LogTailLines = 40
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$message) {
  Write-Host ""
  Write-Host "[deploy-update] $message"
}

# Runs a native command and stops the script when it exits non-zero. stderr is NOT redirected: under
# Windows PowerShell 5.1 a redirected native stderr becomes error records and would stop the script
# on harmless progress output (git, npm).
function Invoke-Native([string]$What, [string]$Exe, [string[]]$Arguments) {
  $global:LASTEXITCODE = $null
  & $Exe @Arguments
  $code = $LASTEXITCODE
  if ($null -eq $code -or $code -ne 0) {
    throw "$What failed (exit code $code): $Exe $($Arguments -join ' ')"
  }
}

# The output of a native command as text, for read-only questions (a commit id). Fails like Invoke-Native.
function Read-Native([string]$What, [string]$Exe, [string[]]$Arguments) {
  $global:LASTEXITCODE = $null
  $lines = @(& $Exe @Arguments)
  $code = $LASTEXITCODE
  if ($null -eq $code -or $code -ne 0) {
    throw "$What failed (exit code $code): $Exe $($Arguments -join ' ')"
  }
  return (($lines | ForEach-Object { "$_" }) -join "`n").Trim()
}

function Show-LogTail {
  $wrapperLog = Join-Path ([System.IO.Path]::GetFullPath($LogDir)) "backend.log"
  Write-Host ""
  if (Test-Path -LiteralPath $wrapperLog) {
    Write-Host "Last $LogTailLines lines of $wrapperLog :"
    Get-Content -LiteralPath $wrapperLog -Tail $LogTailLines | ForEach-Object { Write-Host "  $_" }
  } else {
    Write-Host "No wrapper log at $wrapperLog."
  }
  Write-Host "(If LOG_DIR is set in backend\.env, the backend's own daily logs are there.)"
}

# 200 from /api/health/ready, or the status code / error text otherwise. Never throws.
function Get-Readiness {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health/ready" -UseBasicParsing -TimeoutSec 5
    return [string][int]$response.StatusCode
  } catch {
    $status = $null
    try { $status = [int]$_.Exception.Response.StatusCode } catch { }
    if ($status) { return [string]$status }
    return "no answer"
  }
}

function Test-Listening {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

$startedIn = (Get-Location).Path
try {
  # ---- Checks (read-only) ----
  if (-not $DeployDir) {
    throw "No deploy checkout given. Pass -DeployDir <path> or set the environment variable SATISFACTORY_DASH_DEPLOY_DIR."
  }
  if (-not (Test-Path -LiteralPath $DeployDir -PathType Container)) {
    throw "The deploy checkout '$DeployDir' does not exist or is not a folder."
  }
  $DeployDir = (Resolve-Path -LiteralPath $DeployDir).Path
  # -Remote and -Ref go to git: allow only plain names, and never one that starts with "-" (git would read it as an option).
  foreach ($pair in @(@("Remote", $Remote), @("Ref", $Ref))) {
    if ($pair[1] -notmatch '^[A-Za-z0-9_][A-Za-z0-9._/-]*$') {
      throw "-$($pair[0]) '$($pair[1])' is not a plain git name (letters, digits, . _ / - only, not starting with - or .)."
    }
  }
  $git = (Get-Command git -ErrorAction Stop).Source
  # Prefer npm.cmd: plain "npm" resolves to npm.ps1 first, which an execution policy can block.
  $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $npmCmd) { $npmCmd = Get-Command npm -ErrorAction Stop | Select-Object -First 1 }
  $npm = $npmCmd.Source

  Set-Location -LiteralPath $DeployDir
  $top = Read-Native "Finding the repository root" $git @("rev-parse", "--show-toplevel")
  # git prints forward slashes; compare as full paths, case-insensitively (Windows).
  if ([System.IO.Path]::GetFullPath($top) -ne [System.IO.Path]::GetFullPath($DeployDir)) {
    throw "'$DeployDir' is not the root of a git checkout (its root is '$top'). Point -DeployDir at the repository root."
  }
  foreach ($needed in @("package.json", "backend\package.json", "scripts\windows\register-backend-task.ps1")) {
    if (-not (Test-Path -LiteralPath (Join-Path $DeployDir $needed))) {
      throw "'$DeployDir' does not look like the satisfactory-dash checkout (missing $needed)."
    }
  }
  # A detached checkout would carry uncommitted changes along or fail; tracked changes here mean someone
  # edited the deploy checkout by hand. Untracked and ignored files (.env, node_modules, dist) are fine.
  $dirty = Read-Native "Checking the working tree" $git @("status", "--porcelain", "--untracked-files=no")
  if ($dirty) {
    throw "The deploy checkout has uncommitted changes to tracked files; refusing to switch it. Commit, stash or discard them first:`n$dirty"
  }

  $oldSha = Read-Native "Reading the current commit" $git @("rev-parse", "HEAD")
  $oldLine = Read-Native "Reading the current commit" $git @("log", "-1", "--format=%h %s", $oldSha)
  $target = "$Remote/$Ref"

  Write-Step "Deploy checkout: $DeployDir"
  Write-Step "Current commit : $oldLine"
  Write-Step "Target         : $target (detached), task '$TaskName', port $Port"
  if ($WhatIfPreference) {
    Write-Step "-WhatIf: nothing below is executed."
  }

  # ---- 1. Fetch and check out detached ----
  $newSha = $oldSha
  if ($PSCmdlet.ShouldProcess($DeployDir, "1. git fetch $Remote, then git checkout --detach $target")) {
    Write-Step "1/6 Fetching $Remote and checking out $target detached"
    # Never wait for a credential prompt in an unattended step: fail instead (restored right after).
    $previousPrompt = $env:GIT_TERMINAL_PROMPT
    $env:GIT_TERMINAL_PROMPT = "0"
    try {
      Invoke-Native "git fetch" $git @("fetch", "--quiet", "--prune", $Remote)
    } finally {
      $env:GIT_TERMINAL_PROMPT = $previousPrompt
    }
    $newSha = Read-Native "Resolving $target" $git @("rev-parse", "--verify", "--quiet", "$target^{commit}")
    # Warn (do not block) about going back: migrations are forward-only.
    if ($newSha -ne $oldSha) {
      $global:LASTEXITCODE = $null
      & $git merge-base --is-ancestor $newSha $oldSha
      if ($LASTEXITCODE -eq 0) {
        Write-Warning "$target is OLDER than the checked-out commit: this rolls the code back, but the database migrations do not go back. The backend may not start against a newer schema."
      }
    }
    Invoke-Native "git checkout" $git @("checkout", "--detach", "--quiet", $newSha)
  }

  # ---- 2. Install and build ----
  if ($PSCmdlet.ShouldProcess($DeployDir, "2. npm ci, then npm run build -w backend")) {
    Write-Step "2/6 npm ci (from the lockfile) and building the backend"
    # --include=dev: the build and the migrator (esbuild, tsx) are dev dependencies, and a machine-wide
    # NODE_ENV=production would otherwise make npm ci skip them.
    Invoke-Native "npm ci" $npm @("ci", "--include=dev")
    Invoke-Native "npm run build -w backend" $npm @("run", "build", "-w", "backend")
    if (-not (Test-Path -LiteralPath (Join-Path $DeployDir "backend\dist\server.cjs"))) {
      throw "The build finished but backend\dist\server.cjs is missing."
    }
  }

  # ---- 3. Migrate ----
  if ($PSCmdlet.ShouldProcess($DeployDir, "3. npm run db:migrate -w backend (needs MIGRATOR_DATABASE_URL in this shell)")) {
    Write-Step "3/6 Applying database migrations (idempotent)"
    try {
      Invoke-Native "npm run db:migrate" $npm @("run", "db:migrate", "-w", "backend")
    } catch {
      throw "$($_.Exception.Message)`nThe backend was NOT restarted: the running process still has the previous build loaded, but the checkout ($newSha) and backend\dist are already the NEW build, so do not let the backend restart before this is fixed. MIGRATOR_DATABASE_URL must be set in this shell (runbooks\database.md); the migrator script reports it if it is missing."
    }
  }

  # ---- 4. Restart the backend task (the helper of the NEW checkout) ----
  $register = Join-Path $DeployDir "scripts\windows\register-backend-task.ps1"
  if ($PSCmdlet.ShouldProcess($TaskName, "4. restart the Scheduled Task: $register -Start")) {
    Write-Step "4/6 Restarting the backend task '$TaskName'"
    & $register -TaskName $TaskName -LogDir $LogDir -Port $Port -Start
  }

  # ---- 5. Wait for readiness ----
  if ($PSCmdlet.ShouldProcess("http://127.0.0.1:$Port/api/health/ready", "5. wait up to $HealthTimeoutSeconds s for HTTP 200")) {
    Write-Step "5/6 Waiting up to $HealthTimeoutSeconds s for the backend to be ready"
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
    $retried = $false
    $seen = ""
    $ready = $false
    while ((Get-Date) -lt $deadline) {
      $seen = Get-Readiness
      if ($seen -eq "200") { $ready = $true; break }
      # A start issued right after a stop once left the task Ready with nothing listening (2026-09-24,
      # go-live runbook): start it once more if, well into the wait, still nothing listens.
      if (-not $retried -and ((Get-Date) -gt $deadline.AddSeconds(-($HealthTimeoutSeconds * 0.6))) -and -not (Test-Listening)) {
        Write-Warning "Nothing listens on port $Port yet; starting the task once more."
        Start-ScheduledTask -TaskName $TaskName
        $retried = $true
      }
      Start-Sleep -Seconds 2
    }
    if (-not $ready) {
      $state = try { (Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).State } catch { "unknown" }
      Write-Host ""
      Write-Host "The backend did not become ready within $HealthTimeoutSeconds s (last answer: $seen; task state: $state)."
      Show-LogTail
      throw "Deploy FAILED at the readiness check: the checkout is at $newSha; the backend is not serving. See the log tail above."
    }
    Write-Step "Ready: /api/health/ready answered 200."
  }

  # ---- 6. Report ----
  $newLine = Read-Native "Reading the new commit" $git @("log", "-1", "--format=%h %s", "HEAD")
  Write-Step "6/6 Done"
  Write-Host "Old commit: $oldLine"
  Write-Host "New commit: $newLine"
  if ($WhatIfPreference) {
    Write-Host "(-WhatIf: nothing was changed.)"
  } elseif ($newSha -eq $oldSha) {
    Write-Host "The checkout was already at $target; the backend was rebuilt, migrated and restarted anyway."
  }
} catch {
  Write-Host ""
  Write-Host "[deploy-update] FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Set-Location -LiteralPath $startedIn
  exit 1
}
# The script changed directory to the checkout: put the caller's shell back where it was.
Set-Location -LiteralPath $startedIn
