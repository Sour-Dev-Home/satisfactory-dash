import type { DeliverySnapshot, MetricsChartsSection, MetricsOverview } from "../src/index";

/** ADR-0056 PR 2: invented values for the metrics contract, for tests. The demo's own data lives in the frontend's demo world (`frontend/src/demo/metrics.ts`), which parses it with the schema. */

export const deliverySnapshotSample = {
  schemaVersion: 2,
  generatedAt: "2026-03-02T06:00:00Z",
  window: { days: 30, from: "2026-01-31T06:00:00Z", to: "2026-03-02T06:00:00Z" },
  throughput: { mergedPrs: 2, perDay: 0.07, perWeek: [{ weekStart: "2026-02-23T00:00:00Z", merged: 2 }] },
  leadTimeHours: { median: 1.5, p90: 3, mean: 1.8 },
  size: { medianLinesChanged: 40 },
  changeFailure: { mainRuns: 4, failedMainRuns: 1, failureRate: 0.25, revertPrs: 0, revertRate: 0 },
  ci: { mainRuns: 4, failedMainRuns: 1, mainFailureRate: 0.25, flakyRuns: 0, flakeRate: 0, prsMerged: 2, prsBounced: 0, bounceRate: 0 },
  logFragments: { inWindow: 2 },
} satisfies DeliverySnapshot;

/** Every section has data: one histogram, one counter, one worst server, one alert month and a delivery snapshot. */
export const metricsOverviewAvailable = {
  generatedAt: "2026-03-02T12:00:00Z",
  window: "1h",
  system: {
    available: true,
    asOf: "2026-03-02T12:00:00Z",
    histograms: [
      { metric: "http.server.request.duration", labels: { route: "/api/health", status_class: "2xx" }, count: 10, p50Ms: 1, p95Ms: 2, p99Ms: null },
    ],
    counters: [{ metric: "satis.agent.refused", labels: { status: "401" }, total: 2 }],
    servers: [{ kind: "counter", metric: "satis.agent.refused", server: "abc123", labels: { status: "401" }, total: 2 }],
  },
  alerts: {
    available: true,
    asOf: "2026-03-02T12:00:00Z",
    months: [{ month: "2026-03", kind: "power_outage", fired: 2, flaps: 1, medianResolveSeconds: null }],
  },
  delivery: { available: true, asOf: "2026-03-02T06:00:00Z", snapshot: deliverySnapshotSample },
  links: { statusPage: "https://status.example.test/", probeRuns: "https://example.test/runs" },
} satisfies MetricsOverview;

/**
 * A charts section (ADR-0056 amendment 2026-10-26) with `points` hours of invented, gently varying values: a gap at
 * hour 3 (no requests, no percentiles), one hour over the last bucket, and a 5xx burst; `gaps: false` fills every point.
 */
function chartsSample(points: number, { gaps = true }: { gaps?: boolean } = {}) {
  const hours = Array.from({ length: points }, (_, i) => i);
  const gap = (i: number) => gaps && i === 3;
  const ms = (i: number, base: number) => (gap(i) ? null : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000][(base + (i % 3)) % 10]);
  return {
    available: true as const,
    asOf: "2026-03-02T12:00:00Z",
    headline: {
      current: { hours: 24.5, requests: 4210, serverErrors: 12, requestP95Ms: 200, pollLagP95Ms: 2000, agentLagP95Ms: 500, alertsFired: 3, refusedAndDropped: 2 },
      previous: { hours: 24, requests: 3980, serverErrors: 4, requestP95Ms: 100, pollLagP95Ms: 2000, agentLagP95Ms: null, alertsFired: 1, refusedAndDropped: 0 },
    },
    trend: {
      from: "2026-03-01T12:00:00Z",
      points,
      requests: {
        c2xx: hours.map((i) => (gap(i) ? null : 150 + (i % 7) * 10)),
        c3xx: hours.map((i) => (gap(i) ? null : i % 5)),
        c4xx: hours.map((i) => (gap(i) ? null : i % 3)),
        c5xx: hours.map((i) => (gap(i) ? null : i === 10 ? 9 : 0)),
      },
      requestMs: {
        p50: hours.map((i) => ms(i, 0)),
        p95: hours.map((i) => ms(i, 3)),
        p99: hours.map((i) => (gap(i) ? null : i === 10 ? 10000 : ms(i, 5))),
      },
      upstreamP95Ms: { vanilla: hours.map((i) => ms(i, 4)), frm: hours.map((i) => ms(i, 5)) },
      dbP95Ms: hours.map((i) => ms(i, 1)),
      pollLagP95Ms: hours.map((i) => ms(i, 7)),
      agentLagP95Ms: hours.map((i) => ms(i, 6)),
      agentRefused: hours.map((i) => (i === 5 ? 2 : 0)),
      signupRefused: hours.map(() => 0),
      historyRowsDropped: hours.map(() => 0),
      alertEventsDropped: hours.map(() => 0),
      pushDropped: hours.map(() => 0),
      alertsFired: hours.map((i) => (i % 8 === 0 ? 1 : 0)),
    },
  };
}

/** The charts section at the 1h and 24h windows' 25 hourly points, with a gap, an over-the-last-bucket hour and a 5xx burst. */
export const metricsChartsDay = chartsSample(25) satisfies MetricsChartsSection;
/** The 7d window's 169 points, every one filled: the worst case for the response size. */
export const metricsChartsWeekFull = chartsSample(169, { gaps: false }) satisfies MetricsChartsSection;

/** Every section has data, charts included, at the 24h window. */
export const metricsOverviewWithCharts = {
  ...metricsOverviewAvailable,
  window: "24h",
  charts: metricsChartsDay,
} satisfies MetricsOverview;

/** Every section says why it has no data, one reason each. */
export const metricsOverviewUnavailable = {
  generatedAt: "2026-03-02T12:00:00Z",
  window: "24h",
  system: { available: false, reason: "no_data" },
  alerts: { available: false, reason: "not_built" },
  delivery: { available: false, reason: "not_configured" },
  links: metricsOverviewAvailable.links,
} satisfies MetricsOverview;
