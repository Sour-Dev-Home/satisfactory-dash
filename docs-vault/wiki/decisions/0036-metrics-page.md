# ADR-0036: An operator-only metrics page

Status: accepted (owner, 2026-09-26): D1 push from Actions to a hashed-secret ingest endpoint;
D2 build after the agent parity week, step 0 (#280's output shape) now; D3 uptime = status-page
link only; D4 the "false alarm?" mark after the alert shadow week. Build tracked in #281.

## Context
- **Latency** today exists only in log files. `npm run latency-report` (`scripts/latency-report.mjs:1-14`)
  reads the backend's daily `backend-YYYY-MM-DD.log` files (14 days). On AWS the logs go to
  stdout/CloudWatch (ADR-0034, 14 days, no AWS SDK in the app), so a page that reads log files
  would break at the move.
- **Delivery (DORA) and CI health** will come from the delivery-metrics script (#280), which reads
  GitHub. The backend holds no GitHub credential today.
- **Probe history** lives in Better Stack (ADR-0028), outside the system, and has a public status
  page. The backend can't observe its own downtime.
- **Alert quality**: the roadmap target is "at most 1 false alarm per month, by a weekly review of
  the alert log" (`docs-vault/wiki/roadmap.md:26`). `alerts.alert_events` records every transition
  (`backend/migrations/1790640000000_alerts.sql:56`), but nothing records whether an alarm was
  false, so the metric can't be computed from data yet.
- **Access**: an "operator" is the single local account (`OPERATOR_SUBJECT`,
  `backend/src/modules/identity/authenticator.ts:8`). The operator gate exists only inside the
  servers router (`serverManagementRouter.ts:81-86`, 403 `ForbiddenError`).
- **Demo** is a separate build with an in-house router over fixtures (ADR-0026 amendment #113).
  `e2e/build-output.spec` already proves that no real API origin gets into the demo bundle.

## Decision
1. **One read endpoint and one schema.** `GET /api/admin/metrics` returns `MetricsOverview`, a zod
   schema in `packages/shared`. Every section (`latency`, `delivery`, `ci`, `alerts`, `uptime`) is
   either `{ available: true, asOf, ... }` or `{ available: false, reason }`, so the page ships
   before every source exists and the demo fixture parses under the same schema.
2. **Access**: operator only. Move `operatorOnly` from the servers router to the identity module
   (one gate, reused), and return 403 as today. The frontend route `/admin/metrics` has no nav link
   for non-operators. This hides the page for convenience only; the backend check is the control.
   Rate-limited like the other operator reads.
3. **Latency: the backend records its own rollups in Postgres, not from logs.** The request timer
   (`platform/requestTiming.ts`) feeds an in-process histogram per `(route, status class)` with
   fixed millisecond buckets. Every 5 minutes it upserts into `metrics.route_latency_hourly`
   (`hour, route, status_class, count, bucket_counts int[]`), using `ON CONFLICT ... DO UPDATE` to
   add the counts. Store histogram buckets, not percentiles, because percentiles from separate hours
   can't be combined, while bucket counts can be summed over any window. Keep 90 days (a purge in
   the existing retention job). Only the route pattern is stored, never a URL, user or IP (the same
   rule as latency-report). It works the same on the PC and on AWS. `latency-report` stays as the
   log-based tool.
4. **Delivery + CI: computed in GitHub Actions and pushed to the backend (recommended, D1).** A
   scheduled workflow (daily, plus after each merge to main) runs the #280 script with the workflow's
   own read-only `GITHUB_TOKEN`. It validates the output against the shared `DeliverySnapshot`
   schema, then POSTs it to `POST /api/internal/metrics/delivery` with a dedicated ingest secret
   (stored hashed, write-only power, capped body, same pattern as agent ingest). The backend keeps
   the latest N snapshots in `metrics.delivery_snapshots`. If the PC is off, the run fails softly
   (a warning, not a red CI run) and the next run catches up. The snapshot contains aggregates only:
   counts, durations and rates. No usernames, emails or commit messages.
   - Rejected alternative A: the backend polls GitHub itself with a token. That adds a third-party
     credential and a second copy of the #280 logic in the backend, and it only works while the PC is up.
   - Rejected alternative: publish the JSON as a static file on the public frontend origin. Simple,
     and the numbers are derivable from the public repo anyway, but it contradicts "not easily
     reachable", and a rolling release/branch needs bypass permissions on the rulesets.
5. **Alert quality**: phase 1 shows alarms fired per month per kind, and time-to-resolve, from
   `alert_events`. Phase 2 (trigger: the owner wants the "≤1 false alarm/month" number itself) adds
   `alerts.event_reviews(event_id, verdict, reviewed_at)`, filled by a "false alarm?" mark on the
   alert log, which turns the weekly review into data.
6. **Uptime**: phase 1 links the public status page (`status.satis-manager.com`). Pulling probe
   history in-page is deferred (D3). If wanted, the same Actions workflow reads the provider's API
   with its token held in Actions secrets, so the backend never holds it
   [NEEDS VERIFICATION: Better Stack free-tier API access to monitor availability history].
7. **Demo**: an invented fixture (`packages/shared/fixtures/metrics-overview.demo.json`) served by
   the demo router, labeled "Sample data" on the page. A contract test checks it parses under
   `MetricsOverview`. The demo shows the page without a login, as with its other pages.
8. **Privacy**: no new personal data. Latency rollups hold only route patterns and timings, the
   delivery snapshot only aggregates. Under the standing rule (privacy.html describes only what runs
   today), the PR that first stores data checks whether the page lists stored categories; add one
   line ("operational metrics without personal data") only if it does.

## Build order (each its own PR, smallest first)
| # | What | Owner | Tests |
|---|---|---|---|
| 0 | #280 emits JSON matching a `DeliverySnapshot` shape, aggregates only (do this now; it's the cheapest step that keeps D1 open). Done in #307 (schemaVersion 1). | dev | unit: no author/login fields in the output |
| 1 | Contract: `MetricsOverview`, `DeliverySnapshot`, demo fixture + parse test | dev | contract test |
| 2 | Operator gate moved to identity; `GET /api/admin/metrics` with alerts phase 1 + uptime link | dev | 403 for a member, 200 for the operator |
| 3 | Latency histogram + `metrics.route_latency_hourly` migration + purge. Amended by ADR-0037 §2: one general `metrics.series_hourly` table replaces `route_latency_hourly`. | dev | bucket merge math; no URL stored; retention |
| 4 | Delivery ingest endpoint + scheduled workflow (architect reviews the workflow) | dev | hashed secret, cap, 401 on a bad secret; soft-fail when offline |
| 5 | `/admin/metrics` page + demo fixture route | frontend | tier:ui, CLS/INP budgets (ADR-0032), demo build-output spec |

## Consequences
- The page works identically on the PC and on AWS, and nothing reads log files at runtime.
- One new inbound write surface (delivery ingest), limited to one secret with a single power.
- The metrics tables grow roughly with routes × hours: about 40 routes × 24 × 90 days ≈ 86k small
  rows. That's trivial, and needs no partitioning.

## Revisit when
- A second backend instance exists: move the in-process histogram flush to per-instance rows keyed
  by an instance id, or to OpenTelemetry metrics.
- Admin roles beyond the single operator exist (ADR-0020 users): replace the operator gate with a role.
- The owner wants probe history in-page (D3), or alert-quality phase 2 (5).

## Owner decisions (2026-09-26)
- **D1** Delivery data path: push from Actions to a hashed-secret ingest endpoint. The backend holds
  no GitHub token.
- **D2** Timing: build after the agent parity week. Step 0 (#280's aggregates-only output shape) now.
- **D3** Uptime: a link to the status page only.
- **D4** Alert quality: the "false alarm?" mark (phase 2) comes after the alert shadow week.
