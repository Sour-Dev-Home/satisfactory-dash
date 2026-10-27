import { describe, expect, it } from "vitest";
import { metricsChartsDay, metricsChartsWeekFull, metricsOverviewAvailable, metricsOverviewWithCharts } from "../fixtures/metrics";
import {
  METRICS_TREND_MAX_POINTS,
  METRICS_TREND_OVER_MS,
  MetricsChartsSectionSchema,
  MetricsOverviewSchema,
  metricsTrendPoints,
} from "../src/index";

type Charts = typeof metricsChartsDay;
/** A deep copy (the fixtures are plain JSON; this package's lib has no structuredClone). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** A copy of the day fixture with `patch` applied to its trend. */
const withTrend = (patch: (t: Charts["trend"]) => void) => {
  const charts = clone(metricsChartsDay);
  patch(charts.trend);
  return charts;
};
const ok = (charts: unknown) => MetricsChartsSectionSchema.safeParse(charts).success;

describe("the metrics charts section (ADR-0056 amendment 2026-10-26)", () => {
  it("parses the fixtures, and an overview without charts still parses (an older backend)", () => {
    expect(MetricsOverviewSchema.safeParse(metricsOverviewWithCharts).success).toBe(true);
    expect(MetricsOverviewSchema.safeParse(metricsOverviewAvailable).success).toBe(true);
    expect(ok(metricsChartsWeekFull)).toBe(true);
    expect(ok({ available: false, reason: "not_built" })).toBe(true);
  });

  it("has a day of hours for 1h and 24h, a week for 7d, never more", () => {
    expect([metricsTrendPoints("1h"), metricsTrendPoints("24h"), metricsTrendPoints("7d")]).toEqual([25, 25, METRICS_TREND_MAX_POINTS]);
    const tooLong = clone(metricsChartsWeekFull);
    tooLong.trend.points = METRICS_TREND_MAX_POINTS + 1;
    tooLong.trend.dbP95Ms.push(1);
    expect(ok(tooLong)).toBe(false);
  });

  it("refuses a trend whose length does not match the window", () => {
    const sevenDays = { ...metricsOverviewWithCharts, charts: metricsChartsWeekFull };
    expect(MetricsOverviewSchema.safeParse(sevenDays).success).toBe(false);
    expect(MetricsOverviewSchema.safeParse({ ...sevenDays, window: "7d" }).success).toBe(true);
    expect(MetricsOverviewSchema.safeParse({ ...metricsOverviewWithCharts, window: "1h" }).success).toBe(true);
  });

  it("refuses a series of the wrong length", () => {
    expect(ok(withTrend((t) => t.dbP95Ms.pop()))).toBe(false);
    expect(ok(withTrend((t) => t.requests.c5xx.push(0)))).toBe(false);
    expect(ok(withTrend((t) => t.alertsFired.pop()))).toBe(false);
  });

  it("starts on the hour", () => {
    expect(ok(withTrend((t) => (t.from = "2026-03-01T12:30:00Z")))).toBe(false);
    expect(ok(withTrend((t) => (t.from = "2026-03-01T12:00:01Z")))).toBe(false);
    expect(ok(withTrend((t) => (t.from = "2026-03-01T14:00:00+02:00")))).toBe(true);
  });

  it("takes a bucket bound, the over value or null as a trend percentile, nothing else", () => {
    for (const v of [0, 200, 5000, METRICS_TREND_OVER_MS, null]) {
      expect(ok(withTrend((t) => (t.dbP95Ms[0] = v))), String(v)).toBe(true);
    }
    for (const v of [-1, 5001, 9999, 10001]) {
      expect(ok(withTrend((t) => (t.dbP95Ms[0] = v))), String(v)).toBe(false);
    }
  });

  it("refuses percentiles that run backwards in an hour, with the over value the largest", () => {
    expect(ok(withTrend((t) => ((t.requestMs.p50[0] = 500), (t.requestMs.p95[0] = 200))))).toBe(false);
    expect(ok(withTrend((t) => ((t.requestMs.p95[0] = METRICS_TREND_OVER_MS), (t.requestMs.p99[0] = 5000))))).toBe(false);
    expect(ok(withTrend((t) => ((t.requestMs.p50[0] = 5), (t.requestMs.p95[0] = null), (t.requestMs.p99[0] = 2))))).toBe(false);
    expect(ok(withTrend((t) => ((t.requestMs.p95[0] = 200), (t.requestMs.p99[0] = METRICS_TREND_OVER_MS))))).toBe(true);
  });

  it("takes null request counts (no data) but not null counters, and no negatives or fractions", () => {
    expect(ok(withTrend((t) => (t.requests.c2xx[0] = null)))).toBe(true);
    expect(ok(withTrend((t) => ((t.agentRefused as (number | null)[])[0] = null)))).toBe(false);
    expect(ok(withTrend((t) => (t.pushDropped[0] = -1)))).toBe(false);
    expect(ok(withTrend((t) => ((t.alertsFired as number[])[0] = 0.5)))).toBe(false);
  });

  it("refuses a headline with more server errors than requests", () => {
    const charts = clone(metricsChartsDay);
    charts.headline.current.serverErrors = charts.headline.current.requests + 1;
    expect(ok(charts)).toBe(false);
  });

  it("stays small: a week with every point filled is at most 32 kB", () => {
    expect(JSON.stringify(metricsChartsWeekFull).length).toBeLessThanOrEqual(32 * 1024);
  });
});
