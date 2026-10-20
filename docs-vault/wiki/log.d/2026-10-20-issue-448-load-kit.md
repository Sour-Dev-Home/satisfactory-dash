- 2026-10-20 — ADR-0037 step 5: the k6 load kit, local stack only (#448). `backend/scripts/load-seed.ts --servers N
  --users M` seeds a `_load` database through the real code paths (server rows and memberships through the servers
  repositories, users and sessions through `startSession`, and one agent per server through the real enrolment-code and
  enrol routes, waiting out each 429) and writes the credentials to the git-ignored `load/.data/seed.json`. The k6
  scenarios `load/a-baseline.js`, `load/b-target.js` and `load/c-knee.js` run agents at the real cadence (5 s status and
  power, 30 s factory) and users polling as the Overview does; thresholds are report-only. The guards live in
  `load/lib/guards.mjs` with tests in `load/test/`: the seed needs `LOAD_TEST=1` and a database name ending in `_load`,
  every target but `127.0.0.1`, `localhost` and `backend` is refused with no override (the ADR's
  `TARGET=aws-precutover` is not implemented, owner decision 2026-10-19), and the payloads are the shared agent
  snapshot fixtures, sealed with a checksum. `scripts/load-report.mjs` turns k6's JSON output and the run's
  `metrics.series_hourly` rows into `docs-vault/wiki/perf/<date>-<scenario>.md` with SVG charts (latency per minute;
  the knee curve for c). New runbook `runbooks/load-testing.md`. CI gains a `load-smoke` job (scenario a for a minute on
  a `satis_load` database, k6 2.3.0 via `grafana/setup-k6-action` v1.2.2 pinned to its commit, report-only).
