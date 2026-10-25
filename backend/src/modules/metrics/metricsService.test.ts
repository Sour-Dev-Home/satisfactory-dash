import { describe, expect, it } from "vitest";
import { MetricsOverviewSchema, METRICS_WORST_SERVERS_PER_METRIC } from "@satisfactory-dash/shared";
import { createMetricsService, foldCounters, foldHistograms, windowBounds, worstServers } from "./metricsService.js";
import type { CounterSeries, HistogramSeries } from "./metricsRepository.js";

const buckets = (at: Record<number, number>): number[] => Array.from({ length: 13 }, (_, i) => at[i] ?? 0);
const hist = (metric: string, labels: Record<string, string>, at: Record<number, number>): HistogramSeries => ({
  metric,
  labels: new Map(Object.entries(labels)),
  buckets: buckets(at),
});
const counter = (metric: string, labels: Record<string, string>, total: number): CounterSeries => ({
  metric,
  labels: new Map(Object.entries(labels)),
  total,
});

describe("windowBounds", () => {
  const now = Date.parse("2026-10-25T10:30:00Z");
  it("starts at the hour holding now minus the window and ends at now", () => {
    expect(windowBounds("1h", now).from.toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(windowBounds("24h", now).from.toISOString()).toBe("2026-10-24T10:00:00.000Z");
    expect(windowBounds("7d", now).from.toISOString()).toBe("2026-10-18T10:00:00.000Z");
    expect(windowBounds("7d", now).to.getTime()).toBe(now);
  });
});

describe("foldHistograms", () => {
  it("merges the server label away, summing buckets, and keeps other labels apart", () => {
    const out = foldHistograms([
      hist("poller.cycle.duration", { server: "a1", group: "fast" }, { 3: 5 }),
      hist("poller.cycle.duration", { server: "b2", group: "fast" }, { 12: 5 }),
      hist("poller.cycle.duration", { server: "a1", group: "slow" }, { 0: 1 }),
    ]);
    expect(out).toEqual([
      { metric: "poller.cycle.duration", labels: { group: "fast" }, count: 10, p50Ms: 10, p95Ms: null, p99Ms: null },
      { metric: "poller.cycle.duration", labels: { group: "slow" }, count: 1, p50Ms: 1, p95Ms: 1, p99Ms: 1 },
    ]);
    expect(JSON.stringify(out)).not.toContain("a1");
  });

  it("drops an empty series and one whose label value would break the contract", () => {
    expect(foldHistograms([hist("m.x", {}, {}), hist("m.y", { route: "has space" }, { 0: 1 }), hist("m.z", { who: "a@b.c" }, { 0: 1 })])).toEqual([]);
  });
});

describe("foldCounters", () => {
  it("sums across servers and omits zero totals", () => {
    expect(foldCounters([counter("satis.agent.refused", { server: "a1", status: "401" }, 2), counter("satis.agent.refused", { server: "b2", status: "401" }, 3), counter("z.zero", {}, 0)])).toEqual([
      { metric: "satis.agent.refused", labels: { status: "401" }, total: 5 },
    ]);
  });
});

describe("worstServers", () => {
  it("ranks histograms by p95 (above 5 s worst) and keeps at most five per metric, public ids only", () => {
    const series = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((id, i) => hist("poller.cycle.duration", { server: id, group: "fast" }, { [i === 4 ? 12 : i]: 3 }));
    const out = worstServers(series, []);
    expect(out).toHaveLength(METRICS_WORST_SERVERS_PER_METRIC);
    expect(out[0]).toMatchObject({ kind: "histogram", server: "s5", p95Ms: null, labels: { group: "fast" } });
    expect(out.map((r) => r.server)).toEqual(["s5", "s7", "s6", "s4", "s3"]);
  });

  it("ranks counters by total and skips a series without a valid server id", () => {
    const out = worstServers([], [counter("c.m", { server: "a1" }, 1), counter("c.m", { server: "b2" }, 9), counter("c.m", {}, 100), counter("c.m", { server: "bad id!" }, 50)]);
    expect(out.map((r) => (r.kind === "counter" ? [r.server, r.total] : []))).toEqual([["b2", 9], ["a1", 1]]);
  });
});

describe("createMetricsService", () => {
  const fakeDb = (histRows: unknown[], counterRows: unknown[], alertRows: unknown[] = []) => ({
    query: async (sql: string) => ({ rows: sql.includes("alert_events") ? alertRows : sql.includes("unnest") ? histRows : counterRows }),
  });
  const now = () => Date.parse("2026-10-25T10:30:00Z");

  it("builds a contract-valid overview: system data, the other sections not built", async () => {
    const db = fakeDb(
      [
        { metric: "http.server.request.duration", labels: { route: "/api/health", status_class: "2xx" }, ord: 3, n: 4 },
        { metric: "http.server.request.duration", labels: { route: "/api/health", status_class: "2xx" }, ord: 13, n: 1 },
        { metric: "poller.cycle.duration", labels: { server: "abc123", group: "fast" }, ord: 4, n: 2 },
      ],
      [{ metric: "satis.agent.refused", labels: { server: "abc123", status: "401" }, total: "7" }],
    );
    const out = await createMetricsService({ db, now }).overview("24h");
    expect(MetricsOverviewSchema.parse(out)).toBeTruthy();
    expect(out.window).toBe("24h");
    expect(out.generatedAt).toBe("2026-10-25T10:30:00.000Z");
    expect(out.alerts).toEqual({ available: false, reason: "no_data" });
    expect(out.delivery).toEqual({ available: false, reason: "not_built" });
    if (!out.system.available) throw new Error("system should be available");
    expect(out.system.histograms.find((h) => h.metric === "http.server.request.duration")).toMatchObject({ count: 5, p50Ms: 5, p99Ms: null });
    expect(out.system.counters).toEqual([{ metric: "satis.agent.refused", labels: { status: "401" }, total: 7 }]);
    expect(out.system.servers.map((s) => s.server)).toEqual(["abc123", "abc123"]);
  });

  it("fills the alerts section from the alert log, drops an invalid kind and says no_data when empty", async () => {
    const alertRows = [
      { month: "2026-09", kind: "stopped_machines", fired: 3, flaps: 3, median_resolve_seconds: 120 },
      { month: "2026-10", kind: "power_outage", fired: 2, flaps: 0, median_resolve_seconds: null },
      { month: "2026-10", kind: "Bad Kind!", fired: 1, flaps: 0, median_resolve_seconds: null },
    ];
    const out = await createMetricsService({ db: fakeDb([], [], alertRows), now }).overview("1h");
    expect(out.alerts).toEqual({
      available: true,
      asOf: "2026-10-25T10:30:00.000Z",
      months: [
        { month: "2026-09", kind: "stopped_machines", fired: 3, flaps: 3, medianResolveSeconds: 120 },
        { month: "2026-10", kind: "power_outage", fired: 2, flaps: 0, medianResolveSeconds: null },
      ],
    });
    expect(MetricsOverviewSchema.parse(out)).toBeTruthy();
  });

  it("says no_data when nothing was recorded in the window", async () => {
    const out = await createMetricsService({ db: fakeDb([], []), now }).overview("1h");
    expect(out.system).toEqual({ available: false, reason: "no_data" });
    expect(MetricsOverviewSchema.parse(out)).toBeTruthy();
  });
});
