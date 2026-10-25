import { describe, expect, it } from "vitest";
import { deliverySnapshotSample, metricsOverviewAvailable } from "../fixtures/metrics";
import { DeliverySnapshotSchema, MetricsOverviewSchema, METRICS_LAST_BUCKET_MS } from "../src/index";

const ok = (v: unknown) => MetricsOverviewSchema.safeParse(v).success;

const withHistogram = (h: Record<string, unknown>) => ({
  ...metricsOverviewAvailable,
  system: {
    ...metricsOverviewAvailable.system,
    histograms: [{ metric: "satis.poller.lag", labels: {}, count: 1, p50Ms: 1, p95Ms: 1, p99Ms: 1, ...h }],
  },
});

describe("metrics contract edge cases", () => {
  it("refuses a finite percentile above the last bucket (that must be null)", () => {
    expect(ok(withHistogram({ p99Ms: METRICS_LAST_BUCKET_MS }))).toBe(true);
    expect(ok(withHistogram({ p99Ms: METRICS_LAST_BUCKET_MS + 1 }))).toBe(false);
  });

  it("refuses NaN, Infinity, negatives and fractional counts", () => {
    for (const bad of [{ p50Ms: Number.NaN }, { p99Ms: Number.POSITIVE_INFINITY }, { p50Ms: -1 }, { count: 1.5 }, { count: -1 }]) {
      expect(ok(withHistogram(bad)), JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses unicode whitespace and a trailing newline in a label value", () => {
    const labels = (v: string) => withHistogram({ labels: { route: v } });
    for (const bad of ["a b", "a b", "a　b", "a\n", " x", "a＠b".replace("＠", "@")]) {
      expect(ok(labels(bad)), JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses odd label keys, including prototype keys", () => {
    for (const k of ["A", "_x", "1a", "a-b", "", "a".repeat(65)]) {
      const labels = JSON.parse(`{${JSON.stringify(k)}: "x"}`) as Record<string, string>;
      expect(ok(withHistogram({ labels })), k).toBe(false);
    }
    // zod drops an own "__proto__" key instead of copying it, so it never reaches the output.
    const parsed = MetricsOverviewSchema.parse(withHistogram({ labels: JSON.parse('{"__proto__": "a@b"}') }));
    expect(Object.getOwnPropertyNames(parsed.system.available ? parsed.system.histograms[0]!.labels : {})).toEqual([]);
  });

  it("refuses a rule kind that could carry an address or free text", () => {
    const month = (kind: string) => ({
      ...metricsOverviewAvailable,
      alerts: { available: true, asOf: "2026-03-02T12:00:00Z", months: [{ month: "2026-03", kind, fired: 1, flaps: 0, medianResolveSeconds: null }] },
    });
    expect(ok(month("power_outage"))).toBe(true);
    for (const bad of ["a@b.c", "My Rule", "", "x".repeat(65)]) expect(ok(month(bad)), bad).toBe(false);
  });

  it("refuses non-http links", () => {
    const links = (statusPage: string) => ({ ...metricsOverviewAvailable, links: { statusPage, probeRuns: "https://example.com/p" } });
    expect(ok(links("https://example.com/s"))).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "not a url"]) expect(ok(links(bad)), bad).toBe(false);
  });

  it("refuses a server id with path or unicode characters, and a server row of the wrong kind shape", () => {
    const row = (r: Record<string, unknown>) => ({
      ...metricsOverviewAvailable,
      system: { ...metricsOverviewAvailable.system, servers: [r] },
    });
    const base = { kind: "counter", metric: "a.b", server: "srv1", labels: {}, total: 1 };
    expect(ok(row(base))).toBe(true);
    expect(ok(row({ ...base, server: "x".repeat(65) }))).toBe(false);
    expect(ok(row({ ...base, server: "sérver" }))).toBe(false);
    expect(ok(row({ ...base, kind: "gauge" }))).toBe(false);
    expect(ok(row({ ...base, kind: "histogram" }))).toBe(false); // histogram needs count and percentiles
  });

  it("refuses an unknown time zone shape and a date without a time", () => {
    expect(ok({ ...metricsOverviewAvailable, generatedAt: "2026-03-02" })).toBe(false);
    expect(ok({ ...metricsOverviewAvailable, generatedAt: "2026-03-02T12:00:00" })).toBe(false);
    expect(ok({ ...metricsOverviewAvailable, window: "30d" })).toBe(false);
  });

  it("refuses negative delivery numbers and rates outside 0..1", () => {
    const s = deliverySnapshotSample;
    expect(DeliverySnapshotSchema.safeParse({ ...s, leadTimeHours: { ...s.leadTimeHours, median: -1 } }).success).toBe(false);
    expect(DeliverySnapshotSchema.safeParse({ ...s, size: { medianLinesChanged: -5 } }).success).toBe(false);
    expect(DeliverySnapshotSchema.safeParse({ ...s, ci: { ...s.ci, bounceRate: -0.1 } }).success).toBe(false);
    expect(DeliverySnapshotSchema.safeParse({ ...s, window: { ...s.window, days: 0 } }).success).toBe(false);
    expect(DeliverySnapshotSchema.safeParse({ ...s, throughput: { ...s.throughput, perWeek: [{ weekStart: s.generatedAt, merged: 1, author: "x" }] } }).success).toBe(false);
  });
});
