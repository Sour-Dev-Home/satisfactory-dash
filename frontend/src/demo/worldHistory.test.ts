import {
  HistoryItemsResponseSchema,
  HistoryRangeSchema,
  HistoryTransitionsResponseSchema,
  TransitionRangeSchema,
} from "@satisfactory-dash/shared";
import { describe, expect, it } from "vitest";
import { sinceYesterday } from "../factory/sinceYesterday";
import * as world from "./world";

// The demo's stored history (ADR-0027 decision 3, item 7): every range valid against the contract,
// the resolution the backend would pick, and a dip that "since yesterday" can point at.

const now = world.DEMO_EPOCH;

describe("the demo's production history", () => {
  it.each(HistoryRangeSchema.options)("is valid for %s, at the backend's resolution, within 600 points", (range) => {
    const body = world.historyItems(now, range);
    expect(() => HistoryItemsResponseSchema.parse(body)).not.toThrow();
    expect(body.data.resolutionSeconds).toBe({ "1h": 60, "6h": 60, "24h": 300, "7d": 3600, "30d": 21600, "1y": 86400 }[range]);
    for (const { points } of body.data.series) {
      expect(points.length).toBeLessThanOrEqual(600);
      for (const p of points) {
        expect(p.t % (body.data.resolutionSeconds * 1000)).toBe(0);
        expect(p.t).toBeLessThanOrEqual(now);
        expect(p.currentPerMinute.min).toBeLessThanOrEqual(p.currentPerMinute.avg);
        expect(p.currentPerMinute.avg).toBeLessThanOrEqual(p.currentPerMinute.max);
      }
      // Oldest first, as the contract says.
      expect(points.map((p) => p.t)).toEqual([...points.map((p) => p.t)].sort((a, b) => a - b));
    }
  });

  it("only records items the demo factory makes, so every name and unit resolves", () => {
    const made = new Set(world.factory(now).data.buildings.flatMap((b) => b.production.map((r) => r.className)));
    for (const { item } of world.historyItems(now, "24h").data.series) expect(made).toContain(item);
  });

  it("answers one item when asked, and nothing for an item it doesn't make", () => {
    expect(world.historyItems(now, "24h", "Desc_IronScrew_C").data.series.map((s) => s.item)).toEqual(["Desc_IronScrew_C"]);
    expect(world.historyItems(now, "24h", "Desc_Nope_C").data.series).toEqual([]);
  });

  it("has a gap where the game was paused, never filled in", () => {
    const { points } = world.historyItems(now, "7d", "Desc_IronPlate_C").data.series[0];
    const hours = new Set(points.map((p) => p.t));
    const pausedHour = Math.floor((now - 49 * 3_600_000) / 3_600_000) * 3_600_000;
    expect(hours.has(pausedHour)).toBe(false);
    expect(hours.has(pausedHour - 24 * 3_600_000)).toBe(true);
  });

  it("shows a visible dip: since yesterday, the Rotor and Screw lines are down", () => {
    const result = sinceYesterday(world.historyItems(now, "7d").data);
    if (!result.enough) throw new Error("the demo should have a day of history");
    expect(result.down.map((c) => c.item)).toEqual(["Desc_Rotor_C", "Desc_IronScrew_C"]);
    expect(result.down[0]).toMatchObject({ after: 0 });
  });

  it.each(TransitionRangeSchema.options)("has valid state transitions for %s, newest first", (range) => {
    const body = world.historyTransitions(now, range, 500);
    expect(() => HistoryTransitionsResponseSchema.parse(body)).not.toThrow();
    const times = body.data.transitions.map((t) => t.t);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    for (const t of times) expect(t).toBeGreaterThanOrEqual(body.data.from);
  });

  it("caps transitions at the limit and says so", () => {
    const capped = world.historyTransitions(now, "24h", 10).data;
    expect(capped.transitions).toHaveLength(10);
    expect(capped.truncated).toBe(true);
    expect(world.historyTransitions(now, "1h", 500).data.truncated).toBe(false);
  });
});
