# ADR-0034: Backend and database on AWS, time-boxed, with a rehearsed exit

Status: accepted (owner, 2026-09-26: option A on the Free plan's credits, the portability
requirements, the exit trigger, and Oracle Cloud Always Free as the named exit target)

## Context
- Today the backend and PostgreSQL 18 run on the game PC. The API is published through a Cloudflare
  Tunnel at `api.satis-manager.com` (ADR-0013), and the backend polls the game's HTTPS API and FRM
  over loopback (FRM is plain HTTP; the API token is admin-level).
- The owner will not publish Google sign-in (gate B) until the backend runs on AWS (2026-09-26).
- The AWS account is on the **Free plan**: $139.89 in credits, and the plan ends 2027-03-15 or when
  the credits run out, whichever comes first. **The account then closes, with everything in it.**
  The owner will not upgrade to the Paid plan. A few months on AWS are enough for the portfolio
  goal, as long as the service can move off AWS later.
- ADR-0020 and ADR-0031 give the shape that makes this safe: the edge agent on the game PC pushes
  outbound, so the backend's location is a routing detail.
- Prices (checked 2026-09-26 with the AWS Price List API, us-east-1): RDS db.t4g.micro $0.016/h, RDS
  gp3 $0.115/GB-month, public IPv4 $0.005/h, EBS gp3 $0.08/GB-month, EC2 t4g.micro $0.0084/h and
  t4g.small $0.0168/h. Fargate ARM uses the published $0.03238 per vCPU-hour and $0.00356 per
  GB-hour.

## Decision
### 1. The game PC connects out, never in: the edge agent (ADR-0031) comes first
Unchanged. The backend never polls the game PC from AWS. The agent pushes to
`api.satis-manager.com`, is built and proven while the backend is still on the PC, and never notices
where the backend runs.

### 2. On AWS: ECS Fargate (ARM) with a cloudflared sidecar, and RDS for PostgreSQL
- One task (0.5 vCPU, 1 GB): the backend container plus `cloudflared` for the tunnel. No load
  balancer, no NAT gateway, no inbound rules (public subnets, outbound only).
- RDS PostgreSQL 18, db.t4g.micro, single-AZ, 20 GB gp3, private. RDS automated backups (7 days)
  cover fast restores while on AWS.
- The ECS task role injects secrets from SSM Parameter Store (`/satis/prod/*`) as environment
  variables. No access key exists. CloudWatch Logs keeps 14 days.
- About **$33 a month**, so the credits last roughly four months.

### 3. Portability is a hard requirement (the exit must be boring)
- **The app path uses no AWS-only features.** Configuration comes only from environment variables
  (ECS injects them; elsewhere a file or systemd does). Logs go to stdout as JSON. There's no AWS SDK
  in the backend: backups leave AWS entirely (ADR-0035).
- **One image, multi-architecture** (linux/arm64 and linux/amd64) from GitHub Actions. The same image
  runs on Fargate, on any VM, or on the PC.
- **A `compose.yaml` in the repo** runs the whole stack on one machine: the backend, PostgreSQL 18 and
  cloudflared, plus the backup job as a scheduled container command. It's the exit target's
  deployment, and it's tested in CI (it boots and passes readiness).
- **Plain PostgreSQL**: no RDS-only extensions. The data moves with `pg_dump` and `pg_restore`, the
  same path as the backup restore rehearsal.
- **Ingress is portable**: moving hosts means starting cloudflared on the new host and switching the
  tunnel route. The agent, the frontend and the DNS name don't change.
- Terraform stays in `infra/aws/`. The exit host's Terraform is written at exit time, not before.

### 4. Credit tracking and the exit trigger
- Monthly, the owner or coordinator runs `aws freetier get-account-plan-state` and records
  `accountPlanRemainingCredits` and the plan status. Plus an AWS budget alert, if the Free plan
  allows one without upgrading [verify when building].
- **The exit starts when about one month of credits remains (about $35), or 45 days before
  2027-03-15, whichever comes first.** It must finish before the credits reach zero.

### 5. The exit target: Oracle Cloud Always Free (a named fallback, not built now)
- Always Free Ampere A1 (checked 2026-09-26): 2 OCPUs and 12 GB of memory in total, 200 GB of block
  storage, home region only, on a free tenancy. An arm64 host, so the same image runs there.
- Risk: Oracle reclaims an Always Free instance when, over 7 days, CPU (p95), network and memory are
  all under 20%. Mitigation: size the instance so this workload's memory stays above 20% (e.g. 1 OCPU
  / 2–4 GB), and check it in the first week.
- Alternatives if Oracle doesn't work out: any small VPS, or back to the game PC. The compose stack
  runs on each.

### 6. The exit runbook, rehearsed before it's needed
1. Rehearse once while on AWS: start the compose stack elsewhere (the PC is enough), restore the
   latest dump, run it on a staging tunnel hostname, and have an agent post to it.
2. Exit: a short window. Take a final pg_dump from RDS, restore it on the new host, start the stack,
   switch the tunnel route for `api.satis-manager.com`, check readiness and agent posts, then scale
   the ECS service to 0.
3. Rollback: switch the route back while the AWS account still exists.
4. After a quiet week: `terraform destroy`, and export anything worth keeping before the account
   closes.

### 7. Cutover to AWS and gate B
- The move itself follows the same steps as the exit (rehearse on staging, a short window, a route
  switch, rollback by switching back) and retires the PC backend after two quiet weeks.
- Gate B after the move: the Google credentials go to SSM, and the callback URL is unchanged (same
  hostname). The privacy page's hosting row changes in the cutover PR, and again at the exit.

## Consequences
- The site runs on AWS for about four months, then moves to a free host with the same image,
  database dump and tunnel. The portfolio shows ECS, RDS, IAM task roles, Terraform and a rehearsed
  migration.
- The compose stack adds a second deployment to keep working (CI boots it).
- If the exit slips past the credits, the AWS account closes. The data survives in the off-AWS
  backups (ADR-0035), not in RDS.

## Revisit when
- The monthly credit check shows the exit trigger.
- The owner changes his mind about the Paid plan.
