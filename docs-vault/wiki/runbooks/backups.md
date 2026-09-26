# Runbook: database backups (ADR-0025 decision 7, PR 8b)

A nightly `pg_dump -Fc` of the app database, **encrypted on this PC with `age` to a public key**, then
uploaded to a private S3 bucket in **your own AWS account** with a **put-only** identity. The private
`age` key stays offline in your password manager, so neither this PC nor a leaked AWS key can read old
backups. The dumps are well under 1 MB, so keeping them for up to 37 days costs effectively nothing.

No session creates AWS resources, except the one-time bucket and budget setup, which reactapps-dc may run
through the time-boxed `satis-setup` identity described in ADR-0025 (decision 7 amendment), with every command
shown to the owner first. The owner creates both IAM users and types every secret himself. No session holds
your AWS credentials or the private key.

What the backup script does (`npm run backup -w backend`, source `backend/src/platform/backup/backup.ts`):

1. `pg_dump --format=custom --no-owner` of the database in `DATABASE_URL` (or `BACKUP_DATABASE_URL`, if
   `pg_dump` reports "permission denied" for a table or sequence as the app role: point it at the migrator
   role instead), into a private temp folder. Grants are kept so a restore works without re-granting. The
   password goes to `pg_dump` only through the `PGPASSWORD` environment variable, never on
   a command line.
2. `age --recipient <BACKUP_AGE_RECIPIENT>` writes `satis-<UTC time>.dump.age` into the local backup
   folder. **The plaintext dump is deleted immediately**, on success and on failure.
3. `aws s3 cp` to `s3://<bucket>/satis-dash/<file>` with the `satis-backup` profile. Skipped (and logged)
   when `BACKUP_S3_BUCKET` is empty.
4. Local housekeeping: only the newest `BACKUP_LOCAL_KEEP` (default 3) `satis-*.dump.age` files are kept.
   S3 retention is the bucket's lifecycle rule below, not the script.

Any failed step makes the script exit non-zero with a message that names the step and never contains a
password, a key or the connection URL (it can include the first few hundred characters of the tool's own
error, e.g. a host or database name from `pg_dump`, or an IAM ARN from AWS). `sslmode` in the URL is honoured.
A dump left behind by a run that was killed midway is swept at the start of the next run. Only an
allow-listed environment reaches `pg_dump`, `age` and `aws` (no `.env` secrets except the one
`PGPASSWORD`). A failed dump is never uploaded; a failed upload keeps the encrypted local copy.

## Your one-time setup

1. **Check the AWS account plan.** Accounts created before 2025-07-15 keep the legacy 12-month free
   tier. Newer accounts get a credit-based Free plan that ends after 6 months or when the credits run out
   `[NEEDS VERIFICATION: what happens to stored data when it ends]`. Backups must not live in an account
   that can lapse: upgrade to the Paid plan before relying on them (the cost stays cents).
2. **Budget:** a $1/month cost budget with an email alert.
3. **S3 bucket:** Block Public Access on (the default), versioning on, default encryption SSE-S3, and a
   lifecycle rule that expires current objects after **30 days** and noncurrent versions after **7** (so a backup is gone at most 37
   days after it was uploaded).
