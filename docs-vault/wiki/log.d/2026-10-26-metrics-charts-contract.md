## [2026-10-26] feat | Metrics charts contract (ADR-0056 amendment, PR A1)

ADR-0056 amended for the owner's 2026-10-26 decisions: a chart-led metrics page (golden signals / RED, Grafana's stat
row then trends then detail, DORA Four Keys, drawn with uPlot) and an operator-only "Metrics" nav tab. The contract
(`packages/shared/src/metrics.ts`) gains an optional `charts` section: a fixed set of hourly trends folded across
servers (requests by status class, request p50/p95/p99, game-server, DB, poll and agent lag p95, refused/dropped
counters, alerts fired) on one axis, and headline numbers for the window and the one before. New exports
`MetricsChartsSectionSchema`, `MetricsTrendSchema`, `MetricsHeadlineSchema`, `METRICS_TREND_OVER_MS`,
`METRICS_TREND_MAX_POINTS`, `metricsTrendPoints`; fixtures `metricsChartsDay`, `metricsChartsWeekFull`,
`metricsOverviewWithCharts`. Additive: nothing existing changes; the backend fills it in A2 and the page draws it in A3.
