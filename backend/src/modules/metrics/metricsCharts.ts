import { METRICS_TREND_OVER_MS, MetricsChartsSectionSchema, metricsTrendPoints } from "@satisfactory-dash/shared";
import type { MetricsChartsSection, MetricsHeadline, MetricsTrend, MetricsWindow } from "@satisfactory-dash/shared";
import { BUCKET_BOUNDS_MS } from "../../platform/metrics/histogramBuckets.js";
import type { HourlyCounter, HourlyHistogram } from "./metricsRepository.js";
import { bucketTotal, percentileUpperBound } from "./percentiles.js";

/**
 * The metrics page's charts (ADR-0056 amendment 2026-10-26): a fixed set of hourly trends on one axis, and the
 * headline numbers for the window and the same-length window before it. Pure: the service reads the rows, this folds
 * them. Request counts are `null` for an hour with no request rows (a gap, not zero traffic); counters are 0 when quiet.
 * `1xx` answers count toward latency but not toward the per-class counts (the contract carries 2xx to 5xx).
 */

const HOUR_MS = 60 * 60 * 1000;

export const REQUEST = "http.server.request.duration";
export const UPSTREAM = "http.server.upstream.duration";
export const DB = "db.client.operation.duration";
export const POLL_LAG = "satis.poller.lag";
export const AGENT_LAG = "satis.agent.ingest.lag";
export const TREND_HISTOGRAMS = [REQUEST, UPSTREAM, DB, POLL_LAG, AGENT_LAG] as const;

/** The five refused/dropped counters, in the trend's field order. */
const COUNTER_FIELDS = [
  ["agentRefused", "satis.agent.refused"],
  ["signupRefused", "satis.signup.refused"],
  ["historyRowsDropped", "satis.history.rows_dropped"],
  ["alertEventsDropped", "satis.alerts.events_dropped"],
  ["pushDropped", "satis.alerts.push.dropped"],
] as const;
export const TREND_COUNTERS = COUNTER_FIELDS.map(([, metric]) => metric);

const CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const;

const floorHour = (ms: number) => Math.floor(ms / HOUR_MS) * HOUR_MS;

/**
 * The hours the charts need. The trend ends at the current (partial) hour and has a fixed number of points; the
 * headline compares the window with the same-length window before it, on the same hour-floored bounds the overview's
 * tables use. `rangeFrom` covers both, for the one hourly read.
 */
export function chartsBounds(window: MetricsWindow, lengthMs: number, nowMs: number) {
  const points = metricsTrendPoints(window);
  const trendFrom = floorHour(nowMs) - (points - 1) * HOUR_MS;
  const currentFrom = floorHour(nowMs - lengthMs);
  const previousFrom = floorHour(nowMs - 2 * lengthMs);
  return { points, trendFrom, currentFrom, previousFrom, rangeFrom: Math.min(trendFrom, previousFrom) };
}

/** A trend or headline percentile: the bucket bound, the over value above the last bucket, `null` with no data. */
function trendPercentile(buckets: readonly number[] | undefined, q: number): number | null {
  if (!buckets) return null;
  const p = percentileUpperBound(buckets, q);
  if (p === undefined) return null;
  return p === null ? METRICS_TREND_OVER_MS : p;
}

function addInto(into: Map<number, number[]>, key: number, buckets: readonly number[]) {
  const existing = into.get(key);
  if (existing) buckets.forEach((n, i) => (existing[i] += n));
  else into.set(key, [...buckets]);
}

function sumBuckets(byHour: ReadonlyMap<number, number[]>, from: number, to: number): number[] | undefined {
  let out: number[] | undefined;
  for (const [hour, buckets] of byHour) {
    if (hour < from || hour >= to) continue;
    if (!out) out = Array.from({ length: BUCKET_BOUNDS_MS.length }, () => 0);
    buckets.forEach((n, i) => (out![i] += n));
  }
  return out;
}

export interface ChartsInput {
  window: MetricsWindow;
  lengthMs: number;
  nowMs: number;
  histograms: readonly HourlyHistogram[];
  counters: readonly HourlyCounter[];
  /** Fired alerts per hour start (ms). */
  fired: ReadonlyMap<number, number>;
}

