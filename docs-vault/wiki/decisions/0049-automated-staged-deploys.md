# ADR-0049: Automated, staged backend deploys (GitHub OIDC, a throwaway staging task, an approval gate)

Status: **proposed** (architect, 2026-10-21), for the owner's review. Written at the owner's request (2026-10-21): "How
do we automate these deployments like real production (and have a test environment for deployment, test suite, then
rollout). I'm tired of doing this every time." Amends ADR-0034 §2 (one environment) and the runbook's "the owner applies,
by hand" for image rollouts only. Changes two points of the direction the owner agreed to explore, on code evidence:
staging gets **its own throwaway PostgreSQL inside the staging task, not a second database in the RDS instance** (D3),
and **its own cluster and tunnel, not the production ones** (D3). The frontend (Cloudflare) and the self-hosted agent are
out of scope.

## Context

### Today's deploy, by hand (`runbooks/aws.md`, "Deploy")
1. Pin `backend_image` and `ops_image` by digest in the git-ignored `terraform.tfvars` (`runbooks/aws.md:107-111`;
   both variables refuse anything but `repo@sha256:...`, `infra/aws/variables.tf:79-87`, `:114-122`).
2. `terraform plan/apply -target=aws_ecs_task_definition.ops` (`runbooks/aws.md:112-113`).
3. `run_ops db-migrate`, a one-off ECS task (`runbooks/aws.md:114`, `:22-37`, `:132-137`).
4. `terraform plan/apply` for the backend task definition and the service (`runbooks/aws.md:115-116`), then check the
   rollout and `/api/health/ready`. A failed rollout means putting the old digest back and applying again (`:118-120`).

### What the code already gives us
- **The service:** one Fargate task, `desired_count = 1`, stop-before-start (`minimum_healthy_percent = 0`,
  `maximum_percent = 100`) because ADR-0010's in-process limits and pollers assume one instance, and the circuit
  breaker with rollback (`infra/aws/ecs.tf:104-134`). Its task definition takes the image from `var.backend_image`
  (`ecs.tf:55`), and `wait_for_steady_state = true` makes `terraform apply` the deploy step (`ecs.tf:132-133`).
- **No task role anywhere.** The containers hold no AWS credentials; each task has an execution role that reads exactly
  its SSM parameters (`ecs.tf:44-45`, `iam.tf:1-46`, `ops_iam.tf:1-53`). The roles a deploy must hand to ECS are two:
  `satis-prod-ecs-execution` (`iam.tf:8`) and `satis-prod-ops-db-migrate` (`ops_iam.tf:10`). There are no "task roles" to
  pass.
- **The ops tasks** share one image (`ops.tf:152`); `db-migrate` reads only `MIGRATOR_DATABASE_URL` (`ops.tf:96-101`).
  The nightly backup schedule pins the backup task's **revision** ARN (`schedule.tf:22`), and the scheduler's role
  already shows the scoping pattern this ADR reuses: `ecs:RunTask` on one family with an `ecs:cluster` condition, and
  `iam:PassRole` on one role with `iam:PassedToService` (`ops_iam.tf:80-91`).
- **Alarms** exist for `backend-errors` and `backend-critical` (`alarms.tf:89-104`, `:121-136`), both 5-minute periods
  by default (`variables.tf:186`, `:189`); six alarms in all, inside the 10-alarm free tier (`alarms.tf:1-3`).
- **Images:** every push to `main` builds, smoke-tests (from-scratch `db:init`, `db:migrate`, then `/api/health/ready` on
  amd64) and publishes `ghcr.io/sour-dev-home/satisfactory-dash-{backend,ops}:main` and `:<sha>` with the commit in the
  `org.opencontainers.image.revision` label (`.github/workflows/image.yml:116-153`, `:155-198`). Only the push job has
  `packages: write`; the workflow default is `contents: read` (`image.yml:14-15`, `:160-162`).
