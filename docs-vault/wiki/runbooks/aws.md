# Runbook: the backend on AWS (ADR-0034, issues #405, #408, #409)

The backend and cloudflared run as one ECS Fargate service; RDS PostgreSQL is private to the VPC, so
everything that touches the database runs **inside AWS as a one-off ECS task on the ops image**:
`db-init`, `db-migrate`, `backup` (also nightly, from EventBridge Scheduler) and `restore`. The
Terraform is `infra/aws/` (its `README.md` lists the files); CI only checks it. **The owner applies,
by hand, in a normal session.** Nothing here runs from a PR.

Every command runs in Git Bash or AWS CloudShell, from `infra/aws/`, with the owner's admin AWS
profile. `satis-prod` is the cluster and the service; `terraform output` gives the other names.

| Task family | Runs | Reads (besides its log group) |
|---|---|---|
| `satis-prod-ops-db-init` | `npm run db:init -w backend`: the roles and the database | `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD`, `DB_BACKUP_PASSWORD`, and the RDS master password from Secrets Manager (the only task that can) |
| `satis-prod-ops-db-migrate` | `npm run db:migrate -w backend` | `MIGRATOR_DATABASE_URL` |
| `satis-prod-ops-backup` | `npm run backup -w backend`, as compose.yaml's `backup` service | `BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`, the B2 upload key, `BACKUP_HEARTBEAT_URL` when `backup_heartbeat_enabled` |
| `satis-prod-ops-restore` | one backup from B2, decrypted, `pg_restore` in one transaction | `MIGRATOR_DATABASE_URL`, and the per-run `/satis/restore/*` values |

Each task has its own execution role reading only those values; no task has a task role, so no
container holds AWS credentials. Logs: `/ecs/satis-prod/ops`, one stream prefix per task, 14 days.

## Running an ops task

Once per shell, the network settings (the service's subnets and task group, the one RDS lets in):

```sh
NET="awsvpcConfiguration={subnets=[$(terraform output -json public_subnet_ids | tr -d '[]" ')],securityGroups=[$(terraform output -raw task_security_group_id)],assignPublicIp=ENABLED}"
run_ops() {  # run_ops <task> [extra run-task arguments]: runs it, waits, prints the exit code
  local task="$1"; shift
  local arn
  arn=$(aws ecs run-task --cluster satis-prod --launch-type FARGATE --task-definition "satis-prod-ops-$task" \
    --network-configuration "$NET" "$@" --query 'tasks[0].taskArn' --output text) || return 1
  aws ecs wait tasks-stopped --cluster satis-prod --tasks "$arn"
  aws ecs describe-tasks --cluster satis-prod --tasks "$arn" \
    --query 'tasks[0].{exit:containers[0].exitCode,reason:stoppedReason}' --output table
  aws logs tail /ecs/satis-prod/ops --log-stream-name-prefix "$task/" --since 30m
}
```

The same in PowerShell (set the region first; the sh form takes it from your AWS profile):

```powershell
$env:AWS_DEFAULT_REGION = 'us-east-1'
$subnets = (terraform output -json public_subnet_ids | ConvertFrom-Json) -join ','
$NET = "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$(terraform output -raw task_security_group_id)],assignPublicIp=ENABLED}"
function run_ops {  # run_ops <task> [extra run-task arguments]: runs it, waits, prints the exit code
  $task = $args[0]; $rest = @($args | Select-Object -Skip 1)
  $arn = aws ecs run-task --cluster satis-prod --launch-type FARGATE --task-definition "satis-prod-ops-$task" `
    --network-configuration $NET @rest --query 'tasks[0].taskArn' --output text
  if ($LASTEXITCODE -ne 0) { return }
  aws ecs wait tasks-stopped --cluster satis-prod --tasks $arn
  aws ecs describe-tasks --cluster satis-prod --tasks $arn `
    --query 'tasks[0].{exit:containers[0].exitCode,reason:stoppedReason}' --output table
  aws logs tail /ecs/satis-prod/ops --log-stream-name-prefix "$task/" --since 30m
}
```

Exit code `0` is success. A task that never started (a missing SSM parameter, an image pull refused)
shows no exit code and says why in `reason`.

## Apply

The first apply follows `infra/aws/README.md` ("First apply"), with the ops pieces in this order:

1. **Variables.** In `terraform.tfvars` (git-ignored) set `backend_image` and `ops_image`, each by
   digest from the image workflow's GHCR push, and `backup_b2` (the bucket, its
   `https://s3.<region>.backblazeb2.com` endpoint and that region; see `terraform.tfvars.example`). Both
   GHCR packages, backend and ops, must be public before ECS can pull them (the owner's step from #404).
2. **Base**, as in the README: RDS and the budget only, with `-target`.
3. **SSM values**, each by `aws ssm put-parameter --type SecureString --name /satis/prod/<NAME>
   --value file://<file>` (`terraform output ssm_parameter_names` lists them). For the ops tasks:
   - `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD`, `DB_BACKUP_PASSWORD`: three different hex passwords,
     16+ characters (hex needs no escaping in a URL).
   - `MIGRATOR_DATABASE_URL`, `BACKUP_DATABASE_URL` and the backend's `DATABASE_URL`, all to the
     `satis` database at `terraform output -raw db_endpoint`, as `satis_migrator`, `satis_backup` and
     `satis_app`, each ending in `?sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem`
     (the RDS CA bundle both images carry).
   - `BACKUP_AGE_RECIPIENT` (the public key only), and `B2_ACCESS_KEY_ID` and `B2_SECRET_ACCESS_KEY`:
     the B2 **upload** key `satis-backup-upload` ([`backups.md`](./backups.md), the B2 section). The
     ops tasks hand the B2 key to the AWS CLI as its access key; it is never an AWS key.
   - `BACKUP_HEARTBEAT_URL` only if you set `backup_heartbeat_enabled = true` (recommended: a backup
     that starts and fails alerts nobody otherwise).
4. **The ops tasks**, with every target the first ops run needs (as used on 2026-10-16): without the
   policy the tasks can't read SSM, and without the cluster and the network they can't start.

   ```sh
   terraform plan -target=aws_ecs_task_definition.ops -target=aws_iam_role_policy.ops_execution \
     -target=aws_ecs_cluster.main -target=aws_internet_gateway.main -target=aws_route_table.public \
     -target=aws_route_table_association.public -target=aws_default_security_group.main -out=ops.tfplan
   ```

   Read it, then `terraform apply ops.tfplan` (it brings their roles and the log group along). In
   PowerShell, quote each `-target=...` (and `-backend-config=...` at `terraform init`), e.g.
   `'-target=aws_ecs_task_definition.ops'`: unquoted, PowerShell splits the argument at the `.`.
5. **Database**: `run_ops db-init`, then **Check the backup role** (below), then `run_ops db-migrate`.
   At the cutover, restore the PC's latest backup in between (see Restore).
6. **Everything else**: `terraform plan -out=all.tfplan`, read it, `terraform apply all.tfplan`. This
   adds the service (the apply waits until it is healthy) and the nightly backup schedule.
7. **First backup by hand**: `run_ops backup`, then check the file is in the B2 bucket under
   `satis-dash/` (with the read key; `backups.md`).

Every later change is the same three steps: edit, `terraform plan -out=<name>.tfplan`, read the
plan, `terraform apply <name>.tfplan`. Never `apply` without reading a saved plan.

## Deploy

A deploy is a new image digest. Get both from the image workflow's run for the commit (or
`docker buildx imagetools inspect ghcr.io/<owner>/satisfactory-dash-backend:main --format '{{json .Manifest.Digest}}'`,
and the same for `-ops`).

