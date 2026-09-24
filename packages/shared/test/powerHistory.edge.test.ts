import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as fixtures from "../fixtures/index";
import { PowerHistoryResponseSchema, PowerHistorySchema } from "../src/index";

const histories = Object.entries(fixtures).filter(([name]) => name.startsWith("powerHistory"));
const good = fixtures.powerHistoryNormal;
const point = good.data.series[0].points[0];
const parse = (data: unknown) => PowerHistoryResponseSchema.safeParse({ ...good, data });
const withPoint = (p: object) => ({ ...good.data, series: [{ circuitGroupId: 0, points: [p] }] });

describe("power history schema edge cases (what the poller can really produce)", () => {
  it("has the four named fixtures", () => {
    expect(histories.map(([n]) => n).sort()).toEqual([
      "powerHistoryEmpty",
      "powerHistoryFuseTrip",
      "powerHistoryNormal",
      "powerHistoryPaused",
    ]);
  });

  it("accepts a circuit that appears mid-window (fewer points, starting later than the others)", () => {
    const late = good.data.series[0].points.slice(40);
    expect(parse({ ...good.data, series: [good.data.series[0], { circuitGroupId: 7, points: late }] }).success).toBe(true);
  });

  it("accepts a gap after a failed poll (points more than one interval apart)", () => {
    const pts = good.data.series[0].points.filter((_, i) => i < 20 || i > 30);
    expect(parse({ ...good.data, series: [{ circuitGroupId: 0, points: pts }] }).success).toBe(true);
  });

  it("accepts a paused range still open at the newest sample, and a single-sample range", () => {
    const last = good.data.series[0].points.at(-1)!.t;
    expect(parse({ ...good.data, pausedRanges: [{ fromT: last - 20000, toT: last }] }).success).toBe(true);
    expect(parse({ ...good.data, pausedRanges: [{ fromT: last, toT: last }] }).success).toBe(true);
  });

  it("accepts a series with no points yet", () => {
    expect(parse({ ...good.data, series: [{ circuitGroupId: 0, points: [] }] }).success).toBe(true);
  });

  it("rejects a t beyond the safe-integer range", () => {
    expect(parse(withPoint({ ...point, t: Number.MAX_SAFE_INTEGER + 2 })).success).toBe(false);
    expect(parse(withPoint({ ...point, t: 1e21 })).success).toBe(false);
  });

  it("rejects non-finite readings (NaN, Infinity) in every numeric field", () => {
    for (const key of ["productionMW", "consumptionMW", "capacityMW", "batteryPercent"] as const) {
      for (const bad of [Number.NaN, Infinity, -Infinity]) {
        expect(parse(withPoint({ ...point, [key]: bad })).success, `${key}=${bad}`).toBe(false);
      }
    }
    expect(parse({ ...good.data, windowSeconds: Infinity }).success).toBe(false);
  });

  it("rejects a non-integer circuit group id and a non-integer paused bound", () => {
    expect(parse({ ...good.data, series: [{ circuitGroupId: 0.5, points: [] }] }).success).toBe(false);
    expect(parse({ ...good.data, pausedRanges: [{ fromT: 1.5, toT: 2 }] }).success).toBe(false);
  });

  it("strips unknown keys (points and top level) rather than leaking them", () => {
    const parsed = PowerHistoryResponseSchema.parse({
      ...good,
      data: { ...good.data, series: [{ circuitGroupId: 0, extra: 1, points: [{ ...point, gamePaused: true }] }] },
    });
    expect(parsed.data.series[0]).toEqual({ circuitGroupId: 0, points: [point] });
  });
});

describe("power history fixtures are identical in jitless and normal zod mode", () => {
  it.each(histories)("%s", (_name, fixture) => {
    const normal = PowerHistoryResponseSchema.parse(fixture);
    z.config({ jitless: true });
    try {
      // A fresh schema instance is needed for the flag to matter; re-parse via a new object.
      const fresh = z.object({ data: PowerHistorySchema }).parse({ data: (fixture as { data: unknown }).data });
      expect(fresh.data).toEqual(normal.data);
    } finally {
      z.config({ jitless: false });
    }
    expect(normal).toEqual(fixture);
  });
});

describe("power history fixtures are deterministic", () => {
  it("serialize identically across two imports of the module", async () => {
    vi.resetModules();
    const again = await import("../fixtures/powerHistory");
    expect(again.powerHistoryNormal).not.toBe(fixtures.powerHistoryNormal); // really a fresh evaluation
    for (const [name, fixture] of histories) {
      expect(JSON.stringify(again[name as keyof typeof again]), name).toBe(JSON.stringify(fixture));
    }
  });

  it("pin the last sample time (no dependence on the clock or the time zone)", () => {
    for (const [, h] of histories) {
      for (const s of (h as typeof good).data.series) {
        expect(s.points.at(-1)!.t).toBe(Date.UTC(2026, 8, 22, 22, 42, 39));
      }
    }
  });
});
