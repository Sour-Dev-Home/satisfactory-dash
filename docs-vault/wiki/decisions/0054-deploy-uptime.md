# ADR-0054: Deploy uptime without extra cost

Status: **Accepted** (2026-10-24): the owner approved it ("approve the adr-0054"), taking the questions at the end as
recommended: D1 to D3 in the build order below, D4 built now, and the minute of looser rate limits and late command
wake-ups per deploy accepted. Amends ADR-0049 D5 ("expect the same
short outage on every rollout") and the single-instance note in `infra/aws/ecs.tf:116-120` that cites ADR-0010.

The owner's requirement (2026-10-24): "Ideally we have decent uptime (though if that incurs more cost not worth it).
How to prevent in future?" Cost comes first: nothing here may add a recurring cost beyond cents.

## Context

On 2026-10-24 four automatic deploys ran in about 45 minutes (runs 40147013885, 40147786311, 40147997795,
40149816135). Each production rollout costs about a minute of Cloudflare error 1033 (no tunnel connector), and one
failed at staging.

- **Rollouts stop before they start.** `deployment_minimum_healthy_percent = 0`, `deployment_maximum_percent = 100`
  (`infra/aws/ecs.tf:119-120`): the old task is stopped before the new one exists, so the tunnel has no connector
  until the new task's backend is healthy and its cloudflared connects (`ecs.tf:90`).
- **Every push to main deploys.** "Backend images" path-filters pull requests only; a push to main always builds and
  publishes `:<sha>` (`.github/workflows/image.yml:23-24,155-196`). Each image carries
  `org.opencontainers.image.revision=<sha>` (`image.yml:199`), so its digest is new on every commit. The automatic
  run's only skip compares digests with the release record (`scripts/deploy/deploy.mjs:325-330`), which therefore
  never matches. A docs-only merge (#634, an ADR) shipped a release.
- **The failed staging run was not a publish race.** Run 40147013885's resolve job inspected
  `satisfactory-dash-ops@sha256:10e11ed4…` successfully at 00:40:48 UTC; the image run that published it had finished
  before the deploy was queued (00:31:13). At about 00:42 Fargate stopped the staging task with
  `CannotPullContainerError: ref pull has been retried 1 time(s): failed to resolve reference` for that digest. The
  same digest resolves anonymously from ghcr.io today (HTTP 200). So it was a transient registry or network failure on
  Fargate's anonymous pull; the cause on ghcr's side is `[NEEDS VERIFICATION]`. The staging job has no retry: a task
  that stops before it answers fails the run (`deploy.mjs:359-360`). In production the same failure with 0%/100% would
  leave no task running until the circuit breaker rolls back (`ecs.tf:122-125`).
- **What is per-instance today** (relevant to two tasks overlapping):
  - Process workers and database workers start together and stop on SIGTERM (`backend/src/server.ts:241-300,580-609`):
    session purge, history maintenance, metrics flush, agent-command sweeper, pending-server sweeper, alert evaluator,
    alert delivery.
  - The agent snapshot store is in memory; ADR-0052 adds one row per server in `telemetry.latest_snapshots`, loaded on
    startup and flushed on stop (ADR-0052 2.3, 2.4).
  - Login and signup rate limits are in-memory maps (`modules/identity/loginRateLimiter.ts:46-53`,
    `signupNetworkLimit.ts:33`). A restart already resets them on every deploy.
  - The agent-command wake-up is in process (`modules/agents/services/commandNotifier.ts:1-4`); the agent long-polls
    for at most 25 s (`modules/agents/routes/agentApi.ts:228`).
  - Writes that are already safe with two writers: metrics deltas are additive (`platform/metrics/seriesHourlyRepository.ts:8-14`),
    history samples are `ON CONFLICT DO NOTHING` (`modules/telemetry/repositories/historyRepository.ts:71-79`).
  - Sessions are in Postgres (ADR-0025 decision 4); the in-memory denylist is only the no-database mode
    (`modules/identity/sessionDenylist.ts:5-10`).
- **Cloudflare with two connectors:** replicas of one tunnel get no traffic steering; a request goes to the
  geographically closest replica, and if it cannot be reached Cloudflare tries the others ("Tunnel availability",
  developers.cloudflare.com). Both tasks are in us-east-1, so which one serves a request during the overlap is not
  defined.

## Decision

### D1. Skip a deploy whose build inputs production already runs

Not a path filter. A path filter on the push run has a hole: GitHub keeps one pending run per concurrency group
(`deploy.mjs:458-461`), so a docs push can replace the pending run of an earlier backend push, and a filtered run would
then publish nothing for that backend change; the automatic deploy would walk back to the older release.

Instead, every push still builds and publishes (GitHub Actions minutes are free on this public repository). Each image
gets one more label, `dev.satis-manager.inputs=<hash>`: the SHA-256 of the git tree ids of exactly the build's inputs,
`backend`, `packages/shared`, `packages/game-adapter`, `package.json`, `package-lock.json` and `.dockerignore`
(`backend/Dockerfile` and `backend/migrations` sit inside `backend`). The release record gains `inputs`. The automatic
run skips staging and production when the target's `inputs` equals `released.inputs`, with a green "nothing
deployable changed" summary.

It cannot skip a real change:
- the hash covers the whole build context the Dockerfile copies, so a change to shared packages, the lockfile, the
  Dockerfile or a migration changes it;
- a test parses every `COPY` source in `backend/Dockerfile` (except `--from`) and fails if one is outside the input
  list, so a new `COPY` cannot slip past;
- a record without `inputs` (every release before this) never matches, so the first run after this ships;
- dispatched `deploy`, `redeploy` and `rollback` never skip (as today, `deploy.mjs:325-327`). A Terraform base
  change (cloudflared pin, environment, secrets) still goes through the owner's `redeploy`, as in ADR-0049 D2.

### D2. Retry a pull failure once, and let the overlap absorb it in production

- **Staging:** when the task stops before answering and its `stoppedReason` matches `CannotPullContainerError`, the job
  logs it, waits 30 s and starts the task once more. Any other stop, or a second pull failure, fails as today. Cost: one
  more staging run, about $0.005, only when it happens (ADR-0049 Cost).
- **Production:** with D3 the old task keeps serving while ECS retries the new task's launch; the circuit breaker still
  rolls back if it never starts. No change in the workflow.
- Not adopted: an ECR pull-through cache for ghcr.io. It needs a Secrets Manager secret for the upstream credentials
  (about $0.40 a month) and IAM work, for one transient failure. Trigger: a second pull failure within a month.

### D3. Overlap rollout (100% / 200%) with an advisory-lock leader (#600)

1. **Rollout.** `deployment_minimum_healthy_percent = 100`, `deployment_maximum_percent = 200`, `desired_count = 1`
   unchanged. ECS starts the new task, waits for it to be healthy (the backend container's health check, `ecs.tf:68-74`;
   cloudflared connects only after it, `ecs.tf:90`), then stops the old one. The circuit breaker and the alarm rollback
   stay (`ecs.tf:122-134`). The same applies to `redeploy` and `rollback`.
2. **Leader.** A new `platform/db/leaderLock.ts`: one dedicated `pg` client (not from the pool, whose connections
   rotate) tries `pg_try_advisory_lock(<fixed key>)` every 5 s. The lock is session-scoped, so it is released when the
   holder's connection closes: on SIGTERM the old task stops its workers, closes the client, and the new task takes
   over within 5 s. The leader also runs `SELECT 1` on that client each tick; a failure stops the leader-only workers at
   once (no leader is better than two). Without a database (local mode), the process is always leader.
3. **Which workers run where.**

   | Runs on | Workers | Why |
   |---|---|---|
   | Leader only | session purge, history maintenance, agent-command sweeper, pending-server sweeper, alert evaluator, alert delivery, request-through pollers | timer-driven, global; two copies would double alerts, Discord sends and game-server reads |
   | Every instance | metrics flush, history recording from agent ingest, ADR-0052's `LatestSnapshotWriter`, event-loop monitor | each holds only its own in-memory data; the writes are additive, `DO NOTHING`, or guarded (below) |

4. **Alert evaluator after a handover.** The board's clock starts when the evaluator starts, so an agent is not
   `agent_offline` before `offlineSeconds` (default 120 s, `packages/shared/src/agent.ts:194`) of silence measured from
   then (`modules/alerts/services/serverAlertEvaluator.ts:235-238`). Starting the evaluator on lock acquisition, not at
   boot, gives the new leader the same grace a restart has today. During the overlap the old leader may miss some agent
   reports that land on the new task; the overlap is about a minute and the agent reports every few seconds, so a false
   `agent_offline` (120 s of silence on one instance) is not expected. Revisit if one is ever recorded during a deploy.
5. **Agent snapshot store and ADR-0052's row.** Each task keeps its own in-memory store, fed by whichever agent reports
   reach it. The new task loads the row at startup (up to 5 minutes old) and serves it `stale: true` until its first
   fresh report; the old task flushes its row on SIGTERM, after the new task loaded. Two writers need one guard: the
   upsert only replaces a row with an older `last_received_at`
   (`ON CONFLICT (server_id) DO UPDATE ... WHERE telemetry.latest_snapshots.last_received_at <= excluded.last_received_at`),
   so the old task's final flush can never overwrite newer data written by the new task. During the overlap a viewer
   may see a panel flip between fresh and "last known data" for under a minute; accepted. Player names stay memory-only
   (ADR-0052 2.2).
6. **Rate limits.** Stay per instance. During the overlap a client could get twice the budget for about a minute,
   which is weaker than today's full reset on every restart. Accepted; Postgres-backed limits are the trigger below.
7. **Agent commands.** A command created on one task does not wake a long-poll held by the other; the agent gets it at
   its next poll, at most 25 s later, during the overlap only. Accepted. LISTEN/NOTIFY is the change in
   `commandNotifier.ts` when two instances run all the time.
8. **Database connections.** Two tasks plus two lock clients plus the migrate task at most; check `SHOW max_connections`
   on the db.t4g.micro once before applying `[NEEDS VERIFICATION]`. `DATABASE_POOL_MAX` defaults to 10
   (`platform/db/config.ts:49`).
9. **Order.** The leader lock ships and is deployed **before** the Terraform change. With the overlap but no lock, two
   alert evaluators would send duplicate Discord and push alerts.
10. **Server list after a handover** (amendment, owner 2026-10-26: "Reload on leadership"). Each task's server runtime
    (`backend/src/modules/servers/serverRuntime.ts`) is loaded from the database once at startup and then changes only
    through that task's own writes. A server write served by the old task during the overlap (add, remove, rename,
    connection edit, a switch to or from an agent) would be missing from the new task until its next restart, not for
    a minute. So a task that takes the lock first reconciles its runtime with the database
    (`reconcileDatabaseServers`), changing only what differs: an unchanged server keeps its pollers and an agent server
    its in-memory snapshots. Polled entries carry a digest of their connection (`connectionSource`) to tell an edit
    from an unchanged server. A failed reload is logged and leadership goes ahead. Ships and deploys before PR 3.

### D4. Frontend: say "updating" during any gap left (optional)

A gap can still happen (a crash, a failed rollout, an apply). Cloudflare answers HTTP 530 with an HTML page (1033)
when no connector is up, and 502/503/504 at other edges. The frontend treats a non-envelope 502, 503, 504 or 530 from
the API as "The dashboard is updating, back in a moment", keeps the last data with the existing "Showing last known
data" line, and retries with backoff (about 5, 10, 20 s, capped at 30 s). Owner: the frontend session, with design
tokens and the existing ease-in-out transition. It does not change the contract.

## Cost

| | Recurring cost | Notes |
|---|---|---|
| D1 skip | $0, saves a staging run (about $0.005) and a minute of outage per skipped merge | one label, one record field |
| D2 retry | about $0.005 per pull failure | none in a normal month |
| D3 overlap | about $0.001 per deploy, under $0.10 a month at 60 deploys | 0.5 vCPU / 1 GB ARM task plus its IPv4, $0.0248 an hour (ADR-0049 Cost prices), for about 1 to 3 minutes |
| D4 frontend | $0 | |

All of it is paid from the Free-plan credits; no paid upgrade, no load balancer, no new service.

## The full option (considered, not adopted)

What makes an interruption nothing, at production scale:

- **Topology.** An Application Load Balancer across two AZs (the VPC already has subnets per
  `var.availability_zones`, `infra/aws/network.tf:19-23`), at least two always-on tasks spread over both AZs, RDS
  Multi-AZ. cloudflared moves out of the task into its own small service, pointing at the ALB (or the ALB is public
  behind Cloudflare's proxy with an origin lock).
- **Health and draining.** ALB target-group health checks on `/api/health/ready`, a deregistration delay (30 s) so
  in-flight requests finish, the backend's graceful shutdown as today.
- **Rollout.** ECS built-in canary or linear deployments (October 2025; they need an ALB, NLB, Service Connect or VPC
  Lattice): for example 10% of traffic to the new revision, bake 5 minutes, then 100% (or linear steps), with
  `backend-critical`, `backend-errors`, target 5xx and p95 latency alarms as automatic rollback, and a lifecycle hook
  that runs the staging smoke checks against the test listener before traffic shifts.
- **Stateless backend, required first:** the snapshot store reads and writes through Postgres (ADR-0052's row written
  on every report, or a short interval) so any task serves current data; rate limits move to a Postgres table (no
  ElastiCache, which adds about $10 a month or more); background jobs keep the advisory-lock leader from D3;
  `CommandNotifier` uses LISTEN/NOTIFY.
- **Workflow:** build and publish, staging as today, approve, migrate (expand-only, D6 of ADR-0049), `UpdateService`
  with the canary strategy, ECS shifts 10% and watches the alarms, shifts 100%, bake, the old revision drains and stops,
  record the release; any alarm during the shift or bake returns traffic to the old revision without a redeploy.

| | Chosen (D1-D3) | Full option |
|---|---|---|
| Downtime per deploy | about 0 s expected (Cloudflare reroutes to the remaining connector), to be measured | 0 s |
| Survives a task or AZ failure | no (one task; ECS replaces it in about a minute) | yes |
| Extra monthly cost | under $0.10 | about $55: ALB about $16.40 plus LCUs, its two public IPv4s about $7.30, a second always-on task about $18, RDS Multi-AZ about $14 `[NEEDS VERIFICATION]` against the AWS price pages |
| Complexity | one lock module, a worker split, two Terraform numbers | ALB, target groups, listeners, a separate cloudflared service, Multi-AZ, a stateless refactor of three stores, deployment hooks |

The full option is over the $40 budget alarm (ADR-0049 Cost) and would spend the Free-plan credits about twice as
fast, on an AWS setup ADR-0051 already plans to leave. A middle step exists: two always-on tasks as tunnel replicas
with no ALB (about $18 a month, survives a task failure, no traffic shaping), once the stateless items are done.

**Trigger for the full option:** paying users or a stated uptime target of 99.9% or better (about 43 minutes of
downtime a month), or load that needs more than one task (sustained CPU over 70% on one task). Not the current
one-owner, credits-funded dashboard.

## Build plan (each PR from `main`, merged before the next; no stacked PRs)

1. **Deploy skip and pull retry** (`.github/workflows/image.yml`, `scripts/deploy/deploy.mjs`, `lib.mjs`, new
   `scripts/deploy/inputs.mjs`). Tests: `deploy.test.mjs` (equal inputs skip; a record without `inputs` deploys;
   different inputs deploy; a dispatched deploy never skips; every `COPY` source in `backend/Dockerfile` is covered),
   `staging.test.mjs` (a pull failure retries once and passes; two fail; any other stop does not retry).
2. **Leader lock and worker split** (`backend/src/platform/db/leaderLock.ts`, `backend/src/server.ts`; the
   `latest_snapshots` upsert guard in the telemetry repository, or inside ADR-0052 PR 2 if that has not merged).
   Tests against the test Postgres: two locks, one leader; closing the holder hands over within one interval; a broken
   lock connection stops the leader-only workers; the evaluator's board starts at acquisition; an older
   `last_received_at` does not overwrite the row. Deployed to production before PR 3.
2b. **Server reload on leadership** (D3.10, added 2026-10-26): `reconcileDatabaseServers` in
   `modules/servers/loadDatabaseServers.ts`, run from the leader lock's `onAcquired`. Deployed to production before PR 3.
3. **Overlap rollout** (`infra/aws/ecs.tf:116-120` and its comment, a check in `infra/aws/tests/ecs.tftest.hcl`,
   `docs-vault/wiki/runbooks/aws.md` "Deploy", ADR-0049 D5's outage line). The owner applies Terraform; the next
   deploy is checked against the uptime monitor (ADR-0028) for no down event.
4. **Optional, frontend:** the "updating" notice and retry (D4), with a test for each status and the backoff.

## Consequences

- Merges that change nothing in the backend build no longer deploy or cost an outage.
- A normal deploy should no longer drop the tunnel; the first runs after PR 3 confirm it.
- The backend gains a leader concept, the first step to more than one instance. The leader-only list must be kept
  current: a new timer-driven worker has to choose a row in D3.3.
- Rate limits and the command wake-up are looser for about a minute per deploy.

## Revisit when

- A deploy after PR 3 still shows a down event: measure where the gap is (task health, cloudflared registration).
- A second ghcr pull failure within a month (ECR pull-through cache, D2).
- A false `agent_offline` or duplicate alert is recorded during a deploy (D3.4, D3.9).
- Any trigger of the full option above.
