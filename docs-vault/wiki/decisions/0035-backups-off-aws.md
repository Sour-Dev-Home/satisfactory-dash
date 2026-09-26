# ADR-0035: Nightly backups move off AWS

Status: accepted (owner, 2026-09-26: Backblaze B2; the privacy row reads "Backblaze stores encrypted
backups for up to 37 days")

## Context
- The nightly backup (ADR-0025, `runbooks/backups.md`) dumps PostgreSQL, encrypts the dump with age,
  and uploads it with `aws s3 cp` to a versioned S3 bucket, using the `satis-backup` profile. Copies
  expire after 30 days, and noncurrent versions after 7 more (37 days in total, as the privacy page
  says). The dumps are well under 1 MB.
- The AWS account is on the Free plan and closes when the credits run out or on 2027-03-15, deleting
  the bucket. Backups must not depend on that account.
- Free tiers (checked 2026-09-26):
  - **Backblaze B2**: 10 GB free, no card needed, S3-compatible API, native file versions, lifecycle
    rules, Object Lock.
  - **Cloudflare R2**: 10 GB-month, 1M Class A and 10M Class B operations free, free egress, lifecycle
    rules, bucket locks (retention by age). Enabling R2 **requires a payment method on file**, and
    usage beyond the free tier is billed automatically.

## Decision
- **Backblaze B2** is the backup store. It's free with no card, so no charge is possible, and it's a
  different provider from the hosting (Cloudflare) and from AWS. R2 is the alternative if the owner
  prefers one fewer account and accepts a card on file.
- The bucket is private, with Object Lock enabled at creation (governance mode, 30-day default
  retention), so a leaked upload key cannot delete or overwrite recent backups.
- Lifecycle: hide files 30 days after upload, and delete hidden files 7 days later. That keeps the
  "up to 37 days" promise.
- Keys: the nightly task uses an application key limited to this bucket, with only the capabilities
  needed to write and list (no delete). A separate read key for restores is kept offline with the age
  key. The master key is never on the PC.
- Code: the upload stays `aws s3 cp` against B2's S3-compatible endpoint (`--endpoint-url`, and B2's
  key id and key as the profile's credentials). The script gains one setting (`BACKUP_S3_ENDPOINT`)
  and keeps working with S3 or R2 unchanged. It's configuration, not a vendor rewrite.
- Cutover:
  1. Create the bucket and keys.
  2. Run the task once by hand to B2.
  3. Rehearse a restore from B2 into a scratch database (row counts match).
  4. Switch the nightly task to B2.
  5. Keep S3 read-only for 37 days, then delete the bucket and the `satis-backup` IAM user.
- The privacy page's backups row names Backblaze instead of AWS, in the cutover PR (the standing rule).
  The owner approves the wording.

## Consequences
- Backups survive the AWS account closing. The age private key stays offline, as today.
- One more provider account for the owner to hold, with 2FA.

## Revisit when
- The dumps approach 5 GB in total (half the free allowance).
