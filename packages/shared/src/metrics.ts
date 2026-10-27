import { z } from "zod";

/**
 * ADR-0056 PR 2 (amends ADR-0036): the metrics page's contract. `GET /api/admin/metrics?window=1h|24h|7d` answers the
 * operator (and only the operator) with a `MetricsOverview`; `POST /api/internal/metrics/delivery` takes the daily
 * delivery snapshot (`DeliverySnapshot`, the delivery script's JSON at schemaVersion 2).
 *
 * - Every section either has data (`available: true`, with `asOf`) or says why not (`available: false`, with a reason).
 * - Percentiles are bucket UPPER BOUNDS ("p95 <= 200 ms"), never interpolated: the stored buckets are coarse. `null`
 *   means the percentile fell in the open-ended last bucket, which the page shows as "> 5 s" (`METRICS_LAST_BUCKET_MS`).
 * - Per-server labels are folded away in `histograms`/`counters` (all servers combined); `servers` carries the worst
 *   few per metric, by public id only, never a display name, owner or member.
 * - A newer backend only adds fields; these response objects are not strict, so an older frontend still parses them.
 * - `charts` (ADR-0056 amendment 2026-10-26, PR A1): hourly trends and headline numbers for the chart-led page;
 *   optional, so the newer frontend still parses an older backend.
 */

/** The largest finite bucket bound the registry records, in ms; `null` percentiles mean "above this". */
export const METRICS_LAST_BUCKET_MS = 5000;
/** At most this many servers per metric in `servers`. */
export const METRICS_WORST_SERVERS_PER_METRIC = 5;

export const METRICS_WINDOWS = ["1h", "24h", "7d"] as const;
export const MetricsWindowSchema = z.enum(METRICS_WINDOWS);
export type MetricsWindow = z.infer<typeof MetricsWindowSchema>;

/** The query string; optional, so a bare GET works. An unknown window is a 400 on the backend. */
export const MetricsQuerySchema = z.object({ window: MetricsWindowSchema.default("24h") });
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

const IsoTimeSchema = z.iso.datetime({ offset: true });

// A label key is a registry key (snake_case); a value is a closed-set token or a route pattern: no whitespace and no
// `@` (so an address or a free-text value can never ride along), at most 200 characters.
const LabelKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const LabelValueSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\s@]+$/, "no whitespace or @");
/** Label name to value. A Map-like record: the keys come from the registry, but the schema still refuses odd ones. */
export const MetricLabelsSchema = z.record(LabelKeySchema, LabelValueSchema);
export type MetricLabels = z.infer<typeof MetricLabelsSchema>;

const MetricNameSchema = z.string().regex(/^[a-z][a-z0-9_.]{0,127}$/);
const MsSchema = z.number().nonnegative();

/** A bucket upper bound in ms, or `null` for "above `METRICS_LAST_BUCKET_MS`". */
const BucketBoundSchema = MsSchema.max(METRICS_LAST_BUCKET_MS).nullable();

const percentiles = {
  p50Ms: BucketBoundSchema,
  p95Ms: BucketBoundSchema,
  p99Ms: BucketBoundSchema,
};

/** Percentiles must not run backwards: p50 <= p95 <= p99, with `null` (above everything) the largest. */
const rank = (v: number | null) => (v === null ? Number.POSITIVE_INFINITY : v);
const percentilesInOrder = (v: { p50Ms: number | null; p95Ms: number | null; p99Ms: number | null }) =>
  rank(v.p50Ms) <= rank(v.p95Ms) && rank(v.p95Ms) <= rank(v.p99Ms);
const ORDER_MESSAGE = "p50 <= p95 <= p99";

export const HistogramSummarySchema = z
  .object({
    metric: MetricNameSchema,
    labels: MetricLabelsSchema,
    count: z.number().int().nonnegative(),
    ...percentiles,
  })
  .refine(percentilesInOrder, ORDER_MESSAGE);
export type HistogramSummary = z.infer<typeof HistogramSummarySchema>;

export const CounterSummarySchema = z.object({
  metric: MetricNameSchema,
  labels: MetricLabelsSchema,
  total: z.number().nonnegative(),
});
export type CounterSummary = z.infer<typeof CounterSummarySchema>;

