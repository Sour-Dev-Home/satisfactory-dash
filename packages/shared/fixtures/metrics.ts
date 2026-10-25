import type { DeliverySnapshot, MetricsOverview } from "../src/index";

/** ADR-0056 PR 2: invented values for the metrics contract, for tests. The demo's own data is `metrics-overview.demo.json`. */

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

/** Every section says why it has no data, one reason each. */
export const metricsOverviewUnavailable = {
  generatedAt: "2026-03-02T12:00:00Z",
  window: "24h",
  system: { available: false, reason: "no_data" },
  alerts: { available: false, reason: "not_built" },
  delivery: { available: false, reason: "not_configured" },
  links: metricsOverviewAvailable.links,
} satisfies MetricsOverview;
