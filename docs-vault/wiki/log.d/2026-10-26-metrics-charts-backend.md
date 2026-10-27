## [2026-10-26] feat | Metrics charts backend (ADR-0056 amendment, A2)

`GET /api/admin/metrics` now fills the optional `charts` section. Two new reads over `metrics.series_hourly`
(`metrics.histogramHourly`, folded in SQL to `status_class` and `api`, one bucket array per hour; `metrics.counterHourly`)
and one over the alert log (`alerts.firedByHour`, exported as `alertsFiredHourly` from the alerts module) cover the trend
and the previous window in one range. `modules/metrics/metricsCharts.ts` folds them: a fixed-length hourly axis ending
at the current hour (25 points, 169 for 7d), per-hour bucket-bound percentiles (10000 above the last bucket, `null`
with no data), request counts `null` for an hour with no request rows, `1xx` in latency but not in the class counts, and
the headline for the window and the one before it from summed buckets. The three query names are registered.
