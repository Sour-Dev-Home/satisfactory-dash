import { describe, expect, it } from "vitest";
import { createMetricsService, foldHistograms, windowBounds, worstServers } from "./metricsService.js";
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

describe("metrics service gaps (fresh-eyes pass)", () => {
  it("windowBounds on an exact hour boundary starts exactly one window back", () => {
    const now = Date.parse("2026-10-25T10:00:00Z");
    expect(windowBounds("1h", now).from.toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(windowBounds("7d", now).from.toISOString()).toBe("2026-10-18T10:00:00.000Z");
  });

  it("worstServers breaks a p95 tie by p99, then count, then server id", () => {
    const out = worstServers(
      [
        hist("m.t", { server: "b" }, { 2: 98, 3: 2 }),
        hist("m.t", { server: "a" }, { 2: 100 }),
        hist("m.t", { server: "c" }, { 2: 100 }),
        hist("m.t", { server: "d" }, { 2: 50 }),
      ],
      [],
    );
    expect(out.map((r) => r.server)).toEqual(["b", "a", "c", "d"]);
  });

  it("worstServers does not mix a histogram and a counter of the same name", () => {
    const out = worstServers([hist("m.same", { server: "a" }, { 0: 1 })], [counter("m.same", { server: "a" }, 3)]);
    expect(out.map((r) => r.kind).sort()).toEqual(["counter", "histogram"]);
  });

  it("worstServers lists distinct servers (label sets of one server must not crowd out others)", () => {
    const series = ["x1", "x2", "x3", "x4", "x5", "x6"].flatMap((id, i) => [
      hist("m.d", { server: id, group: "fast" }, { [6 + i]: 1 }),
      hist("m.d", { server: id, group: "slow" }, { [6 + i]: 1 }),
    ]);
    const servers = worstServers(series, []).map((r) => r.server);
    expect(new Set(servers).size).toBe(servers.length);
  });

  it("foldHistograms ignores a wrong-width series without throwing", () => {
    expect(foldHistograms([{ metric: "m.w", labels: new Map(), buckets: [1, 2] }])).toEqual([]);
  });

  it("a stored row with a non-string label value loses that label, it is not coerced", async () => {
    const db = {
      query: async (sql: string) => ({
        rows: sql.includes("unnest") ? [{ metric: "m.n", labels: { route: "/a", extra: 5 }, ord: 1, n: 2 }] : [],
      }),
    };
    const out = await createMetricsService({ db, now: () => Date.parse("2026-10-25T10:30:00Z") }).overview("1h");
    if (!out.system.available) throw new Error("expected data");
    expect(out.system.histograms[0].labels).toEqual({ route: "/a" });
  });

  it("ignores bucket ordinals beyond 13", async () => {
    const db = {
      query: async (sql: string) => ({
        rows: sql.includes("unnest")
          ? [
              { metric: "m.o", labels: {}, ord: 13, n: 2 },
              { metric: "m.o", labels: {}, ord: 14, n: 99 },
            ]
          : [],
      }),
    };
    const out = await createMetricsService({ db, now: () => 0 }).overview("1h");
    if (!out.system.available) throw new Error("expected data");
    expect(out.system.histograms[0]).toMatchObject({ count: 2, p50Ms: null });
  });
});
