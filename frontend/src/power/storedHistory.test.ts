import { describe, expect, it } from "vitest";
import { historyPower24h } from "@satisfactory-dash/shared/fixtures";
import { currentSession, fuseStretches, missingStretches, storedStats, toStoredChartData } from "./storedHistory";

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

  it("sorts the newest session's circuits by id, even when the backend sends them out of order", () => {
    const outOfOrder = [
      { ...newest, circuit: 5 },
      { ...newest, circuit: 1 },
      { ...newest, circuit: 3 },
    ];
    const { shown } = currentSession(outOfOrder);
    expect(shown.map((s) => s.circuit)).toEqual([1, 3, 5]);
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

  it("still only inserts a single null for multiple consecutive missing buckets", () => {
    const step = history.resolutionSeconds * 1000;
    const points = [newest.points[0], { ...newest.points[0], t: newest.points[0].t + 4 * step }];
    const [xs, production] = toStoredChartData(points, history.resolutionSeconds);
    // One point, one gap marker, one point: not one marker per missing bucket.
    expect(xs).toHaveLength(3);
    expect(production[1]).toBeNull();
  });

  it("draws a single point with no break", () => {
    const [xs, production] = toStoredChartData(newest.points.slice(0, 1), history.resolutionSeconds);
    expect(xs).toEqual([newest.points[0].t / 1000]);
    expect(production).toEqual([newest.points[0].productionMW.avg]);
  });

  it("draws nothing for an empty series", () => {
    expect(toStoredChartData([], history.resolutionSeconds)).toEqual([[], [], [], []]);
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

  it("takes the only point's own min/avg/max for a single-point series", () => {
    const [only] = newest.points;
    const stats = storedStats([only])!;
    expect(stats.production).toEqual({ latest: only.productionMW.avg, min: only.productionMW.min, max: only.productionMW.max });
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

describe("missingStretches", () => {
  const step = history.resolutionSeconds * 1000;
  const t0 = newest.points[0].t;
  const at = (t: number) => ({ ...newest.points[0], t });

  it("spans from the end of the last recorded bucket to the next recorded one", () => {
    const points = [at(t0), at(t0 + step), at(t0 + 4 * step), at(t0 + 6 * step)];
    expect(missingStretches(points, history.resolutionSeconds)).toEqual([
      { fromT: t0 + 2 * step, toT: t0 + 4 * step },
      { fromT: t0 + 5 * step, toT: t0 + 6 * step },
    ]);
  });

  it("is empty for consecutive buckets, one point, or none", () => {
    expect(missingStretches([at(t0), at(t0 + step)], history.resolutionSeconds)).toEqual([]);
    expect(missingStretches([at(t0)], history.resolutionSeconds)).toEqual([]);
    expect(missingStretches([], history.resolutionSeconds)).toEqual([]);
  });

  it("matches the breaks toStoredChartData draws", () => {
    const [xs, production] = toStoredChartData(newest.points, history.resolutionSeconds);
    const breaks = xs.filter((_, i) => production[i] === null).map((x) => x * 1000);
    expect(missingStretches(newest.points, history.resolutionSeconds).map((m) => m.fromT)).toEqual(breaks);
  });

  it("finds no gap for a duplicate timestamp (zero-width, not negative)", () => {
    expect(missingStretches([at(t0), at(t0)], history.resolutionSeconds)).toEqual([]);
  });

  it("still reports a gap when a bucket is off the resolution grid (a jittery backend timestamp)", () => {
    // One second past a whole step: still a gap, spanning to the actual next point (not rounded to the grid).
    const points = [at(t0), at(t0 + step + 1000)];
    expect(missingStretches(points, history.resolutionSeconds)).toEqual([{ fromT: t0 + step, toT: t0 + step + 1000 }]);
  });
});

describe("fuseStretches, duplicate and unaligned buckets", () => {
  const step = history.resolutionSeconds * 1000;
  const t0 = newest.points[0].t;
  const tripped = { ...newest.points[0], fuseTrippedSamples: 3 };

  it("does not double-count a duplicate timestamp as two stretches", () => {
    const points = [tripped, { ...tripped }];
    expect(fuseStretches(points, history.resolutionSeconds)).toEqual([{ fromT: t0, toT: t0 + step }]);
  });

  // Points are documented as "oldest first" (history.ts), so the rest shouldn't come from the
  // backend; if they do, every trip is still listed once, oldest first.
  it("keeps a trip that arrives out of order, listed oldest first", () => {
    const points = [{ ...tripped, t: t0 + 5 * step }, { ...tripped, t: t0 + 2 * step }];
    expect(fuseStretches(points, history.resolutionSeconds)).toEqual([
      { fromT: t0 + 2 * step, toT: t0 + 3 * step },
      { fromT: t0 + 5 * step, toT: t0 + 6 * step },
    ]);
  });

  it("doesn't double a stretch when its bucket repeats after an out-of-order trip", () => {
    const points = [
      { ...tripped, t: t0 + 5 * step },
      { ...tripped, t: t0 + 2 * step },
      { ...tripped, t: t0 + 5 * step }, // same bucket as the first point
    ];
    expect(fuseStretches(points, history.resolutionSeconds)).toEqual([
      { fromT: t0 + 2 * step, toT: t0 + 3 * step },
      { fromT: t0 + 5 * step, toT: t0 + 6 * step },
    ]);
  });

  it("doesn't split a stretch when an adjacent bucket arrives after an out-of-order trip", () => {
    const points = [
      { ...tripped, t: t0 + 5 * step },
      { ...tripped, t: t0 + 2 * step },
      { ...tripped, t: t0 + 6 * step }, // extends the first stretch
    ];
    expect(fuseStretches(points, history.resolutionSeconds)).toEqual([
      { fromT: t0 + 2 * step, toT: t0 + 3 * step },
      { fromT: t0 + 5 * step, toT: t0 + 7 * step },
    ]);
  });

  it("does not sort the caller's array in place", () => {
    const points = Object.freeze([
      { ...tripped, t: t0 + 5 * step },
      { ...tripped, t: t0 + 2 * step },
    ]);
    // A frozen array throws if fuseStretches tried to sort it directly instead of a copy.
    expect(() => fuseStretches(points, history.resolutionSeconds)).not.toThrow();
    expect(points.map((p) => p.t)).toEqual([t0 + 5 * step, t0 + 2 * step]);
  });

  it("matches the un-sorted result for already oldest-first input", () => {
    const points = [{ ...tripped, t: t0 + 2 * step }, { ...tripped, t: t0 + 5 * step }];
    expect(fuseStretches(points, history.resolutionSeconds)).toEqual([
      { fromT: t0 + 2 * step, toT: t0 + 3 * step },
      { fromT: t0 + 5 * step, toT: t0 + 6 * step },
    ]);
  });
});