4. **IAM:** a policy allowing **only `s3:PutObject`** on `arn:aws:s3:::<bucket>/satis-dash/*` (no Get, List
   or Delete, so a compromised PC can't read or erase backups), attached to a user `satis-backup` with no
   console access (dumps are far below the AWS CLI's ~8 MB multipart threshold; if one ever grows past it, add
`s3:AbortMultipartUpload` to the policy). Create one access key into a **named AWS CLI profile** on this PC
   (`aws configure --profile satis-backup`), never into the repo or a chat. Rotate it every 90 days.
5. **age keys:** install `age` and run `age-keygen` **on a machine you trust, not necessarily this PC**.
   Put the private key (`AGE-SECRET-KEY-...`) in your password manager and nowhere else. Only the
   public key (`age1...`) goes in `backend\.env` as `BACKUP_AGE_RECIPIENT`.
6. **`backend\.env`:** set `BACKUP_AGE_RECIPIENT` and `BACKUP_S3_BUCKET` (see `backend/.env.example`).
7. **Tools on PATH:** `pg_dump` (PostgreSQL client tools, the same major version as the server or newer),
   `age`, and the AWS CLI v2.

### The `satis-setup` identity (optional; owner creates, delete the user after setup)

If you want reactapps-dc to run the one-time bucket and budget setup for you (every command shown to you
first), you create a **separate** IAM user `satis-setup` (not your admin, not `satis-backup`) and type its
secret yourself into `aws configure --profile satis-setup`. No session is given or pastes the secret, and only
the named profile is used. Sessions are instructed never to read the profile's credentials file (`~/.aws`); the
real protection is the narrow policy and the 48-hour expiry, not secrecy from sessions. Run the setup **before
the first backup exists**: within its window this identity could change lifecycle, versioning or encryption on a
bucket that already holds backups. Its policy allows only:

- on `arn:aws:s3:::satis-dash-backups-*`: `s3:CreateBucket`; `s3:PutBucketPublicAccessBlock` and
  `s3:GetBucketPublicAccessBlock`; `s3:PutBucketVersioning` and `s3:GetBucketVersioning`;
  `s3:PutEncryptionConfiguration` and `s3:GetEncryptionConfiguration`; `s3:PutLifecycleConfiguration` and
  `s3:GetLifecycleConfiguration`; `s3:PutBucketOwnershipControls` and `s3:GetBucketOwnershipControls`;
  `s3:GetBucketLocation`;
- `budgets:ViewBudget` and `budgets:ModifyBudget` on `arn:aws:budgets::<account>:budget/*`.

No object actions (no Get, Put or DeleteObject), no `s3:DeleteBucket`, `PutBucketPolicy` or `PutBucketAcl`, and
**no IAM actions at all**. Set the bucket's ownership control to `BucketOwnerEnforced` (ACLs off). Every
statement carries the conditions `aws:SecureTransport = true` and `aws:CurrentTime` before a deadline about 48
hours out, so the identity expires by itself even if you forget it. The expiry only exists if the condition is in
the policy you paste, so use this shape and replace `<deadline>` with a UTC time about 48 hours from now
(`2026-01-01T00:00:00Z` form) and `<account>` with your account id:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:PutBucketPublicAccessBlock", "s3:GetBucketPublicAccessBlock",
        "s3:PutBucketVersioning", "s3:GetBucketVersioning",
        "s3:PutEncryptionConfiguration", "s3:GetEncryptionConfiguration",
        "s3:PutLifecycleConfiguration", "s3:GetLifecycleConfiguration",
        "s3:PutBucketOwnershipControls", "s3:GetBucketOwnershipControls",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::satis-dash-backups-*",
      "Condition": {
        "Bool": { "aws:SecureTransport": "true" },
        "DateLessThan": { "aws:CurrentTime": "<deadline>" }
      }
    },
    {
      "Effect": "Allow",
      "Action": ["budgets:ViewBudget", "budgets:ModifyBudget"],
      "Resource": "arn:aws:budgets::<account>:budget/*",
      "Condition": {
        "Bool": { "aws:SecureTransport": "true" },
        "DateLessThan": { "aws:CurrentTime": "<deadline>" }
      }
    }
  ]
}
```

If the budget alert ever needs a notification channel beyond email, that is a new action to add here and to the
ADR, not something to grant ad hoc.
Bucket names are `satis-dash-backups-<random suffix>` (no personal data in a globally visible name). After the
setup, **delete the whole IAM user** (not just the key) and confirm in the IAM console; CloudTrail's free 90-day
event history is the audit trail. You still create `satis-backup` (put-only) and its key yourself, and the age
private key never leaves you.

## Backblaze B2 (ADR-0035: backups move off AWS)

The AWS account is on the Free plan and closes with the credits, deleting the bucket, so the nightly upload moves
to Backblaze B2 (free up to 10 GB, no card). The script is unchanged apart from one optional setting,
`BACKUP_S3_ENDPOINT`: when set it is passed to `aws s3 cp` as `--endpoint-url`; when empty the upload goes to AWS S3
exactly as before. The endpoint must be an `https://` URL with no credentials (the credentials live in the AWS CLI
profile, never in `.env`). The owner does these steps himself; no session holds a B2 key.

Owner steps:

1. Create a Backblaze account with 2FA, in a US region. The repo never names the region or the account.
2. Create a **private** bucket with **Object Lock enabled at creation** (it cannot be added later) and default
   retention **Governance, 30 days**.
