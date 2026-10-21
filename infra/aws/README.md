# infra/aws: the AWS base and the ECS service (ADR-0034, parts 1 and 2)

The state bucket, network, database, SSM parameter names and budget that the backend's ECS service
(a later issue) runs on. CI checks it (`.github/workflows/terraform.yml`: `fmt`, `validate`, `tflint`,
`terraform test` against a mock provider, and the static checks in `tests/static.test.mjs`) with no
AWS credentials. **CI never plans or applies.** The owner applies it by hand, in a normal session.

| File | What |
|---|---|
| `versions.tf` | Terraform `>= 1.11`, the AWS provider, the S3 backend with `use_lockfile` (us-east-1) |
| `providers.tf` | Region and default tags |
| `network.tf` | VPC, two public subnets, internet gateway; no NAT gateway. Task group: no inbound rules. |
| `rds.tf` | PostgreSQL 18, db.t4g.micro, single-AZ, 20 GB gp3, private, automated backups for `db_backup_retention_days` (default 1, 0 turns them off), password in Secrets Manager |
| `ssm.tf` | The `/satis/prod/*` names (never values) and their ARNs |
| `alarms.tf` | An SNS topic with an email subscription (`alarm_email`) and six CloudWatch alarms: ECS, RDS storage, RDS CPU, backend errors (#501), backend critical (a fatal line or an escalated worker failure) and failed sign-ins (#560; 2 of 2 five-minute periods, mails on ALARM only) |
| `budget.tf` | Monthly budget on gross spend (credits excluded) with two email alerts |
| `ecs.tf` | Cluster (Container Insights off), the 0.5 vCPU / 1 GB ARM64 task (backend + cloudflared), the service (#408) |
| `iam.tf` | The task execution role: reads the task's `/satis/prod/` parameters and writes its logs; no task role |
| `logs.tf` | One CloudWatch log group per container and one for the ops tasks, 14 days |
| `ops.tf` | The ops-image tasks `db-init`, `db-migrate`, `backup` and `restore` (#409) |
| `ops_iam.tf` | One execution role per ops task (only `db-init` reads the RDS master secret), and the scheduler's role |
| `schedule.tf` | EventBridge Scheduler runs the backup task nightly |
| `bootstrap/` | Creates the state bucket (versioned, SSE-S3, block-public-access, TLS only) |

## Credentials for an apply (PowerShell)

Terraform runs as the `satis-terraform` role through the `satis-tf` CLI profile, not the default IAM user,
which cannot read the state bucket (a 403 on `HeadObject` for the state file). The profile assumes the role
with MFA, and Terraform cannot prompt for an MFA code ("assume role with MFA enabled, but
AssumeRoleTokenProvider session option not set"), so the AWS CLI hands it temporary keys for about an hour:

```powershell
$env:AWS_PROFILE = 'satis-tf'
aws configure export-credentials --format powershell | Invoke-Expression   # asks for the MFA code
Remove-Item Env:AWS_PROFILE        # so Terraform uses the exported keys, not the MFA profile
terraform init "-backend-config=prod.s3.tfbackend"
```

Quote every `-flag=value` whose value has a dot: unquoted, PowerShell splits
`-backend-config=prod.s3.tfbackend` at the first dot ("No positional arguments are expected"). Close the
window afterwards, or remove `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` and
`AWS_CREDENTIAL_EXPIRATION` from `Env:`.

## First apply (owner, by hand)

1. **State bucket.** In `bootstrap/`: `terraform init`, then
   `terraform apply -var state_bucket_name=satis-tfstate-<account id>`. Its state is a local,
   git-ignored `terraform.tfstate`; if it's lost, `terraform import aws_s3_bucket.state <name>` (and the
   other bucket settings) restores it.
2. **Backend and variables.** In `infra/aws/`, copy `prod.s3.tfbackend.example` to `prod.s3.tfbackend`
   and `terraform.tfvars.example` to `terraform.tfvars`, and fill both in. Both copies are git-ignored.
3. `terraform init "-backend-config=prod.s3.tfbackend"` (with the credentials above), then apply **the base only** first: the ECS
   service can't turn healthy before its SSM values exist and the database is migrated, and the apply
   waits for it (`wait_for_steady_state`). So `terraform plan -target=aws_db_instance.main
   -target=aws_budgets_budget.monthly -out=base.tfplan`, read the plan, then `terraform apply base.tfplan`.
4. **SSM values.** For each name in `terraform output ssm_parameter_names`, put the value in by hand:
   `aws ssm put-parameter --type SecureString --name /satis/prod/<NAME> --value file://<file>`
   (a file, so the value stays out of shell history). Terraform never reads them, so they're never in
   state. `DATABASE_URL` uses `terraform output db_endpoint` and the `satis_app` role's password.
5. Confirm the budget subscription email AWS sends to the alert address.
6. **Migrate**, then **the service.** Apply the ops tasks and run `db-init` and `db-migrate` as ECS
   tasks inside the VPC (`docs-vault/wiki/runbooks/aws.md`, "Apply"), then the full
   `terraform plan -out=ecs.tfplan` and apply. The task
   needs `/satis/prod/` values for `DATABASE_URL`, `DASHBOARD_ADMIN_USER`,
   `DASHBOARD_ADMIN_PASSWORD_HASH`, `SESSION_SECRET` and `TUNNEL_TOKEN`; each optional setting listed in
   `backend_optional_secrets` needs its value too (SSM can't hold an empty one, and a missing parameter
   stops the task from starting). Plain settings go in `backend_environment`.

## The ECS service

- **Images.** The backend runs `backend_image`, always a `@sha256` digest (the variable refuses a
  tag), so a re-pushed `:main` never changes what runs. A deploy is a new digest in `terraform.tfvars`
  and an apply. cloudflared is pinned in `ecs.tf` to the same version and digest as `compose.yaml`
  (a static test keeps them equal). ECS pulls both anonymously (the task has no registry
  credentials), so the GHCR backend package must be public before the first service apply: the owner's
  one-time step from #404, which `GITHUB_TOKEN` can't do.
- **Networking (D2, loopback).** Both containers share the task's network namespace: the backend
  listens on `127.0.0.1:3001` and cloudflared reaches it at `http://127.0.0.1:3001`, starting only
  once the backend's `node -e` probe of `/api/health/ready` passes. No port mapping, no load
  balancer, no inbound rule; the public IP is for egress (no NAT gateway).
- **Deploys and rollback.** One task at a time (ADR-0010 assumes one backend), so a deploy stops the
  old task and starts the new one: a short outage. A new task that never turns healthy trips the
  deployment circuit breaker, which rolls back to the last good task definition; the apply then fails,
  and `terraform.tfvars` still names the bad digest, so put the good one back.
- **Credentials.** The execution role reads exactly the parameters the task injects (all under
  `/satis/prod/`) and writes the two log groups. There's no task role, so the containers hold no AWS
  credentials, and no access key exists (the B2 key is an SSM value). Listing an optional secret
  widens the policy on the next apply. The ops tasks get one role each (`ops_iam.tf`), not this one.
- **Logs.** `/ecs/satis-prod/backend` and `/ecs/satis-prod/cloudflared`, 14 days. Container
  Insights is off.

The RDS master password is generated by RDS and kept in Secrets Manager
(`terraform output db_master_user_secret_arn`). Only its ARN is in state.

The exit (ADR-0034 §6): set `db_deletion_protection = false`, apply, take the final `pg_dump`, then
`terraform destroy` (RDS leaves a final snapshot named `satis-prod-final`).

## Free plan eligibility (checked 2026-10-15)

- The AWS service list for the Free plan of the new sign-up
  ([Supported AWS services for Sign up for AWS (new)](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html),
  "AWS services included in the Free Tier") lists Amazon Relational Database Service, Amazon Elastic
  Container Service, Amazon Elastic Container Registry, Amazon Virtual Private Cloud, Amazon S3, AWS
  Systems Manager, AWS Secrets Manager, CloudWatch Logs, IAM and **AWS Budgets**. Budgets is not in the
  Paid-plan-only list, so the budget alert in `budget.tf` stays.
- [Amazon RDS Free Tier](https://aws.amazon.com/rds/free/): "Free plan is available on db.t3.micro and
  db.t4g.micro instances", for MySQL, **PostgreSQL**, MariaDB and SQL Server Express. The page names no
  engine-version limit, so PostgreSQL 18 is covered by the engine, not by a version-specific line.
- [Choosing a plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html):
  the Free plan excludes "services and features that could possibly deplete your credits, or hardware
  purchases" (Savings Plans, Reserved Instances, some Marketplace offers).
- **Not found in AWS documentation:** a line naming Fargate, or Fargate on ARM, specifically, or
  PostgreSQL 18 specifically. ECS is on the list and Fargate is ECS's serverless launch type, and the
  RDS page covers the engine, not its versions. The owner decided (2026-10-15, #405) that both are
  confirmed at the first `terraform apply` in the owner's operational session, not in CI or a PR.

### Fallbacks if AWS refuses at apply

- **PostgreSQL 18 refused on db.t4g.micro:** set `engine_version = "17"` in `rds.tf` and update the
  version assertion in `tests/base.tftest.hcl` (`rds_matches_adr_0034`). Nothing else changes: the
  app uses plain PostgreSQL (ADR-0034 §3), so a later in-place major upgrade to 18 is
  `allow_major_version_upgrade` for one apply. Mind the cutover: the PC's database is PostgreSQL 18,
  and a dump from a newer server isn't guaranteed to restore into an older one, so dump with the
  plain format and rehearse that restore into 17 before the move.
- **RDS backup retention refused (seen 2026-10-16, #418):** the first apply failed with
  `FreeTierRestrictionError: The specified backup retention period exceeds the maximum available to
  free tier customers` at the old hard-coded 7 days. Retention is now `db_backup_retention_days`,
  default 1. If 1 is refused too, set `db_backup_retention_days = 0` in `terraform.tfvars`, which
  turns RDS automated backups (and point-in-time restore) off. The nightly age-encrypted B2 backup
  (ADR-0035) is the real backup either way; RDS automated backups are only the fast-restore extra.
- **Fargate on ARM refused:** run the task on x86 instead, with `runtime_platform { cpu_architecture = "X86_64" }`
  in the ECS task definition (the ECS issue). The backend image is already multi-arch (linux/amd64 and
  linux/arm64), so only the platform changes. x86 Fargate costs about 25% more per vCPU and GB-hour
  than ARM, so re-check ADR-0034's monthly estimate against the credits.
