# Delivery metrics (#280)

`npm run delivery-metrics` prints DORA-style numbers for the repo from the GitHub API and the `log.d` fragments. It shows
**aggregates only**: no login, email, commit message, PR title or SHA is ever read into the report (the one place a pull
request node is read is `normalizePr`, which keeps only numbers, dates, booleans and a short slug), so the output is safe
to commit and to feed a public metrics page later (#281, designed by the architect first).

```
npm run delivery-metrics                        # last 30 days, markdown on stdout
npm run delivery-metrics -- --days 7 --json     # the JSON on stdout
npm run delivery-metrics -- --out <dir>         # writes delivery-metrics.json and delivery-metrics.md
```

Needs `gh` signed in. The markdown is rendered from the JSON alone.

## The JSON shape (stable, `schemaVersion` 1)

| Key | Meaning |
| --- | --- |
| `schemaVersion`, `generatedAt`, `window` (`days`, `from`, `to`) | version, run time and the window (ISO-8601 UTC) |
| `throughput` | `mergedPrs`, `perDay`, `perWeek: [{ weekStart, merged }]` (weeks start Monday, UTC) |
| `leadTimeHours` | `median`, `p90`, `mean` of PR opened to merged; `null` when nothing merged |
| `size` | `medianLinesChanged` (additions plus deletions per merged PR) |
| `mergeQueue` | kept so the shape stays stable (`schemaVersion` 1) and not shown in the markdown; it fills only from merged PRs that went through the old merge queue (removed by ADR-0043), so it empties once those leave the window |
| `changeFailure` | `mainRuns`, `failedMainRuns`, `failureRate` (CI on push to main), `revertPrs`, `revertRate` |
| `logFragments` | `inWindow`: `log.d` fragments dated inside the window |

A change to this shape bumps `schemaVersion`. `scripts/delivery-metrics.test.mjs` asserts the output holds no author, login,
email, name, title, branch or body, in keys or in values.

## Definitions and limits

- **Lead time** is PR created to merged, not first commit to merged; a PR opened as a draft counts from when it was opened.
- **Change failure** is a proxy: failed CI runs on push to `main` (cancelled, skipped and still-running runs ignored, the
  last 300 runs) and merged PRs whose title starts with "Revert" (the title is tested and dropped, never stored).
- The PR list is read in pages ordered by last update and stops once a whole page was last updated before the window.
