# ADR-0037: System metrics and a load-testing kit

Status: accepted (owner, 2026-09-27) for card #331: D1 k6; D2 one load run on the AWS stack before
cut-over, on a separate `satis_load` database dropped afterwards, never after cut-over; D3 no Web
Vitals from real users for now; D4 load reports are committed to `docs-vault/wiki/perf/`. This ADR
amends ADR-0036 step 3 before that step is built.

## Context
- **Scope of "analytics".** The card asks for *system* analytics (latency, lag, throughput), not
  tracking of people. The privacy page promises no analytics about users, and this ADR keeps that
  promise. Frontend Web Vitals from real browsers are the one exception to decide (D3).
- **What exists today.**
  - Each request's time is logged, split into app and upstream time (ADR-0032,
    `platform/requestTiming.ts`), and `npm run latency-report` reads those logs.
  - ADR-0036 (accepted, not built) plans an hourly Postgres histogram of request latency and an
    operator-only `GET /api/admin/metrics`.
  - The frontend polls. There is no WebSocket or SSE in `backend/src` or `frontend/src`, so there
    is no push fan-out to measure (ADR-0005). That measure is dropped until push exists.
  - Every repository query already carries a static name, e.g. `"servers.lockServerByPublicId"`,
    which is the `context` argument of `parseRows`, `parseOne` and `parseFirst` in
    `platform/db/rows.ts`. That gives a bounded label set (about 47 call sites) for timing queries.
- **ADR-0034 limits.**
  - No AWS SDK and no AWS-only features in the app path. Logs go to stdout.
  - CloudWatch Logs keeps 14 days.
  - About $33 a month on credits, and the exit target is Oracle Always Free.
  - Because of these, CloudWatch custom metrics, EMF and X-Ray are out.
- **Load targets that aren't production.**
  - `compose.yaml` is planned (ADR-0034 §3) but not in the repo yet. The local stack is the
    backend plus a Docker Postgres.
  - The production database must never hold synthetic data.

## Decision

### 1. What to measure: one metric registry, fixed names, bounded labels
Keep a registry in code (`backend/src/platform/metrics/`). A metric that isn't in the registry
can't be recorded, and every label value comes from a closed set. Names follow the OpenTelemetry
semantic conventions where one exists, so a later exporter is only a mapping (see §4).

| Metric | Kind | Labels | Source |
|---|---|---|---|
| `http.server.request.duration` | histogram (ms) | route pattern, status class | the existing request timer |
| `http.server.upstream.duration` | histogram | api (vanilla/frm) | the ADR-0032 split |
| `db.client.operation.duration` | histogram | query name (the static `context`) | a timing wrapper at the query call |
| `satis.poller.cycle.duration` | histogram | server public id, endpoint group | the pollers |
| `satis.poller.lag` | histogram | server, group | time from the planned tick to the stored snapshot |
| `satis.agent.ingest.lag` | histogram | server | received-at minus the agent's `observedAt`: "apparent" lag, because clock skew is included, so clamp it at ≥0 and document it |
| `satis.history.rows_written` | counter | table | history writes |
| `satis.alerts.evaluation.duration` | histogram | none | the alert engine |
| `satis.alerts.fire.lag` | histogram | kind | the event time minus the triggering sample time |

Server ids are a bounded label here: operator-managed, with a small cap (MAX_LOCAL_SERVERS plus
agents). If the server count ever exceeds about 50, drop the server label from the poller metrics.

### 2. Where it lives: Postgres, one table (this amends ADR-0036 step 3)
- ADR-0036's `metrics.route_latency_hourly` is replaced by one general table:
  `metrics.series_hourly(hour, metric, labels jsonb, count, sum, bucket_counts int[])`, with a
  unique key on `(hour, metric, labels)`.
  - Histograms use fixed millisecond buckets (1, 2, 5, 10, 20, 50, 100, 200, 500, 1k, 2k, 5k, +inf).
  - Counters use `count` and `sum` only.
- In-process aggregation flushes every 60 s with `INSERT … ON CONFLICT DO UPDATE`, adding the
  counts and the bucket arrays element-wise.
- Retention is 90 days, purged in the existing retention job.
- Size: about 150 series × 24 h × 90 days ≈ 320k small rows, a few tens of MB. That's trivial on
  the 20 GB RDS volume, and no partitioning is needed.
- It works the same on the PC, on Fargate and on Oracle. It uses no AWS feature, and it's
  resume-legible SQL: a percentile query over summed buckets.
