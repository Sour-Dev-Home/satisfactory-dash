# ADR-0027: Production history and alerts (Discord first)

Status: accepted (project owner), 2026-09-24. All seven owner decisions were taken as recommended
(see the end). Builds only after ADR-0025 gate A (everything here needs Postgres).

## Context
- Alerts are the project's original purpose (roadmap #4). History (#5) is its foundation:
  "production below target" and "stalled for 5 minutes" are windowed questions, not snapshots.
- What we can observe, per the contract:
  - Per power circuit: `fuseTriggered`, `status` (outage), battery percent and flow; `hasOutage`
    (packages/shared/src/power.ts:22-42).
  - Per building: `isProducing`, `isPaused`, backend-derived `isBackedUp`, and each output's
    current/max per minute and percent (packages/shared/src/factory.ts:6-60).
  - `isProducing` is instantaneous and noisy ("show percent, not this", factory.ts:48-50), so
    rules must use averages over a window, never single flags.
  - Inputs are parsed from FRM (`ingredients[]` with CurrentConsumed/MaxConsumed/ConsPercent,
    frm-api.md:52-53; rawSchemas.ts:109) but not exposed in the contract, so "missing input"
    can't name the missing item yet.
- ADR-0022 already samples power every 5 s per server into a 5-minute in-memory ring behind
  `PowerHistoryStore`. ADR-0020 reserved `snapshot_history` (rollups, retention), a
  transactional outbox for notifications, and moving evaluation to the edge agent later.
- The backend runs on the same PC as the game server (ADR-0013). **When the PC is off, nothing
  here runs.** "The whole PC is down" is covered only by the external uptime monitor on
  `/api/health/ready` (roadmap 2a), not by this ADR.

## Decision
1. **Evaluation runs in the backend, per server.** The existing power poller (5 s) plus a new
   factory poller (30 s) feed one `AlertEvaluator` interface, `evaluate(serverId, observation, at)`.
   The edge agent's ingest (ADR-0020) later calls the same interface, and nothing else moves.
2. **Derivation is pure functions** in the telemetry module, unit-tested with an injected clock.
   - Building state: `producing | idle | backedUp | starved | paused | unpowered`.
     `starved` = recipe set, not paused, not backed up, circuit powered, and the averaged output
     percent below a threshold. With ingredients exposed, the reason names the item whose
     `ConsPercent` is low.
   - Thresholds are tuned by replaying the captured sessions [NEEDS VERIFICATION: `isPaused`
     semantics; values from the replay].
   - *Amendment (2026-09-24, PR 2):* classification is **per snapshot**, using FRM's own
     averaged percentages (`percent` on outputs and inputs; the contract notes these are averaged,
     unlike the instantaneous `isProducing`). The "held for N minutes" and hysteresis logic lives
     only in the alert engine (decision 4, PR 5), not in classification. The repo holds only two
     single `getFactory` snapshots, so PR 2's thresholds are **provisional**, documented with that
     evidence. A capture session (`getFactory` every 30 s for about 30 minutes while the game
     runs, saved trimmed under raw-sources/captured-responses) tunes them before PR 5.
   - The state is also exposed (optional) in the factory response, since the live map (ADR-0023)
     needs it too.
3. **History storage** (new `telemetry` schema, hand-written SQL per ADR-0025 decision 7).
   Downsampling is by **aggregation**, not by keeping per-building time series:
   | Series | Grain | Raw retention | Rollups |
   |---|---|---|---|
   | power per circuit (production/consumption/capacity MW, battery %, fuse) | 5 s | 48 h | 1 min for 30 d, 1 h for 1 y |
   | production per item (sum of current/max per minute across the factory) | 30 s | 48 h | 1 min for 30 d, 1 h for 1 y |
   | building state **transitions** (events, not samples) | on change | 30 d | none |
   - Rollups (min/avg/max) are written by an idempotent job each minute:
     `INSERT ... SELECT date_trunc(...) ... ON CONFLICT DO UPDATE`. Retention runs as batched deletes.
   - Volume for one server: ~86k power rows and ~150-300k item rows per day, raw data kept 48 h.
     Plain tables plus `(server, series, at)` indexes are enough; **no partitioning yet**
     (trigger below).
   - "What changed since yesterday" = the hourly item rollups compared with the same hour
     yesterday, plus a count of the transition events.
   - The live 5-minute chart stays in memory (ADR-0022). The DB serves longer ranges, and the
     API picks the resolution from the requested range.
