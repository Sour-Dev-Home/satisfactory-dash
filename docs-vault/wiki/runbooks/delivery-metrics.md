# Delivery metrics (#280)

`npm run delivery-metrics` prints DORA-style numbers and CI health for the repo from the GitHub API and the `log.d`
fragments. It shows **aggregates only**: no login, email, commit message, PR title, branch or SHA reaches the report. A
pull request node is read only in `normalizePr` and a workflow run only in `normalizeRun`; they keep numbers, dates and
booleans, plus commit SHAs as in-memory join keys that are never written out. The JSON is the body of the metrics page's
delivery ingest (ADR-0056 section 4) and must parse with `DeliverySnapshotSchema` in `packages/shared/src/metrics.ts`.

```
npm run delivery-metrics                        # last 30 days, markdown on stdout
npm run delivery-metrics -- --days 7 --json     # the JSON on stdout
npm run delivery-metrics -- --out <dir>         # writes delivery-metrics.json and delivery-metrics.md
```

Needs `gh` signed in (read access to pull requests, actions and contents). A 30-day run makes a few hundred `gh` calls and
takes a couple of minutes. The markdown is rendered from the JSON alone.

## The daily push (ADR-0056 PR 6d)

`.github/workflows/delivery-metrics.yml` runs the script once a day (06:41 UTC) and on dispatch, on `main` only, and
POSTs the JSON to the backend's ingest. It needs the owner-created environment `metrics-ingest` (deployment branches:
`main` only) holding the secret `METRICS_INGEST_SECRET` and the variable `METRICS_INGEST_URL`
(`https://api.satis-manager.com/api/internal/metrics/delivery`), and the backend's `METRICS_INGEST_SECRET_SHA256` set
to the secret's SHA-256 hex (`infra/aws`, PR 6c). With no secret the run builds the snapshot, prints a notice and stays
green. An unreachable backend, a 5xx or a 429 warns and stays green; a 400, 401, 404 or 413 fails the run (wrong
payload, secret, URL or an unset hash). To rotate: new secret in the environment and its hash in SSM, then redeploy.

## The JSON shape (`schemaVersion` 2)

| Key | Meaning |
| --- | --- |
| `schemaVersion`, `generatedAt`, `window` (`days`, `from`, `to`) | version, run time and the window (ISO-8601 UTC) |
| `throughput` | `mergedPrs`, `perDay`, `perWeek: [{ weekStart, merged }]` (weeks start Monday, UTC) |
| `leadTimeHours` | `median`, `p90`, `mean` of PR opened to merged; `null` when nothing merged |
| `size` | `medianLinesChanged` (additions plus deletions per merged PR) |
| `changeFailure` | `mainRuns`, `failedMainRuns`, `failureRate` (CI on push to main), `revertPrs`, `revertRate` |
| `ci` | `mainRuns`, `failedMainRuns`, `mainFailureRate` (the same main runs), `flakyRuns`, `flakeRate`, `prsMerged`, `prsBounced`, `bounceRate` |
| `logFragments` | `inWindow`: `log.d` fragments dated inside the window |

Version 1 had a `mergeQueue` section, dead since ADR-0043 removed the merge queue; version 2 drops it (ADR-0056). A change
to this shape bumps `schemaVersion` and the shared schema together. Every rate is `null` when its denominator is 0.
`scripts/delivery-metrics.test.mjs` asserts the output parses with the shared schema and holds no author, login, email,
name, title, branch, body, commit message or SHA, in keys or in values.

## Definitions and limits

- **Lead time** is PR created to merged, not first commit to merged; a PR opened as a draft counts from when it was opened.
- **Change failure** is a proxy: failed `ci.yml` runs on push to `main` (cancelled, skipped and still-running runs
  ignored) and merged PRs whose title starts with "Revert" (the title is tested and dropped, never stored).
- **Flaky run** (ADR-0056 section 4): a CI run whose head SHA has a failed attempt and a later successful attempt. CI runs
  are the runs of `ci.yml` and `e2e.yml` (the workflows behind the required checks), any event, created in the window,
  whose latest attempt succeeded or failed. Attempts (a run's re-runs and other runs of the same workflow on the same SHA)
  are ordered by start time; the first success after a failure marks its run flaky, so each workflow and SHA adds at most
  one. Failure means `failure`, `timed_out` or `startup_failure`. `flakeRate` = flaky runs / CI runs.
- **Bounced PR** (ADR-0056 section 4): a merged PR whose required checks failed at least once before the merge. The
  required check names come from `main`'s branch rules; a PR bounced when a check run with one of those names failed
  (any attempt) on one of its last 50 commits and completed before `mergedAt`. Check runs are looked up only for commits
  that had a failed `ci.yml` or `e2e.yml` attempt. `bounceRate` = bounced / merged PRs in the window.
- The PR list is read in pages ordered by last update and stops once a whole page was last updated before the window.
  Runs are read from the oldest merged PR's opening on, at most 5000 per workflow.
