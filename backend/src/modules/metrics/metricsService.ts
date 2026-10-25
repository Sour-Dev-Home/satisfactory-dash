import {
  METRICS_WORST_SERVERS_PER_METRIC,
  MetricLabelsSchema,
  ServerMetricSummarySchema,
} from "@satisfactory-dash/shared";
import type {
  CounterSummary,
  HistogramSummary,
  MetricsOverview,
  MetricsWindow,
  ServerMetricSummary,
} from "@satisfactory-dash/shared";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { readCounterSeries, readHistogramSeries } from "./metricsRepository.js";
import type { CounterSeries, HistogramSeries } from "./metricsRepository.js";
import { bucketTotal, rankOf, summarizeBuckets } from "./percentiles.js";

/** ADR-0056 section 2. The page links, not data (D3: uptime is a link to the public status page). */
export const METRICS_LINKS = {
  statusPage: "https://status.satis-manager.com/",
  probeRuns: "https://github.com/Sour-Dev-Home/satisfactory-dash/actions/workflows/latency-probe.yml",
} as const;

const HOUR_MS = 60 * 60 * 1000;
/** The window lengths. Capped at 7 days by the enum (ADR-0056 section 7): this is the cost rule, not a convenience. */
const WINDOW_MS = new Map<MetricsWindow, number>([
  ["1h", HOUR_MS],
  ["24h", 24 * HOUR_MS],
  ["7d", 7 * 24 * HOUR_MS],
]);

/** The label that carries a server's public id; folded away from the combined rows. */
const SERVER_LABEL = "server";

export interface MetricsService {
  overview(window: MetricsWindow): Promise<MetricsOverview>;
}

export interface MetricsServiceOptions {
  db: Queryable;
  now?: () => number;
}

/** Rows are hourly: the window starts at the hour that holds `now - length` and ends at the current (partial) hour. */
export function windowBounds(window: MetricsWindow, nowMs: number): { from: Date; to: Date } {
  const length = WINDOW_MS.get(window) ?? WINDOW_MS.get("24h")!;
  return { from: new Date(Math.floor((nowMs - length) / HOUR_MS) * HOUR_MS), to: new Date(nowMs) };
}

function labelsKey(metric: string, labels: ReadonlyMap<string, string>): string {
  return JSON.stringify([metric, [...labels.entries()].sort(([a], [b]) => (a < b ? -1 : 1))]);
}

function withoutServer(labels: ReadonlyMap<string, string>): Map<string, string> {
  const rest = new Map(labels);
  rest.delete(SERVER_LABEL);
  return rest;
}

/** A label map as the contract's record, or `undefined` when a value would break it (such a row is dropped, not shown). */
function labelRecord(labels: ReadonlyMap<string, string>): Record<string, string> | undefined {
  const parsed = MetricLabelsSchema.safeParse(Object.fromEntries(labels));
  return parsed.success ? parsed.data : undefined;
}

function byMetricThenLabels<T extends { metric: string; labels: Record<string, string> }>(a: T, b: T): number {
  return a.metric === b.metric ? (JSON.stringify(a.labels) < JSON.stringify(b.labels) ? -1 : 1) : a.metric < b.metric ? -1 : 1;
}

/** All servers combined: the same series with the `server` label merged away. */
export function foldHistograms(series: readonly HistogramSeries[]): HistogramSummary[] {
  const merged = new Map<string, HistogramSeries>();
  for (const s of series) {
    const labels = withoutServer(s.labels);
    const key = labelsKey(s.metric, labels);
    const into = merged.get(key);
    if (into) s.buckets.forEach((n, i) => (into.buckets[i] += n));
    else merged.set(key, { metric: s.metric, labels, buckets: [...s.buckets] });
  }
  const out: HistogramSummary[] = [];
  for (const s of merged.values()) {
    const percentiles = summarizeBuckets(s.buckets);
    const labels = labelRecord(s.labels);
    if (!percentiles || !labels) continue;
    out.push({ metric: s.metric, labels, count: bucketTotal(s.buckets), ...percentiles });
  }
  return out.sort(byMetricThenLabels);
}

