# Runbook: database backups (ADR-0025 decision 7, PR 8b)

A nightly `pg_dump -Fc` of the app database, **encrypted on this PC with `age` to a public key**, then
uploaded to a private S3 bucket in **your own AWS account** with a **put-only** identity. The private
`age` key stays offline in your password manager, so neither this PC nor a leaked AWS key can read old
backups. The dumps are well under 1 MB, so 30 days costs effectively nothing.

No session (Claude or otherwise) creates AWS resources, holds your AWS credentials or the private
key. Everything under "Your one-time setup" is yours to do.

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
password, a key or a URL. A failed dump is never uploaded; a failed upload keeps the encrypted local copy.

## Your one-time setup

1. **Check the AWS account plan.** Accounts created before 2025-07-15 keep the legacy 12-month free
   tier. Newer accounts get a credit-based Free plan that ends after 6 months or when the credits run out
   `[NEEDS VERIFICATION: what happens to stored data when it ends]`. Backups must not live in an account
   that can lapse: upgrade to the Paid plan before relying on them (the cost stays cents).
2. **Budget:** a $1/month cost budget with an email alert.
3. **S3 bucket:** Block Public Access on (the default), versioning on, default encryption SSE-S3, and a
   lifecycle rule that expires current objects after **30 days** and noncurrent versions after **7**.
4. **IAM:** a policy allowing **only `s3:PutObject`** on `arn:aws:s3:::<bucket>/satis-dash/*` (no Get, List
   or Delete, so a compromised PC can't read or erase backups), attached to a user `satis-backup` with no
   console access. Create one access key into a **named AWS CLI profile** on this PC
   (`aws configure --profile satis-backup`), never into the repo or a chat. Rotate it every 90 days.
5. **age keys:** install `age` and run `age-keygen` **on a machine you trust, not necessarily this PC**.
   Put the private key (`AGE-SECRET-KEY-...`) in your password manager and nowhere else. Only the
   public key (`age1...`) goes in `backend\.env` as `BACKUP_AGE_RECIPIENT`.
6. **`backend\.env`:** set `BACKUP_AGE_RECIPIENT` and `BACKUP_S3_BUCKET` (see `backend/.env.example`).
7. **Tools on PATH:** `pg_dump` (PostgreSQL client tools, the same major version as the server or newer),
   `age`, and the AWS CLI v2.

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

Download with **your admin AWS identity**, not the put-only `satis-backup` profile (it can't read):

```powershell
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
`/api/health/ready` answers 200 and a known account can sign in. Drop `satis_restore_test` and delete
`satis.dump` when done: a plaintext dump on disk defeats the point.

To restore for real after a loss, the same steps apply, restoring into a fresh database that the backend
role owns (or run `npm run db:init -w backend` first for the roles), and only after stopping the backend.

## Scheduling

The Windows scheduled task that runs `npm run backup -w backend` nightly is registered by the
coordinator session (ADR-0025 build plan, 8b), as the same user who owns the AWS profile. It runs
`npm run backup -w backend` from the repo root and must show a failure (non-zero exit) in Task Scheduler
history when any step fails. Check it after a week: a new object in the bucket every day, and the local
folder holding at most `BACKUP_LOCAL_KEEP` files.

## Privacy

The privacy page must say the truth once this ships: **Amazon Web Services stores encrypted backups for
30 days, so deleted data can survive in backups for up to 30 days** (outline, sections A.4 and A.5). The
edit to `frontend/public/privacy.html` goes with the frontend's privacy page PR, in the same change that
turns backups on (ADR-0025 gate B).