/** One of the worst servers for a metric: the server's PUBLIC ID only (never a name, owner or member). */
const ServerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const HistogramServerSchema = z
  .object({
    kind: z.literal("histogram"),
    metric: MetricNameSchema,
    server: ServerIdSchema,
    labels: MetricLabelsSchema,
    count: z.number().int().nonnegative(),
    ...percentiles,
  })
  .refine(percentilesInOrder, ORDER_MESSAGE);
const CounterServerSchema = z.object({
  kind: z.literal("counter"),
  metric: MetricNameSchema,
  server: ServerIdSchema,
  labels: MetricLabelsSchema,
  total: z.number().nonnegative(),
});
export const ServerMetricSummarySchema = z.discriminatedUnion("kind", [HistogramServerSchema, CounterServerSchema]);
export type ServerMetricSummary = z.infer<typeof ServerMetricSummarySchema>;

/** Why a section has no data: not built yet, built but nothing recorded in the window, or switched off by config. */
export const METRICS_UNAVAILABLE_REASONS = ["not_built", "no_data", "not_configured"] as const;
export const MetricsUnavailableReasonSchema = z.enum(METRICS_UNAVAILABLE_REASONS);
export type MetricsUnavailableReason = z.infer<typeof MetricsUnavailableReasonSchema>;

/** `Section<T>`: the section's data (with when it was computed) or the reason there is none. */
const section = <T extends z.ZodRawShape>(data: T) =>
  z.discriminatedUnion("available", [
    z.object({ available: z.literal(true), asOf: IsoTimeSchema, ...data }),
    z.object({ available: z.literal(false), reason: MetricsUnavailableReasonSchema }),
  ]);

/** System: latency, lag, throughput and the refused/dropped counters, all servers combined, plus the worst servers. */
export const MetricsSystemSectionSchema = section({
  histograms: z.array(HistogramSummarySchema),
  counters: z.array(CounterSummarySchema),
  servers: z.array(ServerMetricSummarySchema),
}).superRefine((value, ctx) => {
  if (!value.available) return;
  const perMetric = new Map<string, number>();
  for (const row of value.servers) {
    const key = `${row.kind}:${row.metric}`;
    const n = (perMetric.get(key) ?? 0) + 1;
    perMetric.set(key, n);
    if (n === METRICS_WORST_SERVERS_PER_METRIC + 1) {
      ctx.addIssue({ code: "custom", message: `at most ${METRICS_WORST_SERVERS_PER_METRIC} servers per metric`, path: ["servers"] });
    }
  }
});

/**
 * One calendar month and rule kind of alert quality, over all servers (no server id). Phase 1 (ADR-0056 Q4): `flaps`
 * (fired, then resolved within 5 minutes) is a LABELLED STAND-IN for false alarms until the review flow (ADR-0036 D4).
 */
export const AlertQualityMonthSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    kind: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).describe("A rule kind; open-ended on purpose (see alerts.ts, deploy skew)"),
    fired: z.number().int().nonnegative(),
    flaps: z.number().int().nonnegative(),
    medianResolveSeconds: z.number().nonnegative().nullable().describe("null when none resolved"),
  })
  .refine((v) => v.flaps <= v.fired, "flaps cannot exceed fired");
export type AlertQualityMonth = z.infer<typeof AlertQualityMonthSchema>;

export const MetricsAlertsSectionSchema = section({ months: z.array(AlertQualityMonthSchema) });

const nullableNumber = z.number().nonnegative().nullable();
const rate = z.number().min(0).max(1).nullable().describe("null when the denominator is 0");

/**
 * The delivery script's JSON at schemaVersion 2 (ADR-0056 section 4): `mergeQueue` is gone, `ci` is new. Aggregates only,
 * so no login, title or SHA field exists, and the schema is strict to keep it that way.
 */
