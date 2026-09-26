import { describe, expect, it } from "vitest";
import { itemStats, toItemChartData } from "./itemHistory";

/** A minimal bucket point, defaults chosen so the fields under test are obvious at the call site. */
const point = (
  t: number,
  avg: number,
  opts: Partial<{ samples: number; min: number; max: number; maxPerMinute: number }> = {},
) => ({
  t,
  samples: opts.samples ?? 60,
  currentPerMinute: { min: opts.min ?? avg, avg, max: opts.max ?? avg },
  maxPerMinute: opts.maxPerMinute ?? 100,
});

describe("toItemChartData", () => {
  it("carries every point straight through when there's no gap", () => {
    const points = [point(0, 10), point(60_000, 12), point(120_000, 14)];
    expect(toItemChartData(points, 60)).toEqual([
      [0, 60, 120],
      [10, 12, 14],
      [100, 100, 100],
    ]);
  });

  it("inserts one null right after a gap, breaking the line", () => {
    // The bucket at 60s is missing entirely (paused or unreachable): nothing is interpolated.
    const points = [point(0, 10), point(120_000, 20)];
    expect(toItemChartData(points, 60)).toEqual([
      [0, 60, 120],
      [10, null, 20],
      [100, null, 100],
    ]);
  });

  it("still inserts only one null marker for a gap spanning several missing buckets", () => {
    // Buckets at 60s and 120s are both missing; the line should still break, but the gap marker
    // sits at the first missing slot only (documenting current behavior, not asserting more).
    const points = [point(0, 10), point(180_000, 20)];
    const [xs, current] = toItemChartData(points, 60);
    expect(xs).toEqual([0, 60, 180]);
    expect(current).toEqual([10, null, 20]);
  });

  it("returns empty series for no points", () => {
    expect(toItemChartData([], 60)).toEqual([[], [], []]);
  });

  it("has nothing to compare on a single point, so no gap logic applies", () => {
    expect(toItemChartData([point(0, 5)], 60)).toEqual([[0], [5], [100]]);
  });
});

describe("itemStats", () => {
  it("returns null when there are no points at all", () => {
    expect(itemStats([])).toBeNull();
  });

  it("weights the average by each bucket's sample count, not a plain mean", () => {
    const points = [point(0, 10, { samples: 1 }), point(60_000, 20, { samples: 3 })];
    const stats = itemStats(points);
    // A plain mean would be 15; weighted by samples it leans toward the heavier bucket.
    expect(stats?.average).toBeCloseTo((10 * 1 + 20 * 3) / 4);
  });

  it("takes low/high from the bucket min/max, never from the averages", () => {
    const points = [point(0, 10, { min: 5, max: 15 }), point(60_000, 12, { min: 8, max: 30 })];
    const stats = itemStats(points);
    expect(stats?.low).toBe(5);
    expect(stats?.high).toBe(30);
  });

  it("takes capacity from only the newest bucket, not an average of all of them", () => {
    const points = [point(0, 10, { maxPerMinute: 50 }), point(60_000, 10, { maxPerMinute: 80 })];
    expect(itemStats(points)?.capacity).toBe(80);
  });

  it("handles a single point: average is that bucket, low/high are its min/max", () => {
    const stats = itemStats([point(0, 10, { min: 8, max: 12, maxPerMinute: 40 })]);
    expect(stats).toEqual({ average: 10, low: 8, high: 12, capacity: 40 });
  });
});
