<#
.SYNOPSIS
  Updates the deployed satisfactory-dash backend to origin/main and restarts it.

.DESCRIPTION
  Run this on the game PC, in the shell you use for deployments, against the DEPLOY checkout (the
  folder the backend Scheduled Task runs from). It does, in order:

    1. git fetch, then check out origin/main DETACHED in the deploy checkout;
    2. npm ci --include=dev, then build the backend (npm run build -w backend);
    3. npm run backup -w backend: a fresh encrypted database backup BEFORE the migration
       (migrations are forward-only, so this backup is the only way back for the schema); a failed
       backup aborts the deploy. There is deliberately no switch to skip it;
    4. npm run db:migrate (every time: migrations are forward-only and idempotent);
    5. restart the backend Scheduled Task with scripts\windows\register-backend-task.ps1 -Start,
       taken from the NEW checkout;
    6. wait for /api/health/ready, then confirm from the local run file (issue #320) that the
       commit actually serving is the NEW one, not a leftover old process; fail with the tail of
       the wrapper log if either check fails;
    7. print the old and the new commit.

  It stops at the first failing step. A failure BEFORE step 5 leaves the running backend untouched
  (the old process keeps serving); the checkout, node_modules and backend\dist have already changed (a wrapper restart of the old process would load the new build).

  Secrets: it reads none and prints none. Step 3 runs `npm run backup`, which reads DATABASE_URL and
  the BACKUP_* settings from backend\.env itself and prints no secret (its messages never contain a
  password, key or URL). Step 4 needs MIGRATOR_DATABASE_URL, which db-migrate.ts
  reads itself from this shell's environment (or backend\.env, as it always did): set it in the
  shell before running (runbooks\database.md). This script never looks at .env or the variable.
  The log tail in step 6 is the wrapper log (backend.log), which run-backend.ps1 already writes.

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

.PARAMETER PostgresBin
  Folder holding pg_dump, for the backup step. Default: the newest bin folder under
  %ProgramFiles%\PostgreSQL, if any (the same default as backup-task.ps1, from tool-paths.ps1).

.PARAMETER AgeDir
  Folder holding age, for the backup step. Default: %USERPROFILE%\.local\bin.

.PARAMETER AwsDir
  Folder holding the AWS CLI, for the backup step. Default: %ProgramFiles%\Amazon\AWSCLIV2.

.PARAMETER RunFileDir
  Issue #320: passed through to register-backend-task.ps1's -RunFileDir. After the readiness wait
  (step 6), this script also reads <RunFileDir>\backend.json and requires its commit to equal the
  deployed SHA and its startedAt to be later than this script's own restart step — proving the NEW
  build is the one that answered readiness, not a leftover old process or a second instance.
  Default: %LOCALAPPDATA%\satisfactory-dash\run (register-backend-task.ps1's own default).

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
  [string]$PostgresBin = "",
  [string]$AgeDir = "",
  [string]$AwsDir = "",
  [string]$RunFileDir = (Join-Path $env:LOCALAPPDATA "satisfactory-dash\run"),
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
  # The tool-folder defaults and PATH helper shared with backup-task.ps1 (only defines functions).
  $toolPathsFile = Join-Path $PSScriptRoot "tool-paths.ps1"
  if (-not (Test-Path -LiteralPath $toolPathsFile)) {
    throw "tool-paths.ps1 is missing next to this script ($PSScriptRoot). Run the script from a complete checkout."
  }
  . $toolPathsFile

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
    Write-Step "1/7 Fetching $Remote and checking out $target detached"
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
    Write-Step "2/7 npm ci (from the lockfile) and building the backend"
    # --include=dev: the build and the migrator (esbuild, tsx) are dev dependencies, and a machine-wide
    # NODE_ENV=production would otherwise make npm ci skip them.
    Invoke-Native "npm ci" $npm @("ci", "--include=dev")
    Invoke-Native "npm run build -w backend" $npm @("run", "build", "-w", "backend")
    if (-not (Test-Path -LiteralPath (Join-Path $DeployDir "backend\dist\server.cjs"))) {
      throw "The build finished but backend\dist\server.cjs is missing."
    }
  }

  # ---- 3. Back up the database (the only way back for a forward-only migration) ----
  # pg_dump, age and the AWS CLI are often not on a plain shell's PATH: their folders (the same defaults as
  # backup-task.ps1, from tool-paths.ps1) go in front of PATH for this step only, and PATH is restored after it.
  if (-not $PostgresBin) { $PostgresBin = Get-DefaultPostgresBin }
  if (-not $AgeDir) { $AgeDir = Get-DefaultAgeDir }
  if (-not $AwsDir) { $AwsDir = Get-DefaultAwsDir }
  $backupToolDirs = @(Get-ExistingToolDirs @($PostgresBin, $AgeDir, $AwsDir))
  $toolText = if ($backupToolDirs.Count -gt 0) { $backupToolDirs -join "; " } else { "none of the default tool folders exist; PATH is used as it is" }
  if ($PSCmdlet.ShouldProcess($DeployDir, "3. npm run backup -w backend (a fresh encrypted backup; reads backend\.env itself; tool folders in front of PATH: $toolText)")) {
    Write-Step "3/7 Backing up the database before migrating (tool folders in front of PATH: $toolText)"
    $savedPath = $env:Path
    try {
      Add-ToolDirsToPath $backupToolDirs
      # Fail early and by name, not deep inside the backup: the dump and the encryption need these two.
      foreach ($tool in @("pg_dump", "age")) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
          throw "'$tool' was not found on PATH or in the tool folders above. Pass the folder that holds it (-PostgresBin for pg_dump, -AgeDir for age) or add it to PATH."
        }
      }
      if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
        Write-Warning "The AWS CLI ('aws') was not found: an off-machine upload will fail. Pass -AwsDir, or leave BACKUP_S3_BUCKET empty for a local-only backup."
      }
      Invoke-Native "npm run backup" $npm @("run", "backup", "-w", "backend")
    } catch {
      throw "$($_.Exception.Message)`nThe deploy was ABORTED before the migration and the restart, because there is no fresh backup to go back to. The running process still has the previous build loaded, but the checkout ($newSha) and backend\dist are already the NEW build, so do not let the backend restart before this is fixed. Fix the backup (runbooks\backups.md: backend\.env BACKUP_* settings, the AWS profile, pg_dump and age reachable, see -PostgresBin, -AgeDir, -AwsDir) and run this script again; it is safe to re-run."
    } finally {
      $env:Path = $savedPath
    }
  }

  # ---- 4. Migrate ----
  if ($PSCmdlet.ShouldProcess($DeployDir, "4. npm run db:migrate -w backend (needs MIGRATOR_DATABASE_URL in this shell)")) {
    Write-Step "4/7 Applying database migrations (idempotent)"
    try {
      Invoke-Native "npm run db:migrate" $npm @("run", "db:migrate", "-w", "backend")
    } catch {
      throw "$($_.Exception.Message)`nThe backend was NOT restarted: the running process still has the previous build loaded, but the checkout ($newSha) and backend\dist are already the NEW build, so do not let the backend restart before this is fixed. MIGRATOR_DATABASE_URL must be set in this shell (runbooks\database.md); the migrator script reports it if it is missing."
    }
  }

  # ---- 5. Restart the backend task (the helper of the NEW checkout) ----
  $register = Join-Path $DeployDir "scripts\windows\register-backend-task.ps1"
  # Captured right before the restart: issue #320's proof (step 6) requires the run file's
  # startedAt to be later than this, so a leftover OLD process (which started earlier) can't pass.
  # UTC, to match $startedAt below (RoundtripKind on the backend's "Z"-suffixed ISO string): DateTime
  # comparison operators compare raw ticks and ignore Kind, so comparing a Local Get-Date against a
  # UTC-parsed value would silently be off by the machine's UTC offset.
  $restartTime = (Get-Date).ToUniversalTime()
  if ($PSCmdlet.ShouldProcess($TaskName, "5. restart the Scheduled Task: $register -Start")) {
    Write-Step "5/7 Restarting the backend task '$TaskName'"
    & $register -TaskName $TaskName -LogDir $LogDir -Port $Port -RunFileDir $RunFileDir -Start
  }

  # ---- 6. Wait for readiness ----
  if ($PSCmdlet.ShouldProcess("http://127.0.0.1:$Port/api/health/ready", "6. wait up to $HealthTimeoutSeconds s for HTTP 200")) {
    Write-Step "6/7 Waiting up to $HealthTimeoutSeconds s for the backend to be ready"
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

    # ---- Issue #320: prove the NEW build is the one that answered, not a leftover old process ----
    # /api/health/ready is public, so it deliberately carries no version; this local run file
    # (option C of the design note) is what actually proves it.
    $runFile = Join-Path $RunFileDir "backend.json"
    if (Test-Path -LiteralPath $runFile) {
      $info = Get-Content -LiteralPath $runFile -Raw | ConvertFrom-Json
      $problem = $null
      if (-not $info.commit) {
        $problem = "the run file has no commit."
      } elseif ($info.commit -ne $newSha) {
        $problem = "the run file's commit ($($info.commit)) does not match the deployed commit ($newSha)."
      } elseif (-not $info.startedAt) {
        $problem = "the run file has no startedAt."
      } else {
        $startedAt = [DateTime]::Parse($info.startedAt, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
        if ($startedAt -le $restartTime) {
          $problem = "the run file's startedAt ($($info.startedAt)) is not after this deploy's restart ($($restartTime.ToString('o')))."
        }
      }
      if ($problem) {
        $state = try { (Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).State } catch { "unknown" }
        Write-Host ""
        Write-Host "Readiness answered 200, but the run file doesn't prove the NEW build is serving: $problem (task state: $state)"
        Show-LogTail
        throw "Deploy FAILED: readiness answered 200, but the run file shows a stale process is still serving ($problem)."
      }
      Write-Step "Confirmed: the run file shows commit $($info.commit), started $($info.startedAt) (after the restart) - the NEW build is serving."
    } else {
      Write-Warning "No run file at $runFile: cannot confirm the NEW build is serving beyond the readiness 200 (RUN_FILE_DIR may not be set on this deploy, or the deployed commit predates issue #320)."
    }
  }

  # ---- 7. Report ----
  $newLine = Read-Native "Reading the new commit" $git @("log", "-1", "--format=%h %s", "HEAD")
  Write-Step "7/7 Done"
  Write-Host "Old commit: $oldLine"
  Write-Host "New commit: $newLine"
  if ($WhatIfPreference) {
    Write-Host "(-WhatIf: nothing was changed.)"
  } elseif ($newSha -eq $oldSha) {
    Write-Host "The checkout was already at $target; the backend was rebuilt, backed up, migrated and restarted anyway."
  }
} catch {
  Write-Host ""
  Write-Host "[deploy-update] FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Set-Location -LiteralPath $startedIn
  exit 1
}
# The script changed directory to the checkout: put the caller's shell back where it was.
Set-Location -LiteralPath $startedIn