export const DeliverySnapshotSchema = z.strictObject({
  schemaVersion: z.literal(2),
  generatedAt: IsoTimeSchema,
  window: z.strictObject({ days: z.number().int().positive(), from: IsoTimeSchema, to: IsoTimeSchema }),
  throughput: z.strictObject({
    mergedPrs: z.number().int().nonnegative(),
    perDay: z.number().nonnegative(),
    perWeek: z.array(z.strictObject({ weekStart: IsoTimeSchema, merged: z.number().int().nonnegative() })),
  }),
  leadTimeHours: z.strictObject({ median: nullableNumber, p90: nullableNumber, mean: nullableNumber }),
  size: z.strictObject({ medianLinesChanged: nullableNumber }),
  changeFailure: z.strictObject({
    mainRuns: z.number().int().nonnegative(),
    failedMainRuns: z.number().int().nonnegative(),
    failureRate: rate,
    revertPrs: z.number().int().nonnegative(),
    revertRate: rate,
  }),
  ci: z.strictObject({
    mainRuns: z.number().int().nonnegative(),
    failedMainRuns: z.number().int().nonnegative(),
    mainFailureRate: rate,
    flakyRuns: z.number().int().nonnegative(),
    flakeRate: rate,
    prsMerged: z.number().int().nonnegative(),
    prsBounced: z.number().int().nonnegative(),
    bounceRate: rate,
  }),
  logFragments: z.strictObject({ inWindow: z.number().int().nonnegative() }),
});
export type DeliverySnapshot = z.infer<typeof DeliverySnapshotSchema>;

export const MetricsDeliverySectionSchema = section({ snapshot: DeliverySnapshotSchema });

/**
 * Charts (ADR-0056 amendment 2026-10-26): a fixed set of hourly trends, folded across servers, routes, groups and
 * queries, on one axis (`from`, on the hour, then `points` hours), plus the headline numbers for the window and the
 * same-length window before it. In a trend a percentile is a bucket upper bound, `METRICS_TREND_OVER_MS` for "above
 * the last bucket", and `null` for an hour with no data (charts draw a gap). Counters are 0 for a quiet hour; request
 * counts are `null` for an hour with no row, so a backend outage shows as a gap, not as zero traffic.
 */
export const METRICS_TREND_OVER_MS = 2 * METRICS_LAST_BUCKET_MS;
/** 7 days of hours plus the partial current one. */
export const METRICS_TREND_MAX_POINTS = 169;
/** The trend's length per window: at least a day, so the 1h window still has a usable chart. */
export const metricsTrendPoints = (window: MetricsWindow) => (window === "7d" ? METRICS_TREND_MAX_POINTS : 25);

const TrendMsSchema = z
  .number()
  .refine((v) => v === METRICS_TREND_OVER_MS || (v >= 0 && v <= METRICS_LAST_BUCKET_MS), "a bucket bound or the over value")
  .nullable();
const CountSchema = z.number().int().nonnegative();
const countSeries = z.array(CountSchema).max(METRICS_TREND_MAX_POINTS);
const requestSeries = z.array(CountSchema.nullable()).max(METRICS_TREND_MAX_POINTS);
const msSeries = z.array(TrendMsSchema).max(METRICS_TREND_MAX_POINTS);