4. **Alert semantics** (the `for`/hysteresis model used by Prometheus/Grafana):
   - A rule has kind, params, threshold, window, `for` duration, clear duration and severity.
     Per (rule, subject) a state machine moves `ok -> pending -> firing -> resolved`. It fires
     only after the condition has held for `for`, and resolves only after it has been false for
     the clear duration. Thresholds use a hysteresis band (e.g. fire below 90% of the target,
     clear above 95%).
   - The four kinds:
     - **power outage**: circuit status outage. Edge-triggered, `for` 0.
     - **fuse trip**: `fuseTriggered` false -> true. Edge-triggered.
     - **stalled machines**: backedUp or starved for at least `for` (default 5 min). **Grouped**:
       one message per rule per evaluation ("12 machines stalled: Iron Plate x8 missing input...").
     - **production below target**: an item's per-minute rate averaged over a window (default
       10 min, from the 1-minute rollups) below the target for at least `for`.
   - **Suppression:** while the game is paused (auto-pause, no players) or the game server is
     unreachable, production, stall and power rules don't evaluate. One "game server
     unreachable" alert replaces them, so auto-pause never floods the channel. There's also a
     per-server mute until a chosen time.
   - **Dedup and cooldown:** the dedup key is (rule, subject). While firing, it re-notifies at
     most once per repeat interval (default 1 h). The alert state is persisted, so a restart
     reloads it and doesn't re-fire.
5. **Delivery through the transactional outbox** (ADR-0020):
   - The evaluator writes the alert transition and the outbox row in one transaction.
   - A sender claims rows with `FOR UPDATE SKIP LOCKED` and retries with exponential backoff (it
     honors Discord 429 `retry_after`) until the row is marked dead after 24 h. Delivery is
     at-least-once, and the idempotency key is (alert, transition).
   - **Discord first:** one webhook per server, set by an owner or admin, with a "Send test"
     button.
   - Security:
     - The webhook URL is a bearer secret: it is encrypted at rest (AES-256-GCM, key in .env),
       never returned by the API (only the last 4 characters), and never logged.
     - The host is allowlisted to `discord.com` / `discordapp.com` over `https`, **so the
       backend never fetches a user-supplied URL (SSRF)**.
     - A 404 from Discord (webhook deleted) disables the destination and shows it in the UI.
   - **Email later:** per-user opt-in with address verification, through the same outbox, sent
     via AWS SES (owner decision 6).
