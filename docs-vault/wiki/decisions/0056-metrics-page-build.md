# ADR-0056: The metrics page, rescoped on what is built (amends ADR-0036)

Status: **Accepted** (owner, 2026-10-25: Q1 to Q5 all yes; see "Owner's answers" at the end). Proposed by the
architect, 2026-10-25, for #281 (which absorbed #331's ADR-0037 step 6). Amends ADR-0036
Decisions 1, 2, 4, 5, 6 and 7 and its build order. It keeps the owner's decisions D1 to D4 of 2026-09-26 as they
are; the questions at the end are the only new choices.
Amended 2026-10-26 (chart-led page, operator nav tab; see "Amendment 2026-10-26" at the end).

The owner's direction (2026-09-26): a full page for metrics, not easily reachable by ordinary users, operator only,
and shown in the public demo with fixture data. Owner priority (2026-10-20): next after the self-serve chain. It gives
the new counters from #514 and #515 a home.

## Context: what changed since ADR-0036

| Fact | Evidence |
|---|---|
| ADR-0037's store is built: `metrics.series_hourly(hour, metric, labels, count, sum, bucket_counts)`, 13 fixed ms buckets, PK `(hour, metric, labels)`, index on `hour`. | `backend/migrations/1791072000000_metrics.sql:27-37` |
| It is written every 60 s and purged after 90 days in the same worker. | `platform/metrics/seriesFlushWorker.ts:8-9` |
| It has **no read path**: the repository only adds and purges. | `platform/metrics/seriesHourlyRepository.ts:20,33,63` |
| The registry already holds every System number #281 lists, including `satis.agent.refused` (#514) and `satis.history.rows_dropped` / `satis.alerts.events_dropped` (#515). | `platform/metrics/registry.ts:275-346` |
| No contract, endpoint or page exists yet: no `MetricsOverview`, no `/api/admin`. | `grep -rn "MetricsOverview\|api/admin" packages/shared/src backend/src` finds nothing |
| The operator gate is still private to the servers router; the predicate is "caller is the seeded operator". | `modules/servers/serverManagementRouter.ts:91-96`, `modules/servers/serverManagement.ts:256-259` |
| The frontend learns "operator" from `canManageServers` and hides the Servers tab and its command otherwise. The demo user is an operator. | `packages/shared/src/servers.ts:36`, `frontend/src/shell/tabs.ts:26-34`, `frontend/src/palette/paletteCommands.ts:85`, `frontend/src/demo/world.ts:53` |
| The delivery script (#280) emits aggregates-only JSON (schemaVersion 1), but no workflow runs it. Its `mergeQueue` section is dead since ADR-0043 removed the merge queue, and it has no flake measure. | `scripts/delivery-metrics.mjs:9-23,94-97`; `grep delivery-metrics .github/workflows` finds nothing |
| The latency probe keeps nothing: it writes one job summary per run, has no secrets and no permissions. Its header still says "a PC that is often off". | `.github/workflows/latency-probe.yml:3-11,19` |
| The alert log has `kind`, `transition` (fired/updated/renotify/resolved) and `at`, indexed on `at`, kept 90 days. Nothing records whether an alarm was false. | `backend/migrations/1790640000000_alerts.sql:56-72` |
| The backend now runs on ECS behind the tunnel, always on, with overlapping rollouts. Secrets come from SSM parameters. | ADR-0049, ADR-0054; `infra/aws/ecs.tf:11-18,67` |
| The privacy page already lists the metrics store. | `frontend/public/privacy.html:265` ("Request metrics ... with no personal data beyond server ids: 90 days") |

## Decision

### 1. Stored versus needed

| Page section | Numbers | Source | Status |
|---|---|---|---|
| System: latency | p50/p95/p99 of `http.server.request.duration` per route and status class, upstream (vanilla/frm), DB per query name | `series_hourly` | stored |
| System: lag and throughput | poller cycle and lag, agent ingest lag, history rows written, alert evaluation and fire lag | `series_hourly` | stored |
| System: refused and dropped | `satis.agent.refused` (per status), `satis.history.rows_dropped`, `satis.alerts.events_dropped`, `satis.alerts.push.dropped`, `satis.signup.refused` | `series_hourly` (counters) | stored |
| Alert quality, phase 1 | fired per month per kind; median time to resolve; **flaps** (fired, then resolved within 5 minutes) as a stand-in for false alarms until D4 | `alerts.alert_events` | stored |
| Uptime | link to the public status page (D3) | none | no data needed |
| Probe history | link to the latency-probe workflow runs (the repo is public) | GitHub | **not stored; deferred** (§6) |
| Delivery (DORA) and CI health | throughput, lead time, size, change failure; CI main failure rate, flake rate, PR bounce rate | delivery script, pushed (§4) | **needed**: `metrics.delivery_snapshots` |
| Alert quality, phase 2 | false alarms per month | `alerts.event_reviews` | needed later (D4, ADR-0036 §5) |

So the first page ships on data that already exists. Only delivery needs a new table and a new inbound path.

### 2. Contract and endpoint (additive, ADR-0007)
- New `packages/shared/src/metrics.ts`, exported from the package index, plus two `endpoints` entries. Nothing
  existing changes.
- `GET /api/admin/metrics?window=1h|24h|7d` (default `24h`) returns `MetricsOverview`:

```ts
type Section<T> = { available: true; asOf: string } & T | { available: false; reason: "not_built" | "no_data" | "not_configured" };
interface MetricsOverview {
  generatedAt: string; window: "1h" | "24h" | "7d";
  system: Section<{ histograms: HistogramSummary[]; counters: CounterSummary[] }>;
  alerts: Section<{ months: { month: string; kind: string; fired: number; flaps: number; medianResolveSeconds: number | null }[] }>;
  delivery: Section<{ snapshot: DeliverySnapshot }>;   // the script's JSON, schemaVersion 2
  links: { statusPage: string; probeRuns: string };
}
interface HistogramSummary { metric: string; labels: Record<string, string>; count: number; p50Ms: number; p95Ms: number; p99Ms: number }
interface CounterSummary   { metric: string; labels: Record<string, string>; total: number }
```

- **Percentiles are bucket upper bounds** ("p95 ≤ 200 ms"). The buckets are coarse (1, 2, 5, ... 5000 ms, +inf), so
  interpolating would show precision the data doesn't have. The `+inf` bucket shows as "> 5 s". SQL sums
  `bucket_counts` element-wise per `(metric, labels)` over the window (`unnest ... WITH ORDINALITY`, `GROUP BY`); a
  pure TypeScript function turns the sums into percentiles. Both are unit-tested.
- **Per-server labels are folded by default.** The response merges the `server` label away (all servers combined)
  and adds the five worst servers per metric, identified by public id only. It never carries a display name, owner
  or member.
- `alerts` covers the last 3 calendar months (the alert log keeps 90 days), aggregated over all servers, with no
  server id.
- The demo fixture `packages/shared/fixtures/metrics-overview.demo.json` is invented, and a contract test parses it.

### 3. Access control: one operator gate, not reachable from the nav
- **Server side is the control.** Move the predicate to `modules/identity` as `requireOperator` (401 when signed out,
  403 `ForbiddenError` for anyone but the seeded operator). The servers router switches to it with unchanged behavior,
  and its existing 403 tests prove that. The metrics router uses the same gate, plus the per-user rate limiter the
  operator reads use. It answers 403 rather than 404: the repo is public, so the route's existence is no secret, and
  403 matches the error taxonomy.
- **Frontend:** the route is `/app/metrics`. It is **not** in `visibleTabs`, even for the operator (the owner's "not
  easily reachable"). The operator reaches it from an operator-only command-bar entry (next to `page-servers`) and a
  link on the Servers page. A non-operator who types the URL gets the same redirect as an unknown page, with no hint
  that the page exists.
- **Demo:** the demo user is already an operator (`world.ts:53`), so the same entry points appear. A demo handler
  serves the fixture, and the page shows a "Sample data" label. `e2e/build-output.spec` keeps proving that no real API
  origin is in the demo bundle. Whether the demo also gets a visible nav tab is Q1.

### 4. Delivery and CI health: keep D1, refined
The backend still holds no GitHub token. D1 stands, and the move to AWS removes its main weakness (the PC being off).
- **Script, schemaVersion 2** (`scripts/delivery-metrics.mjs`). Drop `mergeQueue`. Add
  `ci: { mainRuns, failedMainRuns, mainFailureRate, flakyRuns, flakeRate, prsMerged, prsBounced, bounceRate }`, where:
  - a **flaky run** is a CI run whose head SHA has a failed attempt and a later successful attempt;
  - a **bounced PR** is a merged PR whose required checks failed at least once before the merge.
  It stays aggregates only, with no login, title or SHA in the output.
- **Workflow `delivery-metrics.yml`**: daily cron plus manual dispatch, not per merge. The window is 30 days, so a daily
  update is fresh enough. It uses the workflow's read-only `GITHUB_TOKEN` (`contents`, `pull-requests` and `actions`
  read) to run the script, validates the output against the shared schema, and POSTs it. The ingest secret is in a
  GitHub **environment** `metrics-ingest` limited to `main`, so a branch workflow can't read it. A failed POST warns
  and the run stays green.
- **Endpoint `POST /api/internal/metrics/delivery`**: `Authorization: Bearer <secret>`, compared with
  `timingSafeEqual` against `METRICS_INGEST_SECRET_SHA256` (only the hash is in the backend's env). It returns 404 when
  that env var is unset (feature off), 401 on a wrong secret, and 413 over 16 KB. The body is validated with zod.
  Rate limit: 10 an hour. It has no other power.
- **Table `metrics.delivery_snapshots(id, received_at, generated_at, schema_version, body jsonb)`**: keeps the newest
  90 rows, pruned on insert. The page reads the newest one.
- Rejected again: a static JSON file on the frontend origin. It costs nothing and the numbers are public-derivable,
  but it is reachable by anyone and contradicts the owner's direction. "Nothing in v1" is not a separate option: the
  section reports `not_built` until PR 6 lands, so the page ships first anyway.

### 5. Privacy
- No new personal data. `series_hourly` holds route patterns, query names, status classes and server public ids.
  The delivery snapshot holds repo aggregates. The alert section is aggregated over all servers. The page shows
  server public ids only.
- `privacy.html:265` already covers the store. However, it says "Request metrics", and the store now also holds
  background-job timings and refused/dropped counters. Suggested accurate wording (Q2, the owner approves legal text):
  "System metrics (counts and timings of requests and background jobs, with no personal data beyond server ids):
  90 days."
- A small correction for the dev: `serverRepository.ts:216` says `series_hourly` "has no server column". In fact the
  `server` label holds a public id until the 90-day purge. Correct the comment; the behavior is fine (a public id is
  random and not personal on its own).

### 6. Probe history: not yet
The probe stores nothing, and job summaries are not a clean API source [NEEDS VERIFICATION: whether the REST API
exposes step summaries]. Version 1 links to the workflow's runs. **Trigger:** the owner wants external latency trends
in the page. Then the probe gets the `metrics-ingest` environment and posts one observation per run to the same ingest
path, recorded as a registered histogram `satis.probe.duration` (no labels). PR 3 also fixes the probe's stale "PC
often off" header.

### 7. Cost and performance (stays on the AWS Free plan)
- **No new AWS resource.** One new standard SSM parameter (free tier). Actions minutes cost nothing on a public repo.
  The new rows are about 90 snapshots, so storage is negligible.
- **Bounded queries.** The longest window is 7 days, so a System query reads at most (series count × 168) rows from
  the PK range on `hour`. ADR-0037 estimated about 150 series, so roughly 25k small rows. The alert query reads 90
  days through `alert_events_at_idx`.
- Every new query gets a static name in `QUERY_NAMES`, so `db.client.operation.duration` measures the page itself.
- The page has no polling. It loads on open and offers a refresh button (`staleTime` 60 s, which matches the flush).
- **Trigger for more:** the endpoint's p95 goes over 300 ms, or a query's p95 over 100 ms, in its own metric. Then
  add a `(metric, hour)` index or a daily rollup. Not now.

## Build order (each its own PR, branched from main; dev owns all but PR 5, and reviewers follow CLAUDE.md)

| # | What | Where | Tests |
|---|---|---|---|
| 1 | This ADR | `docs-vault/` | none |
| 2 | Contract: `metrics.ts` (`MetricsOverview`, `Section`, summaries, `DeliverySnapshot` v2), two `endpoints` entries, demo fixture | `packages/shared/` | fixture parses; a `labels` value with `@`, whitespace or over 200 chars is refused |
| 3 | `requireOperator` moved to identity, servers router switched; new `modules/metrics/` (router, service, SQL read over `series_hourly`, percentile function, server folding); query names registered; the two stale comments fixed | `backend/src/modules/{identity,servers,metrics}`, `platform/metrics/registry.ts` | supertest: 401 / 403 member / 200 operator; servers' 403 tests unchanged; `window` outside the enum gives 400; percentile edge cases (empty, all `+inf`, one bucket); db test sums buckets across hours; no display name in the response; `timedQueryCallSites` |
| 4 | Alert quality phase 1: `alertQualitySummary(months)` exported from the alerts module's index, composed by the metrics service | `backend/src/modules/alerts`, `modules/metrics` | db test: monthly grouping, flap rule at exactly 5 min, median with no resolve |
| 5 | Page `/app/metrics` (System, refused/dropped, alerts; delivery shows "not yet available"), command-bar entry, Servers-page link, demo handler | `frontend/` | not in `visibleTabs`; non-operator redirected; demo shows "Sample data"; build-output spec; CLS/INP budgets (ADR-0032); ui-reviewer |
| 6a | Script schemaVersion 2 (`ci` section, `mergeQueue` dropped) | `scripts/` | unit: flake and bounce definitions; still no login or SHA fields |
| 6b | `delivery_snapshots` migration, ingest endpoint, env validation | `backend/` | 404 when unset, 401 on a bad secret, 413 over the cap, prune keeps 90; security-reviewer |
| 6c | Optional SSM secret `METRICS_INGEST_SECRET_SHA256` (the owner applies first, per the infra rule) | `infra/aws/` | terraform tests |
| 6d | `delivery-metrics.yml` with the `metrics-ingest` environment (the owner creates the environment and secret) | `.github/workflows/` | actionlint; a soft failure when the endpoint is down; architect reviews |

PRs 2 to 5 deliver the System and alert sections, which is what #331 asked for. PR 6 is independent and can follow
later.

## Consequences
- The page runs on existing data, adds one inbound write surface (one secret with one power), and adds no AWS cost.
- One operator gate serves servers and metrics. A future admin role (ADR-0020) replaces one function.
- Percentiles are honest but coarse. Finer buckets would be a registry change, which only applies to new hours.

## Revisit when
- More than one admin exists: replace `requireOperator` with a role.
- The owner wants probe history in the page (§6), or the alert shadow week has run (D4: phase 2).
- The endpoint or query p95 trigger in §7 fires.
- A second service exists: OpenTelemetry (ADR-0037 §4).

## Questions for the owner
- **Q1** Demo discoverability: should the demo show a visible "Metrics" nav tab (demo build only), so visitors find
  it? Recommended: yes. The real app keeps it out of the nav.
- **Q2** Privacy wording (§5): approve "System metrics (counts and timings of requests and background jobs, with no
  personal data beyond server ids): 90 days", in PR 5? Recommended: yes, for accuracy.
- **Q3** D1 refinement: a daily push only, not after each merge, with the secret in a `main`-only environment that
  you create. Recommended: yes.
- **Q4** Alert quality: show "flaps" (resolved within 5 minutes) as a labelled stand-in for false alarms until D4?
  Recommended: yes.
- **Q5** Timing: start PR 2 now (D2's agent-parity-week gate has passed by the 2026-10-20 priority note)?

## Owner's answers (2026-10-25)
"1 yes, 2 ok, 3 yes, 4 yes, 5 yes".
- **Q1** Yes: the demo build shows a visible "Metrics" nav tab; the real app keeps it out of the nav.
- **Q2** Approved as worded. It landed with this acceptance rather than in PR 5, since it already describes what the
  metrics store holds today (`privacy.html`, retention list).
- **Q3** Yes: daily push only. The owner creates the `main`-only environment and its secret in the GitHub UI when PR 6d
  is ready; sessions never touch environments or secrets (ADR-0049).
- **Q4** Yes: "flaps" are shown, labelled as a stand-in for false alarms, until D4.
- **Q5** Yes: PR 2 starts now.

## Amendment 2026-10-26: a chart-led page, with an operator nav tab

Owner decisions, 2026-10-26: (1) the metrics page becomes chart-led, modelled on Google SRE's four golden signals and
the RED method, Grafana's dashboard practice (a headline stat row, then trends, then detail) and DORA's Four Keys
dashboard, drawn with uPlot (already a frontend dependency, used by `power/PowerChart.tsx`). The existing tables stay as
folded "Details", the accessible text path. (2) The page gets a visible "Metrics" nav tab for the operator only (the
owner chose it over an Overview card or an Account-menu entry). Designed with the architecture advisor.

### Amends section 2 (contract; additive, ADR-0007)
- `MetricsOverview` gains an optional `charts` section (`Section<{ headline, trend }>`), optional so a frontend that
  meets an older backend during a deploy still parses.
- `trend` is a fixed, server-folded set of hourly series on one shared axis (`from` on the hour, `points`, a one-hour
  step): requests by status class, request p50/p95/p99, game-server call p95 per upstream (vanilla, frm), DB query p95,
  poll lag p95, agent ingest lag p95, five refused/dropped counters, and alerts fired. No per-route or per-server series,
  which keeps a full 7d trend under 32 kB (the contract test checks the worst case).
- Percentiles stay bucket upper bounds. In a trend `null` means "no data that hour" and `METRICS_TREND_OVER_MS` (10000)
  means "above 5 s". Counters are 0 for a quiet hour; request counts are `null`, so an outage shows as a gap.
- The trend always covers at least a day (25 points), so the `1h` window still has a usable chart; `7d` has 169.
- `headline` has `current` and `previous` (the same-length window before it): requests, 5xx answers, request p95, poll
  lag p95, agent lag p95, alerts fired, refused and dropped. Percentiles come from summed buckets on the server (hourly
  percentiles cannot be merged). The page shows a percent change for counts and the bucket step for percentiles.
- The existing `histograms`, `counters`, `servers`, `alerts` and `delivery` fields are unchanged.

### Amends section 3 (access)
- The "not in `visibleTabs`" rule is replaced: the operator sees a "Metrics" tab (`/app/metrics`) when
  `canManageServers` is true, like the Servers tab. The command-bar entry and the Servers-page link stay.
- Non-operators never see the tab or the command, are redirected as for an unknown page, and the server still answers
  403. The server is the control; the tab is a convenience. The demo already shows the tab (Q1).

### Amends section 7 (cost)
- One new query, `metrics.seriesHourly`, over the same primary-key range on `hour` (filtered to the trend's metrics,
  grouped by hour with the folded labels removed), and one small query, `metrics.alertsFiredHourly`, on
  `alert_events_at_idx`. The range is at most twice the window (the older half is the headline's baseline): at most
  about 50k rows read and about 3.7k returned. The trigger is unchanged and covers these queries too: a query p95 over
  100 ms, or the endpoint p95 over 300 ms.

### Build order (each its own PR from main; named A1 to A3 to keep clear of the PR numbers above)

| # | What | Where | Tests |
|---|---|---|---|
| A1 | Contract: the `charts` section, trend and headline schemas, fixtures for a day and a full week | `packages/shared/` | fixtures parse; series lengths equal `points`; p50 <= p95 <= p99 per hour; `from` off the hour refused; the week fixture at most 32 kB; an overview without `charts` still parses |
| A2 | Backend: `metrics.seriesHourly` and `metrics.alertsFiredHourly`, trend and headline folding, `QUERY_NAMES`; settles how an unknown `status_class` folds | `backend/src/modules/metrics/` | db test: hourly grouping, null versus zero, the previous half, the open bucket gives 10000; supertest still 401 / 403 / 200; `timedQueryCallSites` |
| A3 | Page: headline tiles, trend charts (uPlot, lazy), folded Details, the operator "Metrics" tab, demo data | `frontend/` | tab only for the operator; non-operator redirected; CLS/INP budgets (ADR-0032); axe on the Details path; ui-reviewer; build-output spec |

A1 merges first; A2 fills `charts`; A3 draws it, and shows "Charts not available yet" while `charts` is absent.
