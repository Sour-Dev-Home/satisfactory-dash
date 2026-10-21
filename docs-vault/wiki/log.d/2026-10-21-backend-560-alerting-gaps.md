- 2026-10-21 — #560 (OWASP A09/A10 alerting gaps). Background workers (alert evaluator and delivery, command sweeper,
  history maintenance, metrics flush, pending-server sweeper, session and audit purge) now share
  `platform/failureStreak.ts`: warn once when a streak starts, ONE `error` (`code: WORKER_FAILING`, `job`, `failures`)
  once it spans about five minutes at the worker's interval (at least 2 failures), recovery `info` when it ends. The
  alert evaluator logs an hourly `alert evaluator heartbeat` of counts (ticks, servers, rules, muted servers, events).
  `server.ts` installs `uncaughtException` / `unhandledRejection` handlers (`platform/fatalHandlers.ts`: one JSON `fatal`
  line with an allowlist of the error's fields (detail string, name, stack, never its own properties), flush, exit 1);
  the edge agent gets the same with a no-detail stderr line (`agent/src/fatal.ts`). Terraform adds
  two log metric filters and alarms to the existing SNS topic: `backend-critical` (one fatal or `WORKER_FAILING` line in
  5 minutes; a single such line stays under `backend-errors`' threshold of 5) and `auth-failures` (20 failed or refused
  sign-ins in each of two 5-minute periods, ALARM mail only, rate-limited logins not counted), thresholds in the `alarms` variable. Runbooks `aws.md` and `owasp-top-10-check.md` updated.