6. **API and UI:** contract-first and additive.
   - Endpoints: history series; rules CRUD; destinations; the alert list. Every write requires
     the owner or admin role (ADR-0025 PR 6's `authorizeServer`), and the IDOR tests are
     generated from the endpoints list.
   - UI: Production history charts with the "since yesterday" diff; an Alerts page with presets
     for the four kinds, the destination setup and send-test, and the alert log.
7. **Demo data** (ADR-0026 item 6): the demo world gets seeded item series with a visible dip,
   two firing and three resolved alerts, the preset rules, and a "Send test" that answers
   "sent (demo)" without any network call.

## Test strategy
- **Derivation and state machine:** table-driven unit tests with an injected clock. A
  property-based test: for random condition sequences, never more than one notification per
  (rule, subject) per repeat interval, and none while suppressed.
- **Replay:** recorded capture sessions run through the evaluator and must produce the alerts in
  a golden file. Threshold tuning happens here.
- **Postgres (Testcontainers):**
  - rollups: raw to 1 min to 1 h correctness, and idempotent re-runs
  - retention deletes
  - outbox claiming under concurrency (two senders never send the same row)
  - after a restart mid-firing: no duplicate notification
- **Delivery:** a local HTTP stub standing in for Discord: 429 with retry_after, a 5xx retry,
  404 disables, a non-allowlisted host is rejected before any request is made.

## Build plan (after ADR-0025 gate A; dev = backend + shared, fe = frontend)
| # | PR | Owner | Test-hunter |
|---|---|---|---|
| 1 | Contract: optional `ingredients` and optional derived `state` on FactoryBuilding (+ adapter mapping) | dev | QUICK |
| 2 | Pure derivation (`classifyBuilding`), replay harness + golden files from captures | dev | FULL |
| 3 | History storage: telemetry schema, recorder on the pollers, factory poller (30 s), rollup and retention job | dev | FULL |
| 4 | Contract + API: history series (range picks the resolution) | dev | QUICK |
| 5 | Alert engine: rules/alerts tables, state machine, suppression, grouping, persistence | dev | FULL |
| 6 | Outbox + Discord sender (encryption, host allowlist, retries, 404 disables) | dev | FULL + security-reviewer |
| 7 | Contract + API: rules, destinations, alert log, send-test (owner/admin only) | dev | FULL + security-reviewer |
| 8 | UI: history charts + "since yesterday" + demo data | fe | QUICK + ui-reviewer |
| 9 | UI: Alerts page (presets, destination setup, log) + demo data | fe | QUICK + ui-reviewer |
| later | Email via SES with verified addresses (owner decision 6) | dev | FULL + security-reviewer |

## Consequences
- The first continuously growing tables, with retention and rollups operated by the app itself.
- Alerts only while the owner's PC runs. External downtime detection stays with the uptime monitor.
- The factory is polled every 30 s even when nobody is watching (acceptable load on one
  server; ADR-0020's viewer-driven cadence applies to live views, not to alert evaluation).

## Revisit when
- The raw tables pass ~10M rows or retention deletes take more than a few seconds: partition by
  day (native range partitioning).
- A second host (edge agent): evaluate at the edge and send only events and rollups to the cloud.
- Alert noise shows up in the log: tune the defaults from the data; don't add rule kinds first.

## Owner decisions (answered 2026-09-24)
1 yes, build after gate A. 2 A: 48 h / 30 d / 1 y. 3 A: one Discord webhook per server.
4 outage and fuse ON; stalls and targets opt-in. 5 A: hourly repeat. 6 yes, SES email later.
7 yes, suppress while paused.

## Decisions as proposed
1. Build this after ADR-0025 gate A (it needs the database)? **Recommend yes.**
2. Retention: **A: raw 48 h, 1-minute rollups 30 days, hourly rollups 1 year (recommended)** / B: longer (costs only disk on the PC).
3. Discord destination: **A: one webhook per server, set by owner/admin (recommended)** / B: per user.
4. Defaults for a new server: **outage and fuse trip ON; stalled machines and production targets opt-in (recommended)**, since stall rules need tuning per factory.
5. While an alert keeps firing, repeat it: **A: every hour (recommended)** / B: never (only fire and resolve).
6. Email later via **AWS SES** (you verify the domain and request production access; steps provided)? **Recommend yes, after Discord proves the rules.**
7. Suppress everything while the game is paused (auto-pause) and send one "server unreachable" alert instead? **Recommend yes.**

## Amendment 2 (2026-09-25): "Underfed" replaces "starved"; the stall alerts

**Context.** PR 2 classified a machine as `starved` when its averaged output percent fell below a
provisional 5%. The owner's rule is simpler: when the percent is below 95% of what the machine is set
for, it gets fewer resources than it needs. FRM's `MaxProd` already includes the clock speed
(`wiki/frm-api.md`, Production), so `ProdPercent` is relative to the set clock and the rule holds for
underclocked and overclocked machines alike.

**Decision (owner, 2026-09-25).**
1. The state `starved` is renamed **`underfed`**: output percent below 95 (a named constant,
   provisional until the capture session). Precedence is unchanged: paused > unpowered > idle >
   backedUp > underfed > producing. A full output also lowers the percent, and the output is the
   cause, so backedUp still wins. The hint naming the shortest input (lowest `ConsPercent`) stays.
2. Discord alerts for machines (the UI shows `underfed` regardless):
   - **Stopped machines**, on by default: output percent below about 5% for 5 min, grouped into one
     message per evaluation. The old 5% is a parameter of this rule, not a state.
   - **Newly underfed**, opt-in: a machine that was at 95% or more for at least 30 min stays below
     95% for at least 10 min. Machines underfed on purpose never qualify.
   - "Any underfed machine for N minutes" is not offered (deliberately underfed machines would
     fire constantly).
3. The capture session also covers one fully fed, deliberately underclocked machine (it must read
   producing) and one machine with a Somersloop. Whether `MaxProd` includes the Somersloop's
   amplification is [NEEDS VERIFICATION]. The capture measures false underfed readings, the lag
   after an input is cut, and flapping around 95%.
4. The contract gains an optional `clockSpeedPercent` per building (FRM `ManuSpeed`), so the Factory
   view can show what each machine is set to.

**Consequences.** The alert engine (PR 5) and the UI build on `underfed` from the start. If the
capture shows machines flapping around 95% between polls, a small band (enter below 95, leave at 98
or above) would move into classification. That relaxes the per-snapshot rule in Amendment 1 and needs
the owner's approval.

**Revisit when.** The capture session is replayed (confirm 95% and the defaults), or FRM documents
its averaging window.