export function foldCounters(series: readonly CounterSeries[]): CounterSummary[] {
  const merged = new Map<string, { metric: string; labels: Map<string, string>; total: number }>();
  for (const s of series) {
    const labels = withoutServer(s.labels);
    const key = labelsKey(s.metric, labels);
    const into = merged.get(key);
    if (into) into.total += s.total;
    else merged.set(key, { metric: s.metric, labels, total: s.total });
  }
  const out: CounterSummary[] = [];
  for (const s of merged.values()) {
    const labels = labelRecord(s.labels);
    if (labels && s.total > 0) out.push({ metric: s.metric, labels, total: s.total });
  }
  return out.sort(byMetricThenLabels);
}

/**
 * The worst few servers per metric, by public id only. Histograms rank by p95 (above 5 s worst), then p99, then count;
 * counters by total. A series without a valid `server` label is skipped, never shown under a made-up id. Each row is
 * checked against the contract's schema, so nothing that is not a public id can get through.
 */
export function worstServers(histograms: readonly HistogramSeries[], counters: readonly CounterSeries[]): ServerMetricSummary[] {
  const candidates: { key: string; score: [number, number, number]; row: ServerMetricSummary }[] = [];
  for (const s of histograms) {
    const server = s.labels.get(SERVER_LABEL);
    const percentiles = summarizeBuckets(s.buckets);
    const labels = labelRecord(withoutServer(s.labels));
    if (server === undefined || !percentiles || !labels) continue;
    const count = bucketTotal(s.buckets);
    const row = ServerMetricSummarySchema.safeParse({ kind: "histogram", metric: s.metric, server, labels, count, ...percentiles });
    if (row.success) candidates.push({ key: `histogram:${s.metric}`, score: [rankOf(percentiles.p95Ms), rankOf(percentiles.p99Ms), count], row: row.data });
  }
  for (const s of counters) {
    const server = s.labels.get(SERVER_LABEL);
    const labels = labelRecord(withoutServer(s.labels));
    if (server === undefined || !labels || s.total <= 0) continue;
    const row = ServerMetricSummarySchema.safeParse({ kind: "counter", metric: s.metric, server, labels, total: s.total });
    if (row.success) candidates.push({ key: `counter:${s.metric}`, score: [s.total, 0, 0], row: row.data });
  }
  const byMetric = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const list = byMetric.get(c.key);
    if (list) list.push(c);
    else byMetric.set(c.key, [c]);
  }
  const out: ServerMetricSummary[] = [];
  for (const key of [...byMetric.keys()].sort()) {
    const ranked = byMetric
      .get(key)!
      .sort((a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1] || b.score[2] - a.score[2] || (a.row.server < b.row.server ? -1 : 1));
    for (const c of ranked.slice(0, METRICS_WORST_SERVERS_PER_METRIC)) out.push(c.row);
  }
  return out;
}

export function createMetricsService(options: MetricsServiceOptions): MetricsService {
  const now = options.now ?? Date.now;
  return {
    async overview(window) {
      const nowMs = now();
      const { from, to } = windowBounds(window, nowMs);
      const [histogramSeries, counterSeries] = await Promise.all([
        readHistogramSeries(options.db, from, to),
        readCounterSeries(options.db, from, to),
      ]);
      const histograms = foldHistograms(histogramSeries);
      const counters = foldCounters(counterSeries);
      const generatedAt = new Date(nowMs).toISOString();
      return {
        generatedAt,
        window,
        system:
          histograms.length === 0 && counters.length === 0
            ? { available: false, reason: "no_data" }
            : { available: true, asOf: generatedAt, histograms, counters, servers: worstServers(histogramSeries, counterSeries) },
        // PR 4 builds alert quality; PR 6b the delivery snapshot.
        alerts: { available: false, reason: "not_built" },
        delivery: { available: false, reason: "not_built" },
        links: { ...METRICS_LINKS },
      };
    },
  };
}