3. Lifecycle rule: **hide files 30 days after upload, delete hidden files 7 days after hiding**. That keeps the
   "up to 37 days" promise on the privacy page.
4. Note the bucket's **S3 endpoint** (`https://s3.<region>.backblazeb2.com`). It becomes `BACKUP_S3_ENDPOINT`.
5. Create the application key **`satis-backup-upload`**: limited to this bucket only, **Write Only**. Check that no
   `deleteFiles` capability is listed. This key goes on the PC.
6. Create the application key **`satis-backup-read`**: this bucket only, **Read Only**. Keep it **offline** next to
   the age private key; it is for restores only. The master key is never used and never stored on the PC.
7. Create a new AWS CLI profile **`satis-backup-b2`** holding the upload key (key id and application key) and the
   endpoint's region (`aws configure --profile satis-backup-b2`).
8. In `backend\.env` set `BACKUP_S3_BUCKET=<the B2 bucket>`, `BACKUP_S3_ENDPOINT=<the endpoint>` and
   `BACKUP_AWS_PROFILE=satis-backup-b2`.

Cutover (ADR-0035):

1. Run the backup once by hand (`npm run backup -w backend`) and check the file is in the B2 bucket under `satis-dash/`.
2. **Restore rehearsal from B2** into a scratch database (the section below), downloading with the read key: use
   `--profile <read-profile> --endpoint-url <the endpoint>` on `aws s3 ls` and `aws s3 cp`. Row counts must match.
3. Switch the nightly task to B2 (the `.env` values above are what the task reads).
4. **Cutover PR, the same day as step 3** (a tiny privacy PR): the page ADDS the Backblaze row and item (the owner's
   approved text: "Backblaze stores encrypted backups for up to 37 days") and KEEPS the AWS ones, because the old S3
   copies stay for up to 37 days. The page describes only what runs today, so this PR does not merge before step 3.
5. Leave the old S3 bucket **read-only for 37 days**, then delete the bucket and the `satis-backup` IAM user.
6. **Second tiny PR, when the S3 bucket is deleted:** remove the AWS backups row and item from the privacy page (and
   update the privacy outline in both PRs to match).

## Missed-backup alerting (optional heartbeat)

Set `BACKUP_HEARTBEAT_URL` in `backend\.env` to a Better Stack heartbeat URL (create a daily heartbeat with a grace
period that alerts the ops address). After a backup that was **really uploaded**, the script sends one GET to it
(10-second timeout, redirects never followed). No ping in time means the backup did not happen, for whatever
reason: the task did not run, the PC was off, a step failed. Sending it is best effort: a failed ping is logged
(`heartbeat failed ...`) and never fails the backup, and a local-only trial run (no bucket) never pings. **The URL
is a secret** (anyone holding it can mark the heartbeat healthy): it lives only in `.env`, is never logged or put
in an error message, and must be `https` with no user name or password in it. A malformed value does NOT stop
the backup: the script logs one warning (`backup_heartbeat_misconfigured`, never the URL), skips the ping and
finishes the backup, so the data stays protected and Better Stack's missed-heartbeat alert still fires on the
absent ping.

## Recommended database role

Create the read-only `satis_backup` role (`DB_BACKUP_PASSWORD` when running `npm run db:init -w backend`, see the
database runbook) and set `BACKUP_DATABASE_URL=postgres://satis_backup:<password>@localhost:5432/satis` in
`backend\.env`. It can read every table and sequence (so a dump is complete by construction) and change nothing,
and the backup never borrows the app's or the migrator's credentials. Without `BACKUP_DATABASE_URL` the backup
uses `DATABASE_URL` (the app role).

## Try it locally first, without AWS

Use a throwaway database (a scratch database on the local Postgres is enough), a throwaway age key, and
no bucket:

```powershell
age-keygen -o "$env:TEMP\trial-age.key"      # prints the public key (age1...); this file is the private key
# In backend\.env for the trial: DATABASE_URL -> the scratch database,
#   BACKUP_AGE_RECIPIENT -> the printed public key, BACKUP_S3_BUCKET -> empty,
#   BACKUP_LOCAL_DIR -> a folder such as $env:TEMP\backup-trial
npm run backup -w backend
```