export function buildCharts(input: ChartsInput): MetricsChartsSection {
  const { points, trendFrom, currentFrom, previousFrom } = chartsBounds(input.window, input.lengthMs, input.nowMs);
  const generatedAt = new Date(input.nowMs).toISOString();

  // Per metric (and per class or upstream where kept), the summed buckets of each hour.
  const requestAll = new Map<number, number[]>();
  const requestClass = new Map<string, Map<number, number>>(CLASSES.map((c) => [c, new Map()]));
  const upstream = new Map<string, Map<number, number[]>>([
    ["vanilla", new Map()],
    ["frm", new Map()],
  ]);
  const plain = new Map<string, Map<number, number[]>>([
    [DB, new Map()],
    [POLL_LAG, new Map()],
    [AGENT_LAG, new Map()],
  ]);
  for (const h of input.histograms) {
    if (h.metric === REQUEST) {
      addInto(requestAll, h.hourMs, h.buckets);
      const byHour = requestClass.get(h.statusClass);
      if (byHour) byHour.set(h.hourMs, (byHour.get(h.hourMs) ?? 0) + bucketTotal(h.buckets));
    } else if (h.metric === UPSTREAM) {
      const byHour = upstream.get(h.api);
      if (byHour) addInto(byHour, h.hourMs, h.buckets);
    } else {
      const byHour = plain.get(h.metric);
      if (byHour) addInto(byHour, h.hourMs, h.buckets);
    }
  }
  const counterByMetric = new Map<string, Map<number, number>>(TREND_COUNTERS.map((m) => [m, new Map()]));
  for (const c of input.counters) {
    const byHour = counterByMetric.get(c.metric);
    if (byHour) byHour.set(c.hourMs, (byHour.get(c.hourMs) ?? 0) + c.total);
  }

  const hours = Array.from({ length: points }, (_, i) => trendFrom + i * HOUR_MS);
  const msSeries = (byHour: ReadonlyMap<number, number[]>, q: number) => hours.map((h) => trendPercentile(byHour.get(h), q));
  const countSeries = (byHour: ReadonlyMap<number, number>) => hours.map((h) => Math.round(byHour.get(h) ?? 0));
  const requestSeries = (cls: string) =>
    hours.map((h) => (requestAll.has(h) ? Math.round(requestClass.get(cls)!.get(h) ?? 0) : null));

  const trend: MetricsTrend = {
    from: new Date(trendFrom).toISOString(),
    points,
    requests: { c2xx: requestSeries("2xx"), c3xx: requestSeries("3xx"), c4xx: requestSeries("4xx"), c5xx: requestSeries("5xx") },
    requestMs: { p50: msSeries(requestAll, 0.5), p95: msSeries(requestAll, 0.95), p99: msSeries(requestAll, 0.99) },
    upstreamP95Ms: { vanilla: msSeries(upstream.get("vanilla")!, 0.95), frm: msSeries(upstream.get("frm")!, 0.95) },
    dbP95Ms: msSeries(plain.get(DB)!, 0.95),
    pollLagP95Ms: msSeries(plain.get(POLL_LAG)!, 0.95),
    agentLagP95Ms: msSeries(plain.get(AGENT_LAG)!, 0.95),
    agentRefused: countSeries(counterByMetric.get("satis.agent.refused")!),
    signupRefused: countSeries(counterByMetric.get("satis.signup.refused")!),
    historyRowsDropped: countSeries(counterByMetric.get("satis.history.rows_dropped")!),
    alertEventsDropped: countSeries(counterByMetric.get("satis.alerts.events_dropped")!),
    pushDropped: countSeries(counterByMetric.get("satis.alerts.push.dropped")!),
    alertsFired: countSeries(input.fired),
  };

  const headline = (from: number, to: number, hoursCovered: number): MetricsHeadline => {
    const requests = sumBuckets(requestAll, from, to);
    const sumOver = (byHour: ReadonlyMap<number, number>) => {
      let n = 0;
      for (const [hour, v] of byHour) if (hour >= from && hour < to) n += v;
      return Math.round(n);
    };
    const total = requests ? Math.round(bucketTotal(requests)) : null;
    return {
      hours: hoursCovered,
      requests: total,
      serverErrors: total === null ? null : Math.min(total, sumOver(requestClass.get("5xx")!)),
      requestP95Ms: trendPercentile(requests, 0.95),
      pollLagP95Ms: trendPercentile(sumBuckets(plain.get(POLL_LAG)!, from, to), 0.95),
      agentLagP95Ms: trendPercentile(sumBuckets(plain.get(AGENT_LAG)!, from, to), 0.95),
      alertsFired: sumOver(input.fired),
      refusedAndDropped: [...counterByMetric.values()].reduce((n, byHour) => n + sumOver(byHour), 0),
    };
  };
  // The current window runs to now (its last hour partial); the previous one ends where the current one starts.
  const current = headline(currentFrom, Number.POSITIVE_INFINITY, (input.nowMs - currentFrom) / HOUR_MS);
  const previous = headline(previousFrom, currentFrom, (currentFrom - previousFrom) / HOUR_MS);

  const nothing = input.histograms.length === 0 && input.counters.length === 0 && input.fired.size === 0;
  if (nothing) return { available: false, reason: "no_data" };
  const section = { available: true as const, asOf: generatedAt, headline: { current, previous }, trend };
  // The whole overview is validated on the way out: a charts section the contract refuses would fail the page, so it is
  // checked here and dropped to "no data" instead (the tables still show). Tests keep this branch unreachable.
  return MetricsChartsSectionSchema.safeParse(section).success ? section : { available: false, reason: "no_data" };
}
