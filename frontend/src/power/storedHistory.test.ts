import { describe, expect, it } from "vitest";
import { historyPower24h } from "@satisfactory-dash/shared/fixtures";
import { currentSession, fuseStretches, storedStats, toStoredChartData } from "./storedHistory";

const history = historyPower24h.data;
const newest = history.series[0];

describe("currentSession", () => {
  it("keeps the newest session's circuits and counts the older sessions", () => {
    const { shown, olderSessions } = currentSession(history.series);
    expect(shown.every((s) => s.session === newest.session)).toBe(true);
    expect(olderSessions).toBe(new Set(history.series.map((s) => s.session)).size - 1);
  });

  it("is empty for no series", () => {
    expect(currentSession([])).toEqual({ shown: [], olderSessions: 0 });
  });
});

describe("toStoredChartData", () => {
  it("draws the bucket averages in seconds, and breaks the line at a missing bucket", () => {
    const [xs, production, consumption, capacity] = toStoredChartData(newest.points, history.resolutionSeconds);
    // The fixture skips its third bucket: a null goes in right after the second.
    expect(xs.length).toBe(newest.points.length + 1);
    expect(xs[0]).toBe(newest.points[0].t / 1000);
    expect(production[0]).toBe(newest.points[0].productionMW.avg);
    expect(production[2]).toBeNull();
    expect(consumption[2]).toBeNull();
    expect(capacity[2]).toBeNull();
    expect(xs[2]).toBe((newest.points[1].t + history.resolutionSeconds * 1000) / 1000);
  });

  it("adds no break between consecutive buckets", () => {
    const [xs] = toStoredChartData(newest.points.slice(0, 2), history.resolutionSeconds);
    expect(xs).toHaveLength(2);
  });
});

describe("storedStats", () => {
  it("takes the newest average, and the lowest and highest single sample over the range", () => {
    const stats = storedStats(newest.points)!;
    expect(stats.production.latest).toBe(newest.points.at(-1)!.productionMW.avg);
    expect(stats.production.min).toBe(Math.min(...newest.points.map((p) => p.productionMW.min)));
    expect(stats.production.max).toBe(Math.max(...newest.points.map((p) => p.productionMW.max)));
  });

  it("is null without points", () => {
    expect(storedStats([])).toBeNull();
  });
});

describe("fuseStretches", () => {
  it("joins consecutive tripped buckets into one stretch", () => {
    const step = history.resolutionSeconds * 1000;
    const tripped = { ...newest.points[0], fuseTrippedSamples: 3 };
    const points = [tripped, { ...tripped, t: tripped.t + step }, { ...tripped, t: tripped.t + 3 * step }];
    expect(fuseStretches(points, history.resolutionSeconds)).toEqual([
      { fromT: tripped.t, toT: tripped.t + 2 * step },
      { fromT: tripped.t + 3 * step, toT: tripped.t + 4 * step },
    ]);
  });

  it("finds the fixture's tripped bucket", () => {
    expect(fuseStretches(newest.points, history.resolutionSeconds)).toHaveLength(1);
  });
});
