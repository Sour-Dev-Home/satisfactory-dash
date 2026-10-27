- 2026-10-26 — ADR-0056 amendment, step A3: the metrics page is chart-led and the operator gets a "Metrics" nav tab.
  The page now opens on a headline stat row (requests per hour, 5xx error rate, request, poll-lag and agent-lag p95,
  alerts fired, refused and dropped) compared with the window before: a percent per hour for counts and rates, the
  bucket step for percentiles ("≤ 200 ms, was ≤ 100 ms"), "No comparison" from a missing or zero baseline, and a worse
  change says "worse" with an icon. Each tile has an aria-hidden SVG sparkline. Below it, seven hourly trend charts
  (requests by status class stacked with 5xx on the baseline in the problem colour, request p50/p95/p99, game-server
  calls, database, poll and agent lag, refused/dropped, alerts fired) come from one lazy uPlot chunk
  (`metrics/TrendChart.tsx`): timings on a fixed log scale with the over value on a shaded "> 5 s" band, null hours as
  gaps, local time, a one-line text summary per chart. The old tables stay as closed `<details>` under the matching
  charts, the text path; without `charts` the row says "Charts not available yet" and the Details still render. New
  colour tokens `--color-series-1..5` and `--color-ramp-1..3`, validated with the dataviz palette validator against
  `--color-surface`. `visibleTabs` shows Metrics after Servers whenever `canManageServers` (no more demo-only default).
  The demo world draws its own day and week, with one bad hour and, in the week, a deploy gap; MSW's default metrics
  answer carries the fixture charts, a new `metrics-no-charts` scenario covers an older backend, and new e2e cases open
  every Details (axe) and gate the chart chunk under the CSP (`e2e/metrics-charts.spec.ts`).