- `GET /api/admin/metrics` (ADR-0036) serves it. The metrics page (#281) gains a "System" section:
  p50/p95/p99 per metric and label, over 1 h, 24 h and 7 days.

### 3. The load kit: k6 scenarios plus a seed script, never against production (D1, D2)
- **Tool: k6** (D1, recommended).
  - It's mainstream and recognizable on a resume.
  - Scenarios are JavaScript files.
  - It has built-in thresholds (pass/fail) and exports a JSON summary.
  - CI installs it with the Grafana setup action, pinned to a SHA. Verify the version when
    building.
  - The alternative is a plain Node script: no new binary, but home-grown percentiles and ramping.
- **Synthetic identities, created by the real code paths.** `backend/scripts/load-seed.ts` creates
  N servers, then for each one an enrolment code, consumed through the real enrol API (so the load
  run exercises enrolment too), plus M users with sessions. It writes the credentials to a
  git-ignored file that the k6 scripts read.
  - **There is no rate-limit bypass and no test-only flag in production code.** Load grows by
    adding identities, each running at the real cadence: agents push every 5 s (status/power) and
    every 30 s (factory), and users poll as the frontend does. That's realistic, and it keeps the
    limiters honest.
- **Guards (the seed and the k6 scripts both enforce them).**
  - The seed refuses unless the database name ends in `_load` (production's is `satis`) and
    `LOAD_TEST=1` is set.
  - k6 refuses any target except `127.0.0.1`, `localhost` or the compose service name, unless
    `TARGET=aws-precutover` is set explicitly (D2).
  - The payloads are the shared fixtures (`packages/shared/fixtures`), so there's no production
    data anywhere.
- **Scenarios.**
  - (a) *Baseline*: 1 agent and 3 users for 10 min.
  - (b) *Target*: 10 agents and 30 users for 30 min, a plausible group of friends.
  - (c) *Knee*: ramp agents until ingest p95 exceeds 1 s or errors exceed 1%. It reports where
    that happens.
  - The thresholds are report-only until the ADR-0032 API targets are set from the
    latency-report baseline. After that they become pass/fail.
- **Results as portfolio evidence** (D4).
  - `scripts/load-report.mjs` turns the k6 summary plus the server-side `metrics.series_hourly` for
    the run window into `docs-vault/wiki/perf/<date>-<scenario>.md`: machine and target, the
    scenario, client-side and server-side p50/p95/p99, errors, and the knee.
  - Committed per milestone, not per run.
- **Where it runs.**
  - Now: the local stack (a Docker Postgres with a `satis_load` database).
  - Later: `compose.yaml`, once ADR-0034 lands it.
  - D2: once on the AWS stack **before cut-over**, with a separate `satis_load` database on the
    same RDS that is dropped afterwards. That measures the real 0.5 vCPU Fargate task. The cost is
    a few task-hours, pennies from credits. Never after cut-over.

### 4. Not OpenTelemetry now
There is one process and no traces to join. The OTel SDK plus a collector would add a moving part
and, on AWS, a pull toward X-Ray and CloudWatch that §3 of ADR-0034 forbids. The OTel-convention
metric names keep the option cheap: an exporter later maps the registry one-to-one.
**Trigger:** a second service (a split worker, or the mod relay from #332), or a question about
latency that crosses the agent and the backend.

### 5. Frontend Web Vitals: in the lab now, from real users only if the owner wants it (D3)
- Now: the ADR-0032 e2e budgets (CLS, INP) stay the measure. They run in CI against the mock and
  the demo.
- Real-user monitoring would be a new data flow from every visitor's browser. The option: a
  beacon that sends only `{metric, value bucket, route pattern}`, with no identifiers, no user
  agent and no IP stored, aggregated into `metrics.series_hourly`, plus one privacy.html line in
  the same PR. Recommended: not now. Trigger: people other than the owner use the dashboard
  regularly.

## Build order (each its own PR, smallest first; the owner of every step is the dev unless noted)
| # | What | Tests |
|---|---|---|
| 1 | This ADR and the ADR-0036 step-3 amendment (docs) | none |
| 2 | Metric registry, `metrics.series_hourly` migration, 60 s flush, request histogram (replaces ADR-0036 step 3), purge | bucket merge math; an unknown metric or label is refused; the flush is idempotent; no URL or user appears in the labels |
| 3 | Background metrics: pollers, agent ingest lag, history writes, alerts | unit tests with a fake clock; the ingest lag is clamped |
| 4 | DB query timing by static query name | the label set equals the registered names |
| 5 | Load kit: seed script with guards, k6 scenarios a-c, load-report | the guards refuse production-like names and targets (unit); a scenario (a) smoke run in CI against the service Postgres, report-only |
| 6 | Metrics page "System" section (frontend, with #281) | tier:ui, demo fixture |
| 7 | First committed report: scenario a/b/c on the local stack; then D2 on AWS before cut-over | none |

## Consequences
- One general metrics table serves the latency, lag and throughput questions, portably, with plain
  SQL.
- Load tests run through the real auth, enrolment and ingest paths with no bypasses. The measured
  numbers therefore include the limiters and the validation costs.
- Push fan-out and Web Vitals from real users stay out until their triggers.

## Revisit when
- A second service exists: OpenTelemetry (§4).
- The server count exceeds about 50: drop per-server labels.
- Push (WS or SSE) arrives: add fan-out metrics.
- Other people use the dashboard regularly: D3.

## Owner decisions (2026-09-27)
- **D1** Load tool: k6.
- **D2** One load run on the AWS stack before cut-over, on a separate `satis_load` database dropped
  afterwards. Never after cut-over.
- **D3** No Web Vitals from real users for now. The CI lab budgets stay.
- **D4** Load reports are committed to `docs-vault/wiki/perf/` as portfolio evidence.
