<#
.SYNOPSIS
  Proves the newest production backup restores: runs scripts/restore-check.mjs and asks only for the age key.

.DESCRIPTION
  The "Local restore check" of docs-vault/wiki/runbooks/backups.md, wrapped so the only thing to type is the key.
  - The bucket and endpoint are asked once and remembered in %LOCALAPPDATA%\satisfactory-dash\restore-check.json
    (they are not secret). -Reconfigure asks again.
  - The age private key is pasted at a hidden prompt, written to a file only you can read in a fresh temp folder,
    used for the one run and deleted in a finally block (success, failure or Ctrl-C). It is never saved anywhere else.
  - Needs Docker running, `age` and the AWS CLI v2 (the usual install folders are added to PATH for this run), and an
    AWS CLI profile holding the read-only B2 key (default `satis-backup-read`).
  Exit code: 0 PASS, 1 FAIL, 2 not run (something missing).

.EXAMPLE
  .\scripts\windows\restore-check.ps1
#>
[CmdletBinding()]
param(
  [string]$AwsProfile = '',
  [switch]$Reconfigure
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
. (Join-Path $PSScriptRoot 'tool-paths.ps1')
Add-ToolDirsToPath @((Get-DefaultAgeDir), (Get-DefaultAwsDir))

function Stop-NotRun([string]$Message) {
  Write-Host "NOT RUN: $Message" -ForegroundColor Yellow
  exit 2
}

# --- Settings (not secret), asked once ---
$settingsDir = Join-Path $env:LOCALAPPDATA 'satisfactory-dash'
$settingsFile = Join-Path $settingsDir 'restore-check.json'
$settings = $null
if ((Test-Path $settingsFile) -and -not $Reconfigure) {
  $settings = Get-Content $settingsFile -Raw | ConvertFrom-Json
}
if (-not $settings) {
  Write-Host 'First run: the backup bucket details (saved for next time, not secret).'
  $bucket = (Read-Host 'B2 bucket name').Trim()
  $endpoint = (Read-Host 'B2 S3 endpoint (https://s3.<region>.backblazeb2.com)').Trim()
  if (-not $bucket) { Stop-NotRun 'no bucket name given.' }
  if ($endpoint -notmatch '^https://') { Stop-NotRun 'the endpoint must start with https://' }
  $settings = [pscustomobject]@{ bucket = $bucket; endpoint = $endpoint; profile = 'satis-backup-read' }
  New-Item -ItemType Directory -Force $settingsDir | Out-Null
  $settings | ConvertTo-Json | Set-Content -Encoding utf8 $settingsFile
  Write-Host "Saved to $settingsFile"
}
if ($AwsProfile) { $settings.profile = $AwsProfile }

# --- Prerequisites ---
foreach ($tool in 'node', 'docker', 'age', 'aws') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-NotRun "'$tool' is not on PATH." }
}
& docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) { Stop-NotRun 'Docker is not running. Start Docker Desktop and try again.' }
if ($settings.profile -cnotmatch '^[A-Za-z][A-Za-z0-9_-]*\z') {
  # An older version of this script asked for the profile name, and a pasted keyID could land there.
  Stop-NotRun "the saved profile name '$($settings.profile)' is not a profile name. Run again with -Reconfigure."
}
$profiles = @(& aws configure list-profiles)
if ($profiles -notcontains $settings.profile) {
  # Create it once: the read-only B2 key (Backblaze, App Keys, Read Only, this bucket only). Written straight into the
  # AWS CLI's credentials file, so the secret never appears on a command line.
  Write-Host "The AWS CLI profile '$($settings.profile)' is missing. Create it now with a READ ONLY B2 application key"
  Write-Host '(Backblaze: App Keys > Add a New Application Key, this bucket only, type Read Only).'
  $keyId = (Read-Host 'B2 keyID').Trim()
  $appKeySecure = Read-Host 'B2 applicationKey (hidden)' -AsSecureString
  if ($keyId -cnotmatch '^[0-9a-zA-Z]+\z') { Stop-NotRun 'that keyID has unexpected characters.' }
  $appKeyBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($appKeySecure)
  try {
    $appKey = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($appKeyBstr)).Trim()
    if ($appKey -cnotmatch '^[0-9A-Za-z/+]+\z') { Stop-NotRun 'that applicationKey has unexpected characters.' }
    $awsDir = Join-Path $env:USERPROFILE '.aws'
    New-Item -ItemType Directory -Force $awsDir | Out-Null
    $region = if ($settings.endpoint -match '^https://s3\.([a-z0-9-]+)\.backblazeb2\.com') { $Matches[1] } else { 'us-east-005' }
    Add-Content -Encoding ascii (Join-Path $awsDir 'credentials') "`n[$($settings.profile)]`naws_access_key_id = $keyId`naws_secret_access_key = $appKey`n"
    Add-Content -Encoding ascii (Join-Path $awsDir 'config') "`n[profile $($settings.profile)]`nregion = $region`n"
    $appKey = $null
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($appKeyBstr)
  }
  Write-Host "Profile '$($settings.profile)' created."
}

# --- The key: pasted, hidden, used once, deleted ---
$secure = Read-Host 'Paste the age private key (AGE-SECRET-KEY-1...)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("satis-restore-key-" + [guid]::NewGuid().ToString('N'))
$exitCode = 2
try {
  $key = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim()
  if ($key -cnotmatch '^AGE-SECRET-KEY-1[0-9A-Z]+\z') { Stop-NotRun 'that does not look like an age private key (AGE-SECRET-KEY-1...).' }

  New-Item -ItemType Directory $tempDir | Out-Null
  # Only the current user may read the folder (inheritance off, every other entry removed).
  & icacls $tempDir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" *> $null
  if ($LASTEXITCODE -ne 0) { Stop-NotRun 'could not restrict the temp folder permissions; the key was not written.' }
  $keyFile = Join-Path $tempDir 'key.txt'
  [IO.File]::WriteAllText($keyFile, $key + "`n")
  $key = $null

  $env:BACKUP_S3_BUCKET = $settings.bucket
  $env:BACKUP_S3_ENDPOINT = $settings.endpoint
  $env:BACKUP_READ_AWS_PROFILE = $settings.profile
  $env:AGE_IDENTITY_FILE = $keyFile

  Write-Host 'Restoring the newest backup into a throwaway container (a few minutes)...'
  Push-Location $repoRoot
  try {
    & node (Join-Path 'scripts' 'restore-check.mjs')
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:AGE_IDENTITY_FILE -ErrorAction SilentlyContinue
  # SilentlyContinue so a locked file falls through to the explicit warning below instead of throwing here.
  if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue }
  if (Test-Path $tempDir) {
    Write-Host "WARNING: could not delete $tempDir, which holds the key. Delete it now." -ForegroundColor Red
    $exitCode = 1
  }
}

if ($exitCode -eq 0) { Write-Host 'PASS: the newest backup restores. The key file is deleted.' -ForegroundColor Green }
else { Write-Host "FAIL (exit $exitCode): read the reasons above. The key file is deleted." -ForegroundColor Red }
exit $exitCode
