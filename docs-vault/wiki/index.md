# Wiki index

Catalog of every page in this wiki. One line per page. Updated whenever a page is
added or removed.

- [`vanilla-dedicated-server-api.md`](./vanilla-dedicated-server-api.md) — summary of
  the official Dedicated Server API (Lightweight UDP Query + HTTPS JSON-RPC): auth,
  relevant functions, and the observation that it has no production/power data model.
- [`runbooks/go-live-api.md`](./runbooks/go-live-api.md) — ordered steps to turn on the
  API: production `.env`, enforced game tokens, Scheduled Task, Cloudflare Tunnel, go-live
  tests and rollback (issue #19).
- [`runbooks/backups.md`](./runbooks/backups.md) — the nightly encrypted database backup (pg_dump, age,
  put-only S3 upload): the owner's one-time AWS and age setup, a local trial without AWS, and the
  restore rehearsal (ADR-0025 decision 7).
- [`runbooks/delivery-metrics.md`](./runbooks/delivery-metrics.md) — `npm run delivery-metrics` (#280): DORA-style
  aggregates from the GitHub API and the log fragments (throughput, lead time, merge-queue bounce rate, change-failure
  proxies), the stable JSON shape, and the definitions and limits.
- [`log.md`](./log.md) and [`log.d/`](./log.d/README.md) — the wiki's change log: `log.md` is frozen at
  2026-09-25 and each PR since adds one fragment file in `log.d/` (ADR-0033); `npm run log` prints both in order.
- [`runbooks/servers.md`](./runbooks/servers.md) — servers stored in the database with encrypted tokens
  (ADR-0030): the `SERVER_SECRETS_KEY` and its offline backup, the deploy order (migrate first), the
  `import-servers` and `verify-secrets` commands, unreadable rows and key rotation.
- [`runbooks/history.md`](./runbooks/history.md) — production history (ADR-0027 PR 3): the deploy
  order (`db:migrate` first), what is stored and for how long, the recorder, pollers and rollup worker.
- [`runbooks/alerts.md`](./runbooks/alerts.md) — the alert engine (ADR-0027 PR 5): the deploy order (`db:migrate`
  first), the rule kinds and presets, suppression, restarts, and the SQL to read the alert log during the shadow run.
- [`runbooks/agents.md`](./runbooks/agents.md) — the backend side of the edge agent (ADR-0031 PR 5a and 5b): the deploy
  order (`db:migrate` first), enrolment codes and what enrolling does to a local server, revoking (the only way back is
  re-enrolling), commands (auto-pause answers `202`), and the `agent_offline` alert.
- [`runbooks/backend-cheat-sheet.md`](./runbooks/backend-cheat-sheet.md) — facts that cost CI rounds when guessed: the two
  server ids (public string vs internal UUID), which errors are `ApiFailure` and which are plain classes, the rate-limiter
  defaults that bite in tests, ordering rules in the servers module, running DB tests locally, the CI-wait one-liner, and
  the worktree git rules.
- [`runbooks/agent-app.md`](./runbooks/agent-app.md) — the edge agent program itself (ADR-0031 PR 6): first setup in order
  (set the game's tokens at a hidden prompt, `check`, enrol, run), where the DPAPI-protected store and the 7-day logs
  live, the Scheduled Task and its logon-type trap, what it sends, and troubleshooting by exit code and log event.
- [`runbooks/agent-switch-over.md`](./runbooks/agent-switch-over.md) — the owner's switch-over from a backend-polled server
  to the edge agent (ADR-0031 PR 8): the checklist, the order (agent from the checkout, `set-tokens`, `check`, a code in
  Settings, `enroll`, the Scheduled Task), the parity week (history and alerts against the week before), retiring the local
  connection, and the way back (revoke, re-enrol, or switch back to local).
- [`frm-api.md`](./frm-api.md) — summary of FicsitRemoteMonitoring's Read API: the two
  transports (Web Server vs. tunneled Game Port API), the full endpoint index grouped
  by resource, and which endpoints are candidates for production-rate/overflow/power
  monitoring (field-level schemas still need capturing — see `log.md`).
- [`frm-endpoint-volumes.md`](./frm-endpoint-volumes.md) — per FRM endpoint of the Players card and map-overlay work (#329,
  #330): measured size and item count from real captures (2026-09-27), whether it runs on the game thread, and whether the
  vanilla API or the agent's current snapshot already covers it; three responses are large (schematics, resource nodes,
  train rails, about 1.4 MB together).
- [`machine-states.md`](./machine-states.md) — how a machine's state (producing, idle, backed up,
  underfed, paused, unpowered) is derived per snapshot (ADR-0027), the provisional threshold and its
  evidence, and how to tune it with a capture session.
- [`data-gap-analysis.md`](./data-gap-analysis.md) — table of player-facing metrics vs.
  API coverage. Filled in from the Phase 2 live-server spike (2026-09-21): every
  stated metric is covered by the vanilla API or FRM, no custom mod needed yet.
- [`lessons-learned.md`](./lessons-learned.md) — one-sentence-per-bug log of real bugs
  found by independent `test-hunter` review passes, with a counter that increments
  when the same pattern recurs, so repeated mistakes get visible sooner.
- [`frontend-wiring-checklist.md`](./frontend-wiring-checklist.md) — every file to change, in order, when the
  frontend gains an endpoint or a screen: the query or write hook, secrets kept out of caches, the three mocks
  (unit, e2e/dev:mock, demo), e2e states and baselines, checks and tier (#289).
- [`roadmap.md`](./roadmap.md) — where the product stands and what "a successful product" means as
  checkable targets (time to dashboard, alert speed and quality, adoption, security, release safety), approved
  by the owner on 2026-09-25 (ADR-0033).
- [`decisions/`](./decisions/README.md) — architecture decision records (ADR-0001 onward,
  from 2026-09-22): contract, errors, units, versioning, logging, storage, caching,
  login, the auto-pause toggle, deployment, target architecture, the item-form catalog,
  frontend UI architecture and the license. The README table lists every ADR (ADR-0025,
  Postgres and Google sign-in, is accepted; ADR-0026, the offline demo mode, is accepted; ADR-0027, production history and alerts, is
  accepted, and builds only after ADR-0025 gate A; ADR-0028, external uptime monitoring and a
  public status page, is accepted; ADR-0029, showing who is connected with minimal data, is accepted; ADR-0030, managing multiple servers, is accepted).
- [`architecture/`](./architecture/README.md) — D2 architecture diagrams (context, deployed
  containers, backend modules, target) with rendered SVGs and re-render instructions, and the
  [overview cards brief](./architecture/overview-cards.md) (Players, Tick rate, Health).
- [`legal/privacy-terms-outline.md`](./legal/privacy-terms-outline.md) — an outline (not the
  published policy, not legal advice) for the privacy policy and terms, with `[OWNER]`, `[LEGAL]`
  and `[BUILD]` markers; roadmap 2b, needed before ADR-0025 gate B.
