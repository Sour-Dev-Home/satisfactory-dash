import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  HistoryItemsQuerySchema,
  HistoryPowerQuerySchema,
  HistoryPowerResponseSchema,
  HistoryRangeSchema,
  HistoryTransitionsQuerySchema,
  endpoints,
} from "../src/index";

// ADR-0027 decision 3: the history contract. The fixtures are drift-tested against their schemas by name prefix in
// fixtures.test.ts; this pins the query rules and what the fixtures show.
describe("history queries", () => {
  it("every query is optional, so a bare GET works (range defaults to 24h)", () => {
    expect(HistoryPowerQuerySchema.parse({})).toEqual({ range: "24h" });
    expect(HistoryItemsQuerySchema.parse({})).toEqual({ range: "24h" });
    expect(HistoryTransitionsQuerySchema.parse({})).toEqual({ range: "24h", limit: 100 });
  });

  it("accepts each range, and refuses an unknown one", () => {
    for (const range of ["1h", "6h", "24h", "7d", "30d", "1y"]) {
      expect(HistoryRangeSchema.safeParse(range).success).toBe(true);
      expect(HistoryPowerQuerySchema.safeParse({ range }).success).toBe(true);
    }
    for (const range of ["", "2h", "1Y", "90d", "24", " 24h", "all"]) {
      expect(HistoryPowerQuerySchema.safeParse({ range }).success, range).toBe(false);
    }
  });

  it("transitions have no 1y range (they are kept 30 days) and cap the limit at 500", () => {
    expect(HistoryTransitionsQuerySchema.safeParse({ range: "1y" }).success).toBe(false);
    expect(HistoryTransitionsQuerySchema.parse({ limit: "500" }).limit).toBe(500);
    for (const limit of ["0", "501", "-1", "1.5", "abc"]) {
      expect(HistoryTransitionsQuerySchema.safeParse({ limit }).success, limit).toBe(false);
    }
  });

  it("an item is one class name, at most 200 characters", () => {
    expect(HistoryItemsQuerySchema.parse({ item: "Desc_IronPlate_C" }).item).toBe("Desc_IronPlate_C");
    expect(HistoryItemsQuerySchema.safeParse({ item: "" }).success).toBe(false);
    expect(HistoryItemsQuerySchema.safeParse({ item: "x".repeat(201) }).success).toBe(false);
  });
});

describe("history endpoints", () => {
  it("are server-scoped GETs", () => {
    for (const endpoint of [endpoints.history.power, endpoints.history.items, endpoints.history.transitions]) {
      expect(endpoint.method).toBe("GET");
      expect(endpoint.route.startsWith("/api/servers/:serverId/history/")).toBe(true);
    }
    expect(endpoints.history.power.path("alpha")).toBe("/api/servers/alpha/history/power");
    expect(endpoints.history.items.path("alpha")).toBe("/api/servers/alpha/history/items");
    expect(endpoints.history.transitions.path("alpha")).toBe("/api/servers/alpha/history/transitions");
  });
});

describe("history fixtures", () => {
  it("power: series are per (session, circuit), and a gap is left as a gap", () => {
    const { series } = fixtures.historyPower24h.data;
    expect(new Set(series.map((s) => `${s.session}:${s.circuit}`)).size).toBe(series.length);
    expect(series.length).toBeGreaterThan(1); // two sessions, same circuit id, never merged
    const gaps = series[0]!.points.map((p, i, all) => (i === 0 ? 0 : p.t - all[i - 1]!.t));
    expect(gaps.some((gap) => gap > fixtures.historyPower24h.data.resolutionSeconds * 1000)).toBe(true);
    expect(HistoryPowerResponseSchema.safeParse(fixtures.historyPower24h).success).toBe(true);
  });

  it("each fixture's points ascend and sit on a bucket boundary (UTC-aligned)", () => {
    const power = fixtures.historyPower24h.data;
    for (const s of power.series) {
      s.points.forEach((p, i) => {
        expect(p.t % (power.resolutionSeconds * 1000)).toBe(0);
        if (i > 0) expect(p.t).toBeGreaterThan(s.points[i - 1]!.t);
      });
    }
    const items = fixtures.historyItems7d.data;
    for (const s of items.series) {
      s.points.forEach((p, i) => {
        expect(p.t % (items.resolutionSeconds * 1000)).toBe(0);
        if (i > 0) expect(p.t).toBeGreaterThan(s.points[i - 1]!.t);
      });
    }
  });

  it("one fixture per source: 5-minute buckets (1-minute rollups) and 1-hour buckets (hourly rollups)", () => {
    expect(fixtures.historyPower24h.data.resolutionSeconds).toBeLessThan(3600);
    expect(fixtures.historyItems7d.data.resolutionSeconds).toBeGreaterThanOrEqual(3600);
  });

  it("transitions are newest first", () => {
    const times = fixtures.historyTransitions24h.data.transitions.map((t) => t.t);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("carry only invented values: no real host, token or personal data", () => {
    for (const fixture of [fixtures.historyPower24h, fixtures.historyItems7d, fixtures.historyTransitions24h]) {
      expect(JSON.stringify(fixture)).not.toMatch(/\d+\.\d+\.\d+\.\d+|token|password|@/i);
    }
  });
});
