import { describe, expect, it } from "vitest";
import { deliverySnapshotSample, metricsOverviewAvailable, metricsOverviewUnavailable } from "../fixtures/metrics";
import {
  DeliverySnapshotSchema,
  METRICS_WORST_SERVERS_PER_METRIC,
  MetricsOverviewSchema,
  MetricsQuerySchema,
  endpoints,
} from "../src/index";

const histogram = (labels: Record<string, string>) => ({
  ...metricsOverviewAvailable,
  system: {
    ...metricsOverviewAvailable.system,
    histograms: [{ metric: "satis.poller.lag", labels, count: 1, p50Ms: 1, p95Ms: 1, p99Ms: 1 }],
  },
});

describe("the metrics overview contract", () => {
  it("parses the test fixtures", () => {
    expect(MetricsOverviewSchema.safeParse(metricsOverviewAvailable).success).toBe(true);
    expect(MetricsOverviewSchema.safeParse(metricsOverviewUnavailable).success).toBe(true);
  });

  it("refuses a label value with @, whitespace, nothing or over 200 characters", () => {
    expect(MetricsOverviewSchema.safeParse(histogram({ group: "status" })).success).toBe(true);
    expect(MetricsOverviewSchema.safeParse(histogram({ route: "/" + "a".repeat(199) })).success).toBe(true);
    for (const bad of ["a@b", "has space", "tab\there", "new\nline", "", "a".repeat(201)]) {
      expect(MetricsOverviewSchema.safeParse(histogram({ route: bad })).success, JSON.stringify(bad)).toBe(false);
    }
    expect(MetricsOverviewSchema.safeParse(histogram({ "Bad Key": "x" })).success).toBe(false);
  });

  it("makes each section either carry data or say why not", () => {
    const noReason = { ...metricsOverviewUnavailable, system: { available: false } };
    const unknownReason = { ...metricsOverviewUnavailable, system: { available: false, reason: "broken" } };
    const noAsOf = { ...metricsOverviewAvailable, alerts: { available: true, months: [] } };
    for (const bad of [noReason, unknownReason, noAsOf]) expect(MetricsOverviewSchema.safeParse(bad).success).toBe(false);
  });

  it("refuses percentiles that run backwards, and takes null as the largest", () => {
    const withP = (p50Ms: number | null, p95Ms: number | null, p99Ms: number | null) => ({
      ...metricsOverviewAvailable,
      system: {
        ...metricsOverviewAvailable.system,
        histograms: [{ metric: "satis.poller.lag", labels: {}, count: 1, p50Ms, p95Ms, p99Ms }],
      },
    });
    expect(MetricsOverviewSchema.safeParse(withP(1, 1, 1)).success).toBe(true);
    expect(MetricsOverviewSchema.safeParse(withP(1, 5, null)).success).toBe(true);
    expect(MetricsOverviewSchema.safeParse(withP(5, 1, 5)).success).toBe(false);
    expect(MetricsOverviewSchema.safeParse(withP(1, null, 5)).success).toBe(false);
  });

  it("allows at most five worst servers per metric, but five for each metric", () => {
    const row = (metric: string, n: number) => ({
      kind: "counter" as const,
      metric,
      server: `srv${n}`,
      labels: {},
      total: n,
    });
    const make = (rows: ReturnType<typeof row>[]) => ({
      ...metricsOverviewAvailable,
      system: { ...metricsOverviewAvailable.system, servers: rows },
    });
    const five = (metric: string) => Array.from({ length: METRICS_WORST_SERVERS_PER_METRIC }, (_, i) => row(metric, i));
    expect(MetricsOverviewSchema.safeParse(make([...five("a.b"), ...five("c.d")])).success).toBe(true);
    expect(MetricsOverviewSchema.safeParse(make([...five("a.b"), row("a.b", 9)])).success).toBe(false);
  });

  it("refuses a server entry that carries a display name or a non-id", () => {
    const bad = (server: string) => ({
      ...metricsOverviewAvailable,
      system: {
        ...metricsOverviewAvailable.system,
        servers: [{ kind: "counter", metric: "a.b", server, labels: {}, total: 1 }],
      },
    });
    expect(MetricsOverviewSchema.safeParse(bad("My Factory")).success).toBe(false);
    expect(MetricsOverviewSchema.safeParse(bad("owner@x.y")).success).toBe(false);
  });

  it("refuses more flaps than fired alerts, and a malformed month", () => {
    const month = (m: string, fired: number, flaps: number) => ({
      ...metricsOverviewAvailable,
      alerts: { available: true, asOf: "2026-03-02T12:00:00Z", months: [{ month: m, kind: "k", fired, flaps, medianResolveSeconds: 1 }] },
    });
    expect(MetricsOverviewSchema.safeParse(month("2026-03", 2, 2)).success).toBe(true);
    expect(MetricsOverviewSchema.safeParse(month("2026-03", 1, 2)).success).toBe(false);
    expect(MetricsOverviewSchema.safeParse(month("2026-13", 1, 0)).success).toBe(false);
  });

  it("ignores fields a newer backend adds to the response", () => {
    expect(MetricsOverviewSchema.safeParse({ ...metricsOverviewAvailable, newer: 1 }).success).toBe(true);
  });
});

describe("the delivery snapshot", () => {
  it("is strict, so a login, title or SHA field cannot ride along", () => {
    expect(DeliverySnapshotSchema.safeParse(deliverySnapshotSample).success).toBe(true);
    expect(DeliverySnapshotSchema.safeParse({ ...deliverySnapshotSample, author: "someone" }).success).toBe(false);
    expect(DeliverySnapshotSchema.safeParse({ ...deliverySnapshotSample, ci: { ...deliverySnapshotSample.ci, sha: "abc" } }).success).toBe(false);
  });

  it("is schemaVersion 2 only and has no mergeQueue", () => {
    expect(DeliverySnapshotSchema.safeParse({ ...deliverySnapshotSample, schemaVersion: 1 }).success).toBe(false);
    expect(DeliverySnapshotSchema.safeParse({ ...deliverySnapshotSample, mergeQueue: {} }).success).toBe(false);
  });

  it("takes null rates and medians (nothing merged) but refuses rates above 1", () => {
    const empty = { ...deliverySnapshotSample, leadTimeHours: { median: null, p90: null, mean: null }, ci: { ...deliverySnapshotSample.ci, flakeRate: null } };
    expect(DeliverySnapshotSchema.safeParse(empty).success).toBe(true);
    expect(DeliverySnapshotSchema.safeParse({ ...deliverySnapshotSample, ci: { ...deliverySnapshotSample.ci, flakeRate: 1.5 } }).success).toBe(false);
  });
});

describe("the metrics endpoints", () => {
  it("defaults the window to 24h and refuses one outside the enum", () => {
    expect(MetricsQuerySchema.parse({})).toEqual({ window: "24h" });
    for (const w of ["1h", "24h", "7d"]) expect(MetricsQuerySchema.parse({ window: w }).window).toBe(w);
    for (const w of ["30d", "1H", "", "all"]) expect(MetricsQuerySchema.safeParse({ window: w }).success, w).toBe(false);
  });

  it("lists the operator read and the delivery ingest, nothing else changes", () => {
    expect(endpoints.metrics.overview).toMatchObject({ method: "GET", route: "/api/admin/metrics" });
    expect(endpoints.metrics.overview.path()).toBe("/api/admin/metrics");
    expect(endpoints.metrics.deliveryIngest).toMatchObject({ method: "POST", route: "/api/internal/metrics/delivery" });
  });
});