- **CI never touches AWS today** (`.github/workflows/terraform.yml:3-5`), and the runbook says "The owner applies, by
  hand ... Nothing here runs from a PR" (`runbooks/aws.md:6-7`). ADR-0043 made `main` auto-merge on `verify`, `e2e` and
  `security` with no review (`0043-retire-lanes.md:22-30`).
- **Schema changes are already additive by rule:** the backend refuses a schema behind its build and accepts one ahead
  of it, "so an older build keeps working (the rollback path)" (`backend/src/platform/db/schemaVersion.ts:12-34`). None
  of the 19 migrations in `backend/migrations/` drops, renames or retypes a column (grep, 2026-10-21). Nothing enforces
  the rule yet.

### Two facts that change the agreed direction
- **PostgreSQL roles are per instance, not per database, and ours are hard-coded.** `db:init` always creates or
  re-passwords `satis_migrator`, `satis_app` and `satis_backup` (`backend/src/platform/db/admin.ts:13-17`, `:100-104`),
  and 8 of the 19 migrations grant to `satis_app` by name (e.g. `backend/migrations/1790208000000_schemas.sql:9`). A
  second database in the same RDS instance would therefore either reset production's role passwords at its `db:init`, or
  run on production's own `satis_app` credential, which also holds `CONNECT` on the production database
  (`admin.ts:132-135`). Either way a staging task would carry a working production database credential. Parameterising
  the role names cannot fix the applied migrations.
- **One Cloudflare tunnel token is one tunnel.** A second cloudflared started with production's `TUNNEL_TOKEN` becomes
  another connector of the same tunnel, which serves every hostname on it, so Cloudflare could route some
  `api.satis-manager.com` requests to the staging build. The production tunnel has exactly one hostname rule by design
  (`runbooks/aws.md:281-285`). Staging needs a tunnel of its own (free).

## Decision

### D1. GitHub Actions deploys through OIDC, with two least-privilege roles
No long-lived AWS key exists anywhere, and CI won't add one. Terraform adds the IAM OIDC provider for
`https://token.actions.githubusercontent.com` (client id `sts.amazonaws.com`) and two roles. Each is assumable only by a
job that names its GitHub environment, so the environment's protection rules (D5) gate the credentials themselves.

**Subject claim.** When a job references an environment, GitHub's `sub` is
`repo:<owner>/<repo>:environment:<name>` and carries no branch (GitHub OIDC reference). So the branch rule lives on the
environment ("Deployment branches: `main` only"). On top of that, the owner sets the repository's OIDC subject template
to include `job_workflow_ref` (`PUT /repos/{owner}/{repo}/actions/oidc/customization/sub` with
`include_claim_keys: ["repo", "context", "job_workflow_ref"]`). That binds each role to the deploy workflow file on
`main`. No other workflow uses OIDC today (`terraform.yml:3-5`), so the change affects nothing else.

