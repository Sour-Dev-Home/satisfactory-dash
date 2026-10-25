import type { MetricsOverview, MetricsWindow } from "@satisfactory-dash/shared";

/**
 * The demo's metrics (ADR-0056 PR 5): made-up numbers for the operator-only metrics page, shown with a "Sample data"
 * label. Invented here, never the shared test fixtures (ADR-0026). A 24 h base that the other windows scale: counts
 * follow the window's length, percentiles (bucket upper bounds, like the real ones) stay as they are. The alert
 * months are the last three calendar months before the demo clock, so the table always reads as current.
 */

const HOUR_MS = 3_600_000;
const WINDOW_HOURS: ReadonlyMap<MetricsWindow, number> = new Map([
  ["1h", 1],
  ["24h", 24],
  ["7d", 168],
]);

const iso = (t: number) => new Date(t).toISOString();

/** Scales a 24 h count to the window, keeping a non-zero count non-zero. */
const scaled = (base: number, hours: number) => (base === 0 ? 0 : Math.max(1, Math.round((base * hours) / 24)));

interface HistogramBase {
  metric: string;
  labels: Record<string, string>;
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

const HISTOGRAMS: readonly HistogramBase[] = [
  { metric: "http.server.request.duration", labels: { route: "/api/servers/:serverId/status", status_class: "2xx" }, count: 8640, p50Ms: 5, p95Ms: 20, p99Ms: 50 },
  { metric: "http.server.request.duration", labels: { route: "/api/servers/:serverId/factory", status_class: "2xx" }, count: 2880, p50Ms: 20, p95Ms: 100, p99Ms: 200 },
  { metric: "http.server.request.duration", labels: { route: "/api/servers/:serverId/history/power", status_class: "2xx" }, count: 410, p50Ms: 50, p95Ms: 200, p99Ms: 500 },
  { metric: "http.server.request.duration", labels: { route: "/api/servers/:serverId/status", status_class: "5xx" }, count: 3, p50Ms: 200, p95Ms: 500, p99Ms: 500 },
  { metric: "http.server.upstream.duration", labels: { api: "vanilla" }, count: 17280, p50Ms: 20, p95Ms: 100, p99Ms: 500 },
  { metric: "http.server.upstream.duration", labels: { api: "frm" }, count: 17280, p50Ms: 10, p95Ms: 50, p99Ms: 1000 },
  { metric: "db.client.operation.duration", labels: { query: "history.insertPowerSamples" }, count: 1440, p50Ms: 2, p95Ms: 10, p99Ms: 20 },
  { metric: "satis.poller.cycle.duration", labels: { group: "status" }, count: 17280, p50Ms: 50, p95Ms: 200, p99Ms: 1000 },
  { metric: "satis.poller.lag", labels: { group: "status" }, count: 17280, p50Ms: 1000, p95Ms: 2000, p99Ms: null },
  { metric: "satis.agent.ingest.lag", labels: {}, count: 5760, p50Ms: 500, p95Ms: 2000, p99Ms: 5000 },
  { metric: "satis.alerts.evaluation.duration", labels: {}, count: 2880, p50Ms: 5, p95Ms: 20, p99Ms: 50 },
  { metric: "satis.alerts.fire.lag", labels: {}, count: 6, p50Ms: 2000, p95Ms: 5000, p99Ms: null },
];

const COUNTERS: ReadonlyArray<{ metric: string; labels: Record<string, string>; total: number }> = [
  { metric: "satis.history.rows_written", labels: {}, total: 41230 },
  { metric: "satis.agent.refused", labels: { status: "401" }, total: 4 },
  { metric: "satis.agent.refused", labels: { status: "429" }, total: 0 },
  { metric: "satis.signup.refused", labels: { reason: "network_limit" }, total: 1 },
  { metric: "satis.history.rows_dropped", labels: {}, total: 0 },
  { metric: "satis.alerts.events_dropped", labels: {}, total: 0 },
  { metric: "satis.alerts.push.dropped", labels: {}, total: 2 },
];

/** The year and month ("2026-10") `back` months before the one `now` falls in, in UTC. */
function monthBefore(now: number, back: number): string {
  const d = new Date(now);
  const months = d.getUTCFullYear() * 12 + d.getUTCMonth() - back;
  return `${Math.floor(months / 12)}-${String((months % 12) + 1).padStart(2, "0")}`;
}

const ALERT_ROWS: ReadonlyArray<[back: number, kind: string, fired: number, flaps: number, median: number | null]> = [
  [2, "power_outage", 3, 0, 1260],
  [2, "production_below_target", 9, 2, 840],
  [1, "power_outage", 2, 0, 900],
  [1, "stopped_machines", 5, 1, 2400],
  [1, "server_unreachable", 1, 0, null],
  [0, "production_below_target", 6, 3, 420],
  [0, "power_outage", 1, 0, 600],
];

/** What `GET /api/admin/metrics?window=` answers in the demo, as the operator sees it. */
export function demoMetricsOverview(now: number, window: MetricsWindow): MetricsOverview {
  const hours = WINDOW_HOURS.get(window) ?? 24;
  const generatedAt = iso(now);
  const deliveryAt = iso(now - 6 * HOUR_MS);
  return {
    generatedAt,
    window,
    system: {
      available: true,
      asOf: generatedAt,
      histograms: HISTOGRAMS.map((h) => ({ ...h, count: scaled(h.count, hours) })),
      counters: COUNTERS.map((c) => ({ ...c, total: scaled(c.total, hours) })),
      servers: [
        { kind: "histogram", metric: "satis.poller.lag", server: "sample-srv-a", labels: { group: "status" }, count: scaled(8640, hours), p50Ms: 1000, p95Ms: 5000, p99Ms: null },
        { kind: "histogram", metric: "satis.poller.lag", server: "sample-srv-b", labels: { group: "status" }, count: scaled(8640, hours), p50Ms: 500, p95Ms: 1000, p99Ms: 2000 },
        { kind: "histogram", metric: "satis.agent.ingest.lag", server: "sample-srv-c", labels: {}, count: scaled(5760, hours), p50Ms: 500, p95Ms: 2000, p99Ms: 5000 },
        { kind: "counter", metric: "satis.agent.refused", server: "sample-srv-c", labels: { status: "401" }, total: scaled(3, hours) },
        { kind: "counter", metric: "satis.agent.refused", server: "unknown", labels: { status: "401" }, total: scaled(1, hours) },
      ],
    },
    alerts: {
      available: true,
      asOf: generatedAt,
      months: ALERT_ROWS.map(([back, kind, fired, flaps, medianResolveSeconds]) => ({
        month: monthBefore(now, back),
        kind,
        fired,
        flaps,
        medianResolveSeconds,
      })),
    },
    delivery: {
      available: true,
      asOf: deliveryAt,
      snapshot: {
        schemaVersion: 2,
        generatedAt: deliveryAt,
        window: { days: 30, from: iso(now - 30 * 24 * HOUR_MS), to: deliveryAt },
        throughput: {
          mergedPrs: 45,
          perDay: 1.5,
          perWeek: [
            { weekStart: iso(now - 28 * 24 * HOUR_MS), merged: 12 },
            { weekStart: iso(now - 21 * 24 * HOUR_MS), merged: 9 },
            { weekStart: iso(now - 14 * 24 * HOUR_MS), merged: 14 },
            { weekStart: iso(now - 7 * 24 * HOUR_MS), merged: 8 },
          ],
        },
        leadTimeHours: { median: 2.4, p90: 9.8, mean: 4.1 },
        size: { medianLinesChanged: 180 },
        changeFailure: { mainRuns: 52, failedMainRuns: 2, failureRate: 0.038, revertPrs: 1, revertRate: 0.022 },
        ci: { mainRuns: 52, failedMainRuns: 2, mainFailureRate: 0.038, flakyRuns: 3, flakeRate: 0.058, prsMerged: 45, prsBounced: 6, bounceRate: 0.133 },
        logFragments: { inWindow: 44 },
      },
    },
    links: {
      statusPage: "https://status.satis-manager.com/",
      probeRuns: "https://github.com/Sour-Dev-Home/satisfactory-dash/actions/workflows/latency-probe.yml",
    },
  };
}
