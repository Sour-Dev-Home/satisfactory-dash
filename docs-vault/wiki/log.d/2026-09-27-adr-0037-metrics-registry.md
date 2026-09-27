- 2026-09-27 — Backend: ADR-0037 PR 2, the fixed metric registry, `metrics.series_hourly` (migration
  `1791072000000_metrics.sql`), the 60 s flush and 90-day purge, and the first histogram wired up:
  `http.server.request.duration` (route pattern, status class). `backend/src/platform/metrics/`:
  `registry.ts` (9 metrics from ADR-0037 §1, closed-set labels, `validateRecording` refuses an
  unknown metric or an out-of-set label), `histogramBuckets.ts` (13 fixed millisecond buckets),
  `aggregator.ts` (in-process accumulation; `drain()` is what makes a flush idempotent — a spurious
  extra flush with nothing new since the last one writes nothing), `seriesHourlyRepository.ts`
  (additive upsert via the migration's `metrics.merge_bucket_counts` SQL function, batched purge),
  `seriesFlushWorker.ts` (the background worker, wired into `server.ts`'s `databaseWorkers`),
  `requestMetrics.ts` (the Express middleware, mounted in `app.ts` after `requestTiming()`; skips
  requests with no matched route rather than recording an open-ended label; a recording failure is
  caught and logged, never left to crash a `res.on("finish")` listener). `requestContext.ts`'s route-
  pattern helper is now exported and reused, so the metric's "route" label is exactly what the
  request log already uses, never a URL. `db.test.ts` covers the SQL merge function's element-wise
  math and the upsert's additive behaviour against a real Postgres.
