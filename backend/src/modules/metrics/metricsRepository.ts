import { z } from "zod";
import { parseRows } from "../../platform/db/rows.js";
import { timedQuery } from "../../platform/db/timedQuery.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";

/**
 * ADR-0056 section 2 and 7: the read path over `metrics.series_hourly`. Both queries read the PK range on `hour` for one
 * window of at most 7 days (series count x 168 rows at most), then group in SQL, so the rows that come back are small.
 * Trigger for more (an index on `(metric, hour)` or a daily rollup): the endpoint's p95 over 300 ms, or either query's
 * p95 over 100 ms, in `db.client.operation.duration` under these two query names.
 */

// SQL constants are plain templates without interpolation (the SQL guard rejects "+" and ${}).
// The bucket arrays are summed element-wise per (metric, labels) across the hours; `labels` still carries `server`
// (the service folds it away and picks the worst servers).
const HISTOGRAM_BUCKETS = `
  SELECT s.metric, s.labels, b.ord::int AS ord, sum(b.n)::float8 AS n
  FROM metrics.series_hourly s
  CROSS JOIN LATERAL unnest(s.bucket_counts) WITH ORDINALITY AS b(n, ord)
  WHERE s.hour >= $1::timestamptz AND s.hour <= $2::timestamptz AND s.bucket_counts IS NOT NULL
  GROUP BY s.metric, s.labels, b.ord`;

const COUNTER_TOTALS = `
  SELECT metric, labels, sum(sum)::float8 AS total
  FROM metrics.series_hourly
  WHERE hour >= $1::timestamptz AND hour <= $2::timestamptz AND bucket_counts IS NULL
  GROUP BY metric, labels`;

const LabelsSchema = z.record(z.string(), z.unknown());
const HistogramRowSchema = z.object({ metric: z.string(), labels: LabelsSchema, ord: z.number().int().min(1), n: z.coerce.number() });
const CounterRowSchema = z.object({ metric: z.string(), labels: LabelsSchema, total: z.coerce.number() });

/** One series' bucket counts summed over the window; `labels` values are untrusted strings until the contract checks them. */
export interface HistogramSeries {
  metric: string;
  labels: Map<string, string>;
  buckets: number[];
}
export interface CounterSeries {
  metric: string;
  labels: Map<string, string>;
  total: number;
}

/** Label values are strings by the registry; anything else in a stored row is dropped, never coerced. */
function labelMap(raw: Record<string, unknown>): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") labels.set(key, value);
  }
  return labels;
}

const BUCKET_WIDTH = 13;

/** The window is `[from, to]` on the hour column; the hour that holds `to` is the current partial one. */
export async function readHistogramSeries(db: Queryable, from: Date, to: Date): Promise<HistogramSeries[]> {
  const result = await timedQuery(db, "metrics.histogramBuckets", HISTOGRAM_BUCKETS, [from, to]);
  const rows = parseRows(HistogramRowSchema, result.rows, "metrics.histogramBuckets");
  const byKey = new Map<string, HistogramSeries>();
  for (const row of rows) {
    if (row.ord > BUCKET_WIDTH) continue;
    const key = JSON.stringify([row.metric, Object.entries(row.labels).sort(([a], [b]) => (a < b ? -1 : 1))]);
    let series = byKey.get(key);
    if (!series) {
      series = { metric: row.metric, labels: labelMap(row.labels), buckets: Array.from({ length: BUCKET_WIDTH }, () => 0) };
      byKey.set(key, series);
    }
    series.buckets[row.ord - 1] += row.n;
  }
  return [...byKey.values()];
}

// The charts' hourly reads (ADR-0056 amendment 2026-10-26, section 7): the same PK range on `hour`, filtered to the trend
// metrics, folded in SQL down to the two labels the charts keep (`status_class`, `api`; '' when absent). Buckets are
// summed per ordinal, then put back into one array per (hour, metric, status_class, api): at most about 9 histogram
// series x 337 hours of rows.
const HISTOGRAM_HOURLY = `
  WITH b AS (
    SELECT s.hour, s.metric,
           coalesce(s.labels->>'status_class', '') AS status_class,
           coalesce(s.labels->>'api', '') AS api,
           u.ord, sum(u.n)::float8 AS n
    FROM metrics.series_hourly s
    CROSS JOIN LATERAL unnest(s.bucket_counts) WITH ORDINALITY AS u(n, ord)
    WHERE s.hour >= $1::timestamptz AND s.hour <= $2::timestamptz AND s.bucket_counts IS NOT NULL
      AND s.metric = ANY($3::text[])
    GROUP BY s.hour, s.metric, status_class, api, u.ord)
  SELECT hour, metric, status_class, api, array_agg(n ORDER BY ord) AS buckets
  FROM b
  GROUP BY hour, metric, status_class, api`;

const COUNTER_HOURLY = `
  SELECT hour, metric, sum(sum)::float8 AS total
  FROM metrics.series_hourly
  WHERE hour >= $1::timestamptz AND hour <= $2::timestamptz AND bucket_counts IS NULL AND metric = ANY($3::text[])
  GROUP BY hour, metric`;

const HourlyHistogramRowSchema = z.object({
  hour: z.coerce.date(),
  metric: z.string(),
  status_class: z.string(),
  api: z.string(),
  buckets: z.array(z.coerce.number()),
});
const HourlyCounterRowSchema = z.object({ hour: z.coerce.date(), metric: z.string(), total: z.coerce.number() });

/** One hour of one histogram metric, folded to the labels the charts keep. */
export interface HourlyHistogram {
  hourMs: number;
  metric: string;
  statusClass: string;
  api: string;
  buckets: number[];
}
export interface HourlyCounter {
  hourMs: number;
  metric: string;
  total: number;
}

export async function readHourlyHistograms(db: Queryable, from: Date, to: Date, metrics: readonly string[]): Promise<HourlyHistogram[]> {
  const result = await timedQuery(db, "metrics.histogramHourly", HISTOGRAM_HOURLY, [from, to, [...metrics]]);
  return parseRows(HourlyHistogramRowSchema, result.rows, "metrics.histogramHourly")
    .filter((row) => row.buckets.length === BUCKET_WIDTH)
    .map((row) => ({ hourMs: row.hour.getTime(), metric: row.metric, statusClass: row.status_class, api: row.api, buckets: row.buckets }));
}

export async function readHourlyCounters(db: Queryable, from: Date, to: Date, metrics: readonly string[]): Promise<HourlyCounter[]> {
  const result = await timedQuery(db, "metrics.counterHourly", COUNTER_HOURLY, [from, to, [...metrics]]);
  return parseRows(HourlyCounterRowSchema, result.rows, "metrics.counterHourly").map((row) => ({
    hourMs: row.hour.getTime(),
    metric: row.metric,
    total: row.total,
  }));
}

export async function readCounterSeries(db: Queryable, from: Date, to: Date): Promise<CounterSeries[]> {
  const result = await timedQuery(db, "metrics.counterTotals", COUNTER_TOTALS, [from, to]);
  return parseRows(CounterRowSchema, result.rows, "metrics.counterTotals").map((row) => ({
    metric: row.metric,
    labels: labelMap(row.labels),
    total: row.total,
  }));
}
