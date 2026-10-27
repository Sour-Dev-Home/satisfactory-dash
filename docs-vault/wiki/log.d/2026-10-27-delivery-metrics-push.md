- 2026-10-27 — ADR-0056 PR 6d (#281): `.github/workflows/delivery-metrics.yml` pushes the delivery snapshot daily
  (06:41 UTC) and on dispatch, `main` only, in the owner-created `metrics-ingest` environment. It runs
  `scripts/delivery-metrics.mjs --days 30` with a read-only token (contents, actions, checks, pull-requests), puts the
  aggregates-only markdown in the job summary, and POSTs the JSON to `vars.METRICS_INGEST_URL` with the environment's
  `METRICS_INGEST_SECRET` as the bearer token, passed to curl on stdin so it is never in an argv or the log. No secret:
  a notice and a green run. Unreachable, 5xx or 429: a warning and a green run (ADR-0056's soft failure). 400, 401,
  404 or 413: a failed run. `runbooks/delivery-metrics.md` gains "The daily push".