Expect `[backup] done: satis-....dump.age (local only)`. Then do the restore below against that file.
Delete the trial key and folder afterwards.

## Restore rehearsal (do it once before ADR-0025 deploy B, then now and then)

**The database roles must exist first.** The dump keeps grants to `satis_app`, so `pg_restore` needs the
roles that `npm run db:init -w backend` creates (`satis_migrator`, `satis_app`) to exist in the target
cluster, or it reports errors for every grant. On a fresh cluster run `db:init` before restoring.

Work in a scratch folder **outside the repo** (`.gitignore` also blocks `*.dump`, `*.age` and `*.key` as a
safety net, but don't rely on it). Download with **your admin AWS identity**, not the put-only
`satis-backup` profile (it can't read):

```powershell
New-Item -ItemType Directory "$env:TEMP\restore" | Set-Location
aws s3 ls s3://<bucket>/satis-dash/ --profile <your-admin-profile>
aws s3 cp s3://<bucket>/satis-dash/satis-<time>.dump.age . --profile <your-admin-profile>
age --decrypt --identity <path-to-private-key-file> --output satis.dump satis-<time>.dump.age
createdb --host 127.0.0.1 --username <superuser> satis_restore_test       # a SCRATCH database, never prod
pg_restore --no-owner --host 127.0.0.1 --username <superuser> --dbname satis_restore_test satis.dump
```

Take the private key out of the password manager into a temp file only for the `age --decrypt` and delete
it afterwards. Then check the restored data: point a **scratch copy of the backend** (a different port and a
`DATABASE_URL` for `satis_restore_test`) at it, run the migrations (`npm run db:migrate -w backend`; it must
report nothing to do, or apply cleanly if the backup is older than the code), and confirm
`/api/health/ready` answers 200 and a known account can sign in. When done, drop `satis_restore_test` and
delete the whole scratch folder (`Remove-Item -Recurse -Force "$env:TEMP\restore"`), including `satis.dump`
and the key file: a plaintext dump or a private key left on disk defeats the point.

A restored database keeps the audit purge function (`audit.purge_expired_events()`, owned by the restoring role,
grants kept), so the roles must exist first; audit events older than a year in an old backup are purged again
by the first worker run after the backend starts (the privacy policy's 1-year retention).

**Stored server tokens (ADR-0030).** Once servers are stored in the database (see `servers.md`), also check that the
restored data can be decrypted with the key you backed up: put the backed-up `SERVER_SECRETS_KEY` in the environment,
point `DATABASE_URL` at the scratch database, and run `npm run admin -- verify-secrets` from `backend\`. It must report
every connection opened and none unreadable (it prints no token). A key that only exists on this PC is not a backup.

**Rehearsal record (2026-09-25): passed.** The newest S3 object was decrypted with the offline age key and
restored into a scratch database. Row counts matched the live database (users 1/1, servers 1/1, members 1/1,
audit events 5/6: one event was newer than the dump). The newest migration in the restore was
`1790380800000_audit_purge`. The scratch database was dropped and the plaintext deleted.

**Rehearsal record (2026-09-26, from Backblaze B2): passed.** After the cutover the newest object was downloaded with
the offline read key, decrypted with the offline age key and restored into a scratch database: `pg_restore` exited 0
and the row counts matched the live database (users 1/1, servers 1/1, members 1/1, connections 1/1, audit events
10/10). The newest migration in the restore was `1790812800000_alert_production_kind`. The scratch database was dropped
and the plaintext deleted. The nightly task then ran against B2 with result 0 ("succeeded on attempt 1"). The S3
bucket is read-only from that day and is deleted, with the `satis-backup` IAM user, on or after **2026-11-02**.

To restore for real after a loss, the same steps apply, restoring into a fresh database that the backend
role owns (or run `npm run db:init -w backend` first for the roles), and only after stopping the backend.

## Scheduling

The nightly backup is a Windows Scheduled Task, `SatisfactoryDashBackup`, that runs
`scripts\windows\backup-task.ps1`. The wrapper runs `npm run backup -w backend` and, if it exits non-zero
(say the internet dropped during the S3 upload), waits 30 minutes and tries again, 4 attempts in total. It logs
to `%LOCALAPPDATA%\satisfactory-dash\logs\backup.log` (outside the repo) and exits 1 if every attempt failed, so
Task Scheduler's history shows the failure; the heartbeat is pinged by the backup itself only after a really
uploaded backup, so the monitor alerts when all attempts fail. **Why a wrapper:** Task Scheduler's "restart on
failure" setting only covers a task that failed to *launch*, not one that ran and exited non-zero, so the retry
lives in the script. The wrapper also puts the folders of `pg_dump`, `age` and the AWS CLI in front of `PATH` for
its own run (parameters `-PostgresBin`, `-AgeDir`, `-AwsDir`, with defaults that follow the standard install
locations), because the task's `PATH` often lacks them. Other parameters: `-RepoDir` (default: the repo that
holds the script), `-Attempts`, `-RetryMinutes`, `-Log`.

The task's settings:

| Setting | Value |
|---|---|
| Trigger | daily at 03:00 |
| Runs as | the interactive user (so the temp folder and the AWS profile are the user's own, not SYSTEM's) |
| Run when a run was missed | yes (`StartWhenAvailable`) |
| Only with a network | yes (`RunOnlyIfNetworkAvailable`) |
| Time limit | 3 hours (the retries can take about 90 minutes) |
| Overlap | `IgnoreNew` (a run still going is not started twice) |

Register it (as yourself, in PowerShell, from the repo root; nothing here needs admin rights):

```powershell
$repo   = (Get-Location).Path
$script = Join-Path $repo 'scripts\windows\backup-task.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" -WorkingDirectory $repo
$trigger  = New-ScheduledTaskTrigger -Daily -At '03:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'SatisfactoryDashBackup' -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal
```

Try it once by hand before relying on it: `Start-ScheduledTask -TaskName SatisfactoryDashBackup`, then read the log
file. Remove it with `Unregister-ScheduledTask -TaskName SatisfactoryDashBackup -Confirm:$false`. Run it from a
working directory that only you can write to (PowerShell and Windows search the current directory for `pg_dump`,
`age` and `aws` before `PATH`); the repo checkout you deploy from is that. Check it after a week: a new object
in the bucket every day, and the local folder holding at most `BACKUP_LOCAL_KEEP` files.

### Setting up the `satis_backup` role by hand

`db:init` with `DB_BACKUP_PASSWORD` creates the read-only `satis_backup` role and does all of this for you. If the
database already existed and you are adding the role manually (as a Postgres superuser; type the password
yourself, never paste it into a chat or a file):

```sql
CREATE ROLE satis_backup LOGIN PASSWORD '<a new password of 16+ characters>';
GRANT pg_read_all_data TO satis_backup;
ALTER ROLE satis_backup SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE satis TO satis_backup;   -- needed: the database revokes CONNECT from PUBLIC
```

Then set `BACKUP_DATABASE_URL=postgres://satis_backup:<password>@127.0.0.1:5432/satis` in `backend\.env`. Without the
`GRANT CONNECT`, the backup fails with `permission denied for database`. The app role cannot serve as the backup
role either: a dump as `satis_app` fails with `permission denied for sequence pgmigrations_id_seq`
(the migrations bookkeeping table's sequence, which the app role may not read), which is why the backup uses
`satis_backup` through `BACKUP_DATABASE_URL`.

## Privacy

The Backblaze wording (ADR-0035) is **"Backblaze stores encrypted backups for up to 37 days"** (the owner approved
it; the region is unnamed). **The cutover happened on 2026-09-26** and the page now lists BOTH providers: Backblaze,
and Amazon Web Services for the older copies it still holds (read-only, removed within 37 days). When the S3 bucket
and the `satis-backup` IAM user are deleted (on or after **2026-11-02**), the second tiny PR removes the AWS row and
item from the page (and updates the outline). The AWS wording below is what applied before the cutover.

The privacy page must say the truth once this ships: **Amazon Web Services stores encrypted backups for up
to 37 days, so deleted data can survive in backups for up to 37 days** (outline, sections A.4 and A.5). The
bucket is versioned: the 30-day lifecycle rule expires the current object, which becomes a noncurrent version
that is deleted 7 days later, so 37 days is the true worst case, not 30. The
edit to `frontend/public/privacy.html` goes with the frontend's privacy page PR, in the same change that
turns backups on (ADR-0025 gate B).