1. Set `ops_image` and `backend_image` to the new digests in `terraform.tfvars`.
2. Ops first, so the migrations run before the new backend starts (compose.yaml's order):
   `terraform plan -target=aws_ecs_task_definition.ops -out=ops.tfplan`, read, apply.
3. `run_ops db-migrate` (see **Migrate**).
4. `terraform plan -out=deploy.tfplan`, read it (only the backend task definition, the service and
   the schedule's task revision should change), `terraform apply deploy.tfplan`.

The service stops the old task before starting the new one (one backend, ADR-0010), so expect a short
outage. A new task that never turns healthy trips the circuit breaker, which rolls back; the apply
then fails. Put the last good `backend_image` back in `terraform.tfvars` and apply again.

### Health checks

ECS checks liveness only: the backend container's health check fetches `/api/health`, which answers
while the process is up and never touches the database (#425). Readiness is watched by an external
uptime monitor on `/api/health/ready`, not by ECS, so a short RDS restart (weekly maintenance, a minor
upgrade) makes the monitor alert without ECS replacing a healthy task. cloudflared still waits for the
backend to turn healthy, which now means the tunnel connects once the process is up, before the
database may be reachable; `/api/health/ready` answers 503 until it is. Set the monitor up during the
cutover and point it at `https://<dashboard host>/api/health/ready`.

## Migrate

`run_ops db-migrate`. It applies every pending migration in `backend/migrations` as `satis_migrator`
and is a no-op when none is pending, so running it twice is safe. Read the log tail for the
migrations it ran. A failed migration exits non-zero: don't deploy the backend; fix it in a PR, build
a new ops image, and run it again.

## Restore

The restore task takes one backup from B2 and restores it into the database `MIGRATOR_DATABASE_URL`
names, as `satis_migrator` (which owns it), in **one transaction**: into a database that already has
tables it fails and changes nothing. So it is for an **empty** database, right after `db-init` and
before `db-migrate`: the cutover from the PC, or a new RDS instance after a loss. To undo a bad change
on a live RDS database, use RDS point-in-time restore instead, within `db_backup_retention_days` of
automated backups (default 1 day, since the AWS Free plan refused 7). With
`db_backup_retention_days = 0` there is no point-in-time restore, and the B2 backup is the only way back.

The age private key and the B2 **read** key are given **for that run only**: put into
`/satis/restore/`, used by the task when it starts, then deleted. They are never kept in SSM or
Secrets Manager, and Terraform never names their values.

1. Scale the service to 0 (below), so nothing writes while you restore.
2. Find the file: `aws s3 ls s3://<bucket>/satis-dash/ --endpoint-url <endpoint> --profile <read profile>`
   (`backups.md`). Pick the newest `satis-<time>.dump.age`.
3. Put the per-run values in, from files outside the repo:

   ```sh
   aws ssm put-parameter --type SecureString --name /satis/restore/AGE_IDENTITY --value file://<age key file>
   aws ssm put-parameter --type SecureString --name /satis/restore/B2_READ_KEY_ID --value file://<key id file>
   aws ssm put-parameter --type SecureString --name /satis/restore/B2_READ_APPLICATION_KEY --value file://<key file>
   ```

4. Run it with the file name. The delete is on the same line after `;`, so it runs **whatever the
   result**:

   ```sh
   run_ops restore --overrides '{"containerOverrides":[{"name":"ops","environment":[{"name":"RESTORE_FILE","value":"satis-<time>.dump.age"}]}]}'; aws ssm delete-parameters --names /satis/restore/AGE_IDENTITY /satis/restore/B2_READ_KEY_ID /satis/restore/B2_READ_APPLICATION_KEY
   ```

   ECS reads the values when the task starts, so they can go as soon as it is running. Check they are
   gone: `aws ssm get-parameters-by-path --path /satis/restore/` lists nothing.
5. `run_ops db-migrate` (the backup may predate the newest migration), then scale back to 1 and check
   `/api/health/ready` answers 200 and a known account can sign in.

The task refuses (exit 2, nothing downloaded) a `RESTORE_FILE` that is missing, has a `/` or `..`,
or isn't named `satis-*.dump.age`. Rehearse once on a scratch instance before the cutover (ADR-0034
§6), and record the row counts as `backups.md` does.

## Scale to 0

```sh
aws ecs update-service --cluster satis-prod --service satis-prod --desired-count 0
aws ecs wait services-stable --cluster satis-prod --services satis-prod
```

Scale back up with `--desired-count 1`. `ecs.tf` sets `desired_count = 1`, so the next `terraform apply`
also scales it back to 1. RDS keeps running (and costing) while the service is at 0, and the nightly
backup still runs.

## Monthly credit check

Once a month (ADR-0034 §4), with the owner's identity:

```sh
aws freetier get-account-plan-state
```

Record `accountPlanRemainingCredits` and the plan status in the cutover issue. The exit starts when
about one month of credits remains (about $35), or 45 days before 2027-03-15, whichever comes first.
The budget alert in `budget.tf` is the second signal; confirm its email subscription once.
[NEEDS VERIFICATION] the command's full output shape: note the field names here after the first run.

## Check the backup role

`db-init` grants `pg_read_all_data` to `satis_backup` as the RDS master user, which on RDS is a member
of `rds_superuser`, not a superuser. That grant succeeded on RDS PostgreSQL 18 at the first `db-init`
(2026-10-16). Two other things a non-superuser master runs into, which `db-init` handles since #421:

- Since PostgreSQL 16 a `CREATEROLE` user holds the roles it creates with `ADMIN` but without `SET` or
  `INHERIT`, so it can neither make `satis_migrator` a database owner nor act as it. `db-init` grants
  itself `SET` (never `INHERIT`) on `satis_migrator` for those steps only and revokes it afterwards,
  also when a step fails; the master keeps no role membership (check: `pg_auth_members`).
- RDS creates the `db_name` database (`satis`) at launch, owned by the master. `db-init` hands it to
  `satis_migrator` (the `public` schema follows, being owned by `pg_database_owner`) and keeps
  `CONNECT` on it for the master, so a re-run can still connect.

To check the grant on a new instance, right after its first `db-init`:

1. The `db-init` log ends with `Database "satis" and roles satis_migrator, satis_app, satis_backup are
   ready`. A refused grant fails the task with `permission denied to grant role "pg_read_all_data"`.
2. Ask the database, as `satis_backup`, with the backup task and a one-off command. Save this as
   `check-backup-role.json` outside the repo:

   ```json
   {"containerOverrides":[{"name":"ops","command":["sh","-c","psql \"$BACKUP_DATABASE_URL\" -Atc \"select pg_has_role(current_user, 'pg_read_all_data', 'member')\""]}]}
   ```

   then `run_ops backup --overrides file://check-backup-role.json`. The log shows `t` when the grant
   holds. It needs no B2 access and writes nothing.
3. The first `run_ops backup` succeeding is the end-to-end proof.

If the grant is refused, stop and file an issue: the fallback (per-schema `SELECT` grants from the
migrator) is a change to `backend/src/platform/db/admin.ts`. Never point `BACKUP_DATABASE_URL` at the
master or the migrator role.