export const MetricsTrendSchema = z
  .object({
    from: IsoTimeSchema.refine((v) => {
      const d = new Date(v);
      return d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
    }, "on the hour"),
    points: z.number().int().min(1).max(METRICS_TREND_MAX_POINTS),
    requests: z.object({ c2xx: requestSeries, c3xx: requestSeries, c4xx: requestSeries, c5xx: requestSeries }),
    requestMs: z.object({ p50: msSeries, p95: msSeries, p99: msSeries }),
    upstreamP95Ms: z.object({ vanilla: msSeries, frm: msSeries }),
    dbP95Ms: msSeries,
    pollLagP95Ms: msSeries,
    agentLagP95Ms: msSeries,
    agentRefused: countSeries,
    signupRefused: countSeries,
    historyRowsDropped: countSeries,
    alertEventsDropped: countSeries,
    pushDropped: countSeries,
    alertsFired: countSeries,
  })
  .superRefine((t, ctx) => {
    const series: [string, readonly unknown[]][] = [
      ...Object.entries(t.requests).map(([k, v]) => [`requests.${k}`, v] as [string, readonly unknown[]]),
      ...Object.entries(t.requestMs).map(([k, v]) => [`requestMs.${k}`, v] as [string, readonly unknown[]]),
      ...Object.entries(t.upstreamP95Ms).map(([k, v]) => [`upstreamP95Ms.${k}`, v] as [string, readonly unknown[]]),
      ["dbP95Ms", t.dbP95Ms],
      ["pollLagP95Ms", t.pollLagP95Ms],
      ["agentLagP95Ms", t.agentLagP95Ms],
      ["agentRefused", t.agentRefused],
      ["signupRefused", t.signupRefused],
      ["historyRowsDropped", t.historyRowsDropped],
      ["alertEventsDropped", t.alertEventsDropped],
      ["pushDropped", t.pushDropped],
      ["alertsFired", t.alertsFired],
    ];
    for (const [name, values] of series) {
      if (values.length !== t.points) ctx.addIssue({ code: "custom", message: `${name} has ${values.length} points, not ${t.points}` });
    }
    // Per hour, p50 <= p95 <= p99 where both are known (the over value is the largest number, so it ranks last).
    const ordered = (x: number | null, y: number | null) => x === null || y === null || x <= y;
    for (let i = 0; i < t.points; i++) {
      const [a, b, c] = [t.requestMs.p50[i] ?? null, t.requestMs.p95[i] ?? null, t.requestMs.p99[i] ?? null];
      if (!ordered(a, b) || !ordered(b, c) || !ordered(a, c)) {
        ctx.addIssue({ code: "custom", message: `${ORDER_MESSAGE} at point ${i}` });
        break;
      }
    }
  });
export type MetricsTrend = z.infer<typeof MetricsTrendSchema>;

/** One window's headline numbers. Percentiles come from the window's summed buckets (hourly ones cannot be merged). */
export const MetricsHeadlineSchema = z
  .object({
    /** Hours the window covers (fractional for the partial current hour), so per-hour rates are exact. */
    hours: z.number().positive(),
    requests: CountSchema.nullable(),
    /** 5xx answers: the error-rate numerator. 4xx is client behaviour and only shows in the trend. */
    serverErrors: CountSchema.nullable(),
    requestP95Ms: TrendMsSchema,
    pollLagP95Ms: TrendMsSchema,
    agentLagP95Ms: TrendMsSchema,
    alertsFired: CountSchema,
    /** The five refused/dropped counters summed. */
    refusedAndDropped: CountSchema,
  })
  .refine((v) => v.requests === null || (v.serverErrors ?? 0) <= v.requests, "serverErrors <= requests");
export type MetricsHeadline = z.infer<typeof MetricsHeadlineSchema>;

export const MetricsChartsSectionSchema = section({
  headline: z.object({ current: MetricsHeadlineSchema, previous: MetricsHeadlineSchema }),
  trend: MetricsTrendSchema,
});
export type MetricsChartsSection = z.infer<typeof MetricsChartsSectionSchema>;

export const MetricsOverviewSchema = z
  .object({
    generatedAt: IsoTimeSchema,
    window: MetricsWindowSchema,
    system: MetricsSystemSectionSchema,
    alerts: MetricsAlertsSectionSchema,
    delivery: MetricsDeliverySectionSchema,
    /** Optional: a frontend that meets an older backend during a deploy still parses (ADR-0007). */
    charts: MetricsChartsSectionSchema.optional(),
    links: z.object({ statusPage: z.httpUrl(), probeRuns: z.httpUrl() }),
  })
  .refine(
    (v) => !v.charts?.available || v.charts.trend.points === metricsTrendPoints(v.window),
    "the trend's length matches the window",
  );
export type MetricsOverview = z.infer<typeof MetricsOverviewSchema>;

/** POST /api/internal/metrics/delivery: the ingest acknowledgement (the body is a `DeliverySnapshot`). */
export const DeliveryIngestResponseSchema = z.object({ ok: z.literal(true) });
export type DeliveryIngestResponse = z.infer<typeof DeliveryIngestResponseSchema>;