Trust policy, `satis-prod-deploy` (`satis-staging-deploy` is the same with `staging`):

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": { "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:Sour-Dev-Home/satisfactory-dash:environment:production:job_workflow_ref:Sour-Dev-Home/satisfactory-dash/.github/workflows/deploy.yml@refs/heads/main"
  } }
}
```

`StringEquals` is case-sensitive. [NEEDS VERIFICATION] at the first run: print the token's `sub` (it is not a secret) and
match its case exactly. Maximum session: 1 hour.

**`satis-prod-deploy` permissions** (`<p>` = `arn:aws`, `<r>` = `us-east-1`, `<a>` = the account id):

| Sid | Actions | Resource | Condition |
|---|---|---|---|
| TaskDefinitions | `ecs:RegisterTaskDefinition`, `ecs:DescribeTaskDefinition` | `*` (no resource-level permission; the AWS deploy action's own minimal policy uses `*` for register) | none |
| RunMigrate | `ecs:RunTask` | `<p>:ecs:<r>:<a>:task-definition/satis-prod-ops-db-migrate:*` | `ArnEquals ecs:cluster` = the `satis-prod` cluster ARN |
| WatchMigrate | `ecs:DescribeTasks` | `<p>:ecs:<r>:<a>:task/satis-prod/*` | `ArnEquals ecs:cluster` = the cluster ARN |
| RollOut | `ecs:UpdateService`, `ecs:DescribeServices` | `<p>:ecs:<r>:<a>:service/satis-prod/satis-prod` | none |
| PassExecutionRoles | `iam:PassRole` | `satis-prod-ecs-execution`, `satis-prod-ops-db-migrate` (role ARNs) | `StringEquals iam:PassedToService` = `ecs-tasks.amazonaws.com` |
| WatchAlarms | `cloudwatch:DescribeAlarms` | the `satis-prod-backend-errors` and `satis-prod-backend-critical` alarm ARNs | none |
| ReadMigrateLog | `logs:GetLogEvents` | `<p>:logs:<r>:<a>:log-group:/ecs/satis-prod/ops:log-stream:db-migrate/*` | none |
| ReadDeployRecord | `ssm:GetParameter` | `<p>:ssm:<r>:<a>:parameter/satis/deploy/prod/*` | none |
| WriteRelease | `ssm:PutParameter` | `<p>:ssm:<r>:<a>:parameter/satis/deploy/prod/released` | none |

**`satis-staging-deploy` permissions:**

| Sid | Actions | Resource | Condition |
|---|---|---|---|
| TaskDefinitions | `ecs:RegisterTaskDefinition`, `ecs:DescribeTaskDefinition` | `*` | none |
| RunStaging | `ecs:RunTask` | `<p>:ecs:<r>:<a>:task-definition/satis-staging:*` | `ArnEquals ecs:cluster` = the `satis-staging` cluster ARN |
| WatchAndStop | `ecs:DescribeTasks`, `ecs:StopTask` | `<p>:ecs:<r>:<a>:task/satis-staging/*` | `ArnEquals ecs:cluster` = the staging cluster ARN |
| PassExecutionRole | `iam:PassRole` | `satis-staging-ecs-execution` | `StringEquals iam:PassedToService` = `ecs-tasks.amazonaws.com` |
| ReadLogs | `logs:GetLogEvents`, `logs:FilterLogEvents` | `<p>:logs:<r>:<a>:log-group:/ecs/satis-staging:*` | none |
| ReadDeployRecord | `ssm:GetParameter` | `parameter/satis/deploy/staging/*` and `parameter/satis/deploy/prod/released` | none |

Neither role gets `ssm:GetParameters` on `/satis/prod/*` or `/satis/staging/*`, any `secretsmanager:*`, `ecs:CreateService`,
`DeleteService`, `DeregisterTaskDefinition`, `ecs:TagResource` (no tags are sent), `ec2:*` (network settings come from
`DescribeServices` or from environment variables), `rds:*`, IAM beyond `PassRole`, or the backend's log groups. Terraform
writes the policies with `jsonencode`, as today, and `infra/aws/tests/` asserts each list exactly, with no wildcard
action. [NEEDS VERIFICATION] in the IAM policy simulator on the first apply: `DescribeTaskDefinition`'s and
`DescribeAlarms`' resource types; widen to `*` only for the one that refuses an ARN.

### D2. Terraform owns configuration; CI owns which image runs
- `aws_ecs_service.main` gets `lifecycle { ignore_changes = [task_definition] }`, so `terraform plan` stays clean after a
  CI rollout, and an apply never rolls an image back.
- `aws_ecs_task_definition.main` and `.ops["db-migrate"]` keep being Terraform's, with `track_latest = false` (the
  default, written out: Terraform reads its own revision, not the newest in the family) and `skip_destroy = true` (a
  config change never deregisters a revision a rollback might need). Their revision is the **base**: configuration
  (environment, secrets, health check, roles, logging, the cloudflared pin) as the owner last applied it.
- Terraform publishes each base's ARN as a plain, non-secret SSM `String`, so CI can find it:
  `/satis/deploy/prod/backend-task-definition`, `/satis/deploy/prod/migrate-task-definition`,
  `/satis/deploy/staging/task-definition`. CI always builds its revision from the base Terraform published, not from
  "the newest revision in the family". Anyone allowed `RegisterTaskDefinition` can add a revision to any family, the
  staging role included, so the newest revision is not trustworthy. CI copies the base, replaces the image (and nothing
  else) and registers the copy. Before registering, the production job checks the base: the execution role is the
  expected one, the containers are exactly `backend` and `cloudflared`, and the cloudflared image is the pin in
  `ecs.tf:8`. The image must be `ghcr.io/sour-dev-home/satisfactory-dash-{backend,ops}@sha256:<64 hex>`.
- **Where the current digest lives:** the service's running task definition is the truth. CI also writes
  `/satis/deploy/prod/released`, a JSON `String` of `{ sha, backend, ops, taskDefinition, previous: {...} }`, after each
  good rollout. Terraform creates the parameter with `ignore_changes = [value]`, and SSM keeps its last 100 versions, so
  `aws ssm get-parameter-history` is the release history. `var.backend_image` and `var.ops_image` remain, as the base's
  bootstrap image and the image of `db-init`, `backup` and `restore`. The owner updates them when he wants, not per
  deploy.
- A **configuration** change (Terraform) reaches the running task at the next deploy, or at once through the workflow's
  `redeploy` action (the released digests on the new base, through the approval gate). The runbook's `run_ops` names the
  exact revision ARN from `terraform output` instead of the family, for the reason above.

### D3. Staging: a throwaway task with its own PostgreSQL, its own cluster and its own tunnel
- **No service and no idle cost.** CI starts one task with `ecs:RunTask`, tests it and stops it with `ecs:StopTask`.
  Nothing runs between deploys, so there is no `desired_count` to drift and no "no running task" alarm to trip.
- **One task, four containers**, ordered by ECS container dependencies: `postgres` (`postgres:18`, pinned by digest, from
  the ECR Public mirror of the Docker official image, which avoids Docker Hub pull limits; loopback only), then `db-setup`
  on the ops image (`db:init`, then the **previous** release's `db:migrate`, then this release's; `essential = false`,
  must exit 0), then `backend` (waits for `db-setup` `SUCCESS`), then `cloudflared` (waits for `backend` `HEALTHY`). The
  ops image for the previous step comes from `/satis/deploy/prod/released`. This tests what production will do: new
  migrations on top of the schema production has now. The image workflow's smoke test already covers the from-scratch
  case (`image.yml:116-153`). 0.5 vCPU / 2 GB, ARM64.
- **Isolated from production by construction:**
  - Its own cluster `satis-staging` (clusters are free), so the staging role's task permissions can never touch a
    production task.
  - Its own security group with egress only. The RDS group admits only the production task group
    (`infra/aws/network.tf:85-95`), so a staging task cannot even open a connection to RDS.
  - Its own execution role, `satis-staging-ecs-execution`, which reads only `/satis/staging/*`.
  - Its own values in SSM under `/satis/staging/`: `TUNNEL_TOKEN`, `SESSION_SECRET`, `DASHBOARD_ADMIN_USER`,
    `DASHBOARD_ADMIN_PASSWORD_HASH`, `POSTGRES_PASSWORD`, `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD`, `DATABASE_URL`,
    `MIGRATOR_DATABASE_URL`.
  - Its own log group `/ecs/satis-staging`, kept 3 days.
- **No production data, no game servers, no alerts, no push.** With a database the backend takes its servers only from
  it (`backend/src/server.ts:206-208`). A fresh staging database has none, so no poller starts, and no agent knows the
  staging URL or holds a staging credential. The staging task definition sets `ALERT_DELIVERY=off` explicitly (it is
  also the default, `backend/src/modules/alerts/config.ts:4-17`), sets no VAPID keys (push off,
  `server.ts:265-269`), no Google credentials, no `SERVER_SECRETS_KEY`, `SIGNUP_MODE=closed` and
  `SELF_SERVE_ENABLED=false`. Staging is never restored from a production backup. ADR-0010's single-instance assumption
  is about one data set; staging is a different data set, so production stays the only backend of its data.
- **Hostname and access:** a second Cloudflare tunnel, `satis-staging`, with one rule
  `api-staging.satis-manager.com` -> `http://127.0.0.1:3001` and the catch-all 404 (the production pattern). A Cloudflare
  Access application covers the hostname: the owner's identity, plus one service token that CI sends as headers. Behind
  Access, the app's own sign-in applies, and the only account is the staging admin (the test identity).

### D4. The gate: staging, then the same digests to production
One workflow, `.github/workflows/deploy.yml`. It runs on `workflow_run` of "Backend images" (`completed`, `main`) and on
`workflow_dispatch` (`deploy <sha>`, `redeploy`, `rollback [<sha>]`). `concurrency: deploy`, never cancelling a deploy
in progress. Permissions default to `contents: read`; only the two AWS jobs add `id-token: write`.

1. **resolve** (no AWS): stop unless the image run succeeded. Use `github.event.workflow_run.head_sha`, never
   `github.sha`, which is the newest commit on `main` and not necessarily the one built. Resolve `:<sha>` of both images
   to digests once, check each digest's revision label equals the sha and that `linux/arm64` is present. **Skip** (green,
   with a summary) when no path that goes into the backend images changed since `released.sha`, reusing the backend rule
   of `scripts/ci-select.mjs`. The summary lists any change under `.github/workflows/` or `infra/` since the last
   release, so the owner sees it before approving. From here on, every job uses these two digests and nothing else.
2. **staging** (`environment: staging`, no reviewer): register the staging revision, run it, then check:
   - `GET /api/health` and `/api/health/ready` answer 200 within 5 minutes.
   - The test identity signs in (the password login, `backend/src/modules/identity/routes/auth.ts:46`) and reads the
     session (`auth.ts:101`) and the server list (empty).
   - `db-setup` exited 0. The migration version is proven by the backend starting, since it refuses a schema behind
     its build (`schemaVersion.ts:18-34`).
   - A short Playwright suite runs (D4a).

   The job always stops the task, prints each container's exit code, and on failure prints the staging log tail.
3. **production** (`environment: production`, `needs: staging`): the owner's approval (D5), then the rollout.

**D4a. Playwright against staging.** The session cookie is `SameSite=Lax`
(`backend/src/modules/identity/session.ts:16`), so a frontend served from the runner cannot sign in to
`api-staging.satis-manager.com` directly. The suite builds the frontend, serves it with `vite preview`, and proxies
`/api` to the staging hostname with the Access headers added by the proxy. To the browser it is one origin, and the
browser never sees the token. Three to five specs: sign in, see the empty server list, open the account page, sign
out. A staging frontend at its own hostname is deferred (frontend out of scope).

### D5. Production rollout, rollback and notice
- **Approval:** the GitHub `production` environment, deployment branches `main` only, the owner as required reviewer.
  The default: every production deploy waits for one click. The staging job's summary shows what will ship before he
  approves.
- **Steps:**
  1. Fail fast if `backend-errors` or `backend-critical` is in `ALARM`: ECS ignores deployment alarms that are already in
     `ALARM` when a deployment starts (AWS, "How CloudWatch alarms detect Amazon ECS deployment failures"). `rollback`
     skips this check, since fixing a bad release is its job.
  2. Register the migrate revision, then `RunTask` it, with the network settings from `DescribeServices`. A non-zero
     exit or a task that never starts ends the deploy **before the service is touched**, and the job prints the
     `db-migrate/` log tail.
  3. Register the backend revision and `UpdateService`, then wait for the deployment's `rolloutState` to be `COMPLETED`
     with the new revision running. A circuit-breaker or alarm rollback fails the job.
  4. **Watch the two alarms for 10 minutes.** Their 5-minute periods can outlast ECS's default bake time ("less than 5
     minutes"), so CI watches too. If either goes to `ALARM`, CI rolls back to `released.previous`.
  5. `GET https://api.satis-manager.com/api/health/ready` must answer 200.
  6. Write `/satis/deploy/prod/released`.
- **ECS rollback, the second net:** `aws_ecs_service.main` gets an `alarms { alarm_names = [backend-critical,
  backend-errors], enable = true, rollback = true }` block beside the existing circuit breaker (`ecs.tf:117-120`).
  Either one can fail a deployment and roll back to the last completed one.
- **One-click rollback:** `workflow_dispatch` `rollback`, target `released.previous` by default or any sha with
  published images. It registers the old digests on the current base and updates the service, through the same approval.
  It runs **no migration**: the schema stays ahead, which the older build accepts (`schemaVersion.ts:12-16`).
- **Notice:** one Discord message per production outcome (released, failed before rollout, rolled back) and per failed
  staging run: the sha, the digests (short), a link to the run. It goes to a **separate webhook** kept as a `production`
  environment secret. The alert webhooks live encrypted in the production database (`server.ts:255-260`), out of CI's
  reach, and should stay there.
- Expect the same short outage as today on every rollout and rollback (stop before start, `runbooks/aws.md:118-119`).
  `ecs-no-running-task` (3 minutes without CPU data, `alarms.tf:21-39`) may mail once if a start is slow.

### D6. Migration safety: expand, release, then contract
- Every release's migrations are **expand-only**: the running (old) backend works on the new schema while the migration
  runs before the rollout, and after any rollback. Add tables, columns (nullable or with a default), indexes and enum
  values. Drop `NOT NULL`. Backfill in batches.
- **Contract** steps (drop, rename, retype, `SET NOT NULL`, a new `CHECK` on existing rows) ship in a later release,
  once no rollback target still uses the old shape. Each says so in a `-- contract: <why it is safe now>` line in the
  file.
- A check in the `verify` job (a script under `scripts/`, with its test) fails a PR whose **new** migration has a
  contract statement without that line. The 19 existing migrations pass it unchanged.
- Production's migrate runs as `satis_migrator` on production only. Staging never shares an instance, role or
  credential with it (D3), so the "shared RDS instance" risk does not arise.
- A failed migrate stops the deploy with the service untouched. [NEEDS VERIFICATION] whether node-pg-migrate's runner,
  called with its defaults (`admin.ts:211-219`), runs the pending files as one transaction or one per file. Either way
  the applied part is expand-only, so the old backend keeps running. Record the answer in the runbook.

### D7. Secrets: what CI can and cannot read
- **CI can read:**
  - GitHub `staging` environment: the staging admin password, the Access service token id and secret.
  - GitHub `production` environment: the deploy Discord webhook.
  - AWS: the non-secret `/satis/deploy/*` strings only.
- **CI cannot read** any `/satis/prod/*` or `/satis/staging/*` SecureString, the RDS master secret, the B2 keys or the
  production logs. It never sees a runtime secret: ECS injects them at task start with the execution roles.
- **Accepted residual:** whoever can deploy production can run code that holds production's secrets. That is what a
  deploy is. The controls are:
  - The approval gate.
  - The pinned GHCR repositories and the base check (D2).
  - The OIDC subject bound to `deploy.yml` on `main`.
  - The summary of workflow and infra changes since the last release.

  `RegisterTaskDefinition` takes no resource scope, so either role could add a junk revision to any family. A junk
  revision is never a base (D2), and `run_ops` will name exact ARNs. [NEEDS VERIFICATION] whether IAM offers a
  task-definition family condition; if it does, scope `RegisterTaskDefinition` with it.

### D8. How this fits ADR-0043 and "the owner applies; Claude never mutates AWS"
- The required checks stay `verify`, `e2e` and `security`. The deploy workflow runs after merge and is never a required
  check. Auto-merge is unchanged.
- **The owner applies, once per infrastructure PR:**
  - The Terraform (roles, OIDC provider, staging, SSM names).
  - The SSM values.
  - The Cloudflare tunnel and Access application.
  - The GitHub environments, their reviewers and secrets.
  - The OIDC subject template.
- **CI deploys images**: staging automatically after a merge, production only after the owner approves. CI's AWS
  identity is the deploy role, never the owner's.
- **Claude sessions** still hold no AWS credentials, never run AWS-mutating commands, and **never approve a deployment**.
  The `production` reviewer is the owner. Sessions use his GitHub token, so GitHub cannot tell an approval through the
  `pending_deployments` API from his own click. The rule goes into `CLAUDE.md` as a hard line. A merge by a session
  starts a staging run, which is CI acting within the staging role and touching nothing of production.

## Cost (prices from ADR-0034 Context, `0034-backend-on-aws.md:17-20`, us-east-1)
- **Staging run:** 0.5 vCPU x $0.03238 + 2 GB x $0.00356 + public IPv4 $0.005, about **$0.028 an hour**. About 10
  minutes per run, about **$0.005 a run**.
- **Production migrate task:** 0.25 vCPU / 0.5 GB plus the IPv4, about $0.015 an hour. Fargate bills at least one
  minute, so about **$0.0005 a run**.
- **Free:**
  - A second cluster, the IAM OIDC provider and roles, SSM Standard parameters.
  - CloudWatch: no new alarm (still 6 of the 10 free), `DescribeAlarms` calls inside the free API requests, and staging
    logs of kilobytes against the 5 GB free ingest.
  - Cloudflare: a second tunnel and Access (free for up to 50 users).
  - GitHub Actions minutes on a public repository.
- **No change:** the RDS instance, since staging does not use it.
- **Total:** at 60 deploys a month, **under $0.50 a month** against the $40 budget alarm (`variables.tf:58-67`) and the
  credits. Within the Free-plan, credits-only rule (ADR-0034 Context, `:11-14`). [NEEDS VERIFICATION] at the first
  apply that the Free plan accepts an IAM OIDC provider (IAM itself is not a priced service).

## Build tasks (each one PR from `main`, merged before the next starts; no stacked PRs)
1. **Migration contract check** (`scripts/`, `verify`): D6's check and its test. *Owner applies:* nothing.
2. **Production deploy infrastructure** (`infra/aws/`, its tests, `runbooks/aws.md`):
   - The OIDC provider and `satis-prod-deploy` (D1).
   - The `/satis/deploy/prod/*` parameters.
   - `ignore_changes`, `skip_destroy` and `track_latest`, and the service's `alarms` block (D2, D5).
   - `run_ops` by exact ARN.
   - An interim "Deploy" section: until PR 3 merges, `aws ecs update-service --task-definition <base ARN>` after the
     usual targeted apply.

   *Owner applies:* `terraform plan` (expect: the new IAM and SSM resources, the service in place for `alarms`; no
   task-definition replacement), apply. Then on GitHub:
   - The `production` environment (owner as reviewer, `main` only), with variable `AWS_DEPLOY_ROLE_ARN`.
   - The OIDC subject template.
3. **Production deploy workflow** (`.github/workflows/deploy.yml`, `scripts/deploy/`), `workflow_dispatch` only: resolve,
   production, rollback, redeploy, the alarm watch and the Discord notice (D4 steps 1 and 3, D5). Actions pinned by SHA,
   as in `image.yml`. *Owner applies:* secret `DEPLOY_DISCORD_WEBHOOK`. First run: `deploy` of the sha production runs
   now (a no-op release that writes `released`), then one real deploy, then one `rollback`. After that, the tfvars
   digest flow is retired in the runbook.
4. **Staging infrastructure** (`infra/aws/`): D3's cluster, security group, execution role, log group, base task
   definition, `/satis/staging/*` names, `satis-staging-deploy` and `/satis/deploy/staging/task-definition`. *Owner
   applies:*
   - Create the `satis-staging` tunnel (its token in `/satis/staging/TUNNEL_TOKEN`) and the Access application with
     its service token.
   - Put the other `/satis/staging/*` values.
   - Apply.
5. **Staging gate** (`deploy.yml`, `scripts/deploy/`): the staging job and its smoke checks, the `workflow_run`
   trigger, and `production` needing `staging`. *Owner applies:* the `staging` environment (`main` only, no reviewer),
   with secrets `STAGING_ADMIN_PASSWORD`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` and variable
   `AWS_STAGING_ROLE_ARN`. From here every merge that changes the backend images deploys to staging, then waits for him.
6. **Playwright against staging** (`frontend/e2e/staging/`, a `staging` project in `frontend/playwright.config.ts`, a
   step in the staging job): D4a. *Owner applies:* nothing.

Run `security-reviewer` on PRs 2 to 5 (IAM, secrets, CI credentials), as the repository's workflow asks.

## Consequences
- **A backend deploy becomes:** merge, wait for the staging run, click Approve. Rollback is one dispatch and one click.
  `terraform apply` stops being a deploy step, and `terraform.tfvars` stops changing per release.
- **The portfolio shows** OIDC federation with no stored keys, least-privilege deploy roles, an approval-gated
  promotion of immutable digests, alarm-based automatic rollback and expand/contract migrations.
- **Backend lags frontend.** The frontend still deploys on every merge (Cloudflare), while the backend waits for the
  owner's approval. A frontend change that needs a new backend field can reach users before the backend. ADR-0007's
  additive contracts already require the frontend to tolerate an older backend. Keep it so, or hold such a frontend
  change until the release is approved.
- **The previous ops image for `db-init`, `backup` and `restore`** stays on `var.ops_image`. A backup-script change
  reaches the nightly backup only when the owner bumps it (the schedule pins Terraform's revision, `schedule.tf:22`).
- **A configuration change waits** for the next deploy or a `redeploy`. The service no longer follows Terraform's
  revision.
- **More moving parts:** two GitHub environments, a second tunnel, an Access application, four SSM strings and two
  roles to keep. `providers.tf:2-3`'s comment ("One environment only") changes in PR 4.

## Explicitly deferred
- **A second database or RDS instance for staging.** Not now: the role collision above. Trigger: a need to test
  migrations against production-sized data. Cheapest step now: none; a restore drill on the compose stack
  (ADR-0034 §6) covers it.
- **A long-running staging service or a staging frontend.** Trigger: manual QA on staging between deploys. The
  throwaway task can become a service at desired 0 later without changing the contract.
- **Blue/green or more than one task.** ADR-0010's single instance holds (`ecs.tf:111-115`). Trigger: the outage
  window during a rollout becomes a user complaint. That needs the poller split first.
- **An automatic production deploy without approval.** Trigger: the owner's choice after some clean releases. The
  environment's reviewer rule is the only switch, and the rest stays.
- **OpenTelemetry deploy markers, ECR, CodeDeploy.** Not needed for one service.

## Revisit when
- The owner removes the approval gate, or a second contributor joins (consider requiring reviews on `deploy.yml` and
  `infra/` again).
- A migration needs a contract step. Review D6 against the real case.
- The exit from AWS starts (ADR-0034 §4). The deploy workflow's production job is then rewritten for the exit host, and
  staging for whatever runs there.
- IAM gains a family condition for `RegisterTaskDefinition`. Narrow D1.

## Questions for the owner
1. **Approval gate or automatic production?** Proposed default: every production deploy waits for your click; staging
   runs automatically after each merge. Alternative: production goes automatically once staging passes, with Discord as
   the only signal. Also: do staging runs started by a session's merge suit you, or should staging also wait for a
   click?
2. **Staging hostname:** `api-staging.satis-manager.com` (proposed, which leaves `staging.satis-manager.com` free for a
   staging frontend later) or `staging.satis-manager.com`?
3. **Cloudflare Access on the staging hostname:** yes (proposed: free, keeps an unreleased build off the open
   internet), or app sign-in only?
4. **Discord:** a new webhook for deploy notices (proposed; the alert webhooks stay encrypted in the database), and
   which channel?
5. **Staging in a throwaway PostgreSQL inside its task, not a second database in the RDS instance** (D3, because
   PostgreSQL roles are per instance and ours are fixed names). Agree?
6. **A rule for `CLAUDE.md`:** sessions never approve or reject a pending deployment, even though they use your GitHub
   token. Agree?
7. **Skip when nothing in the backend changed** (D4 step 1): agree, or deploy every image build?
