import { describe, expect, it } from "vitest";
import { bucketTotal, percentileUpperBound, rankOf, summarizeBuckets } from "./percentiles.js";

// Bounds: 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, +inf (13 buckets).
const buckets = (at: Record<number, number>): number[] => Array.from({ length: 13 }, (_, i) => at[i] ?? 0);

describe("percentileUpperBound", () => {
  it("is undefined for an empty histogram and for a wrong-width array", () => {
    expect(percentileUpperBound(buckets({}), 0.5)).toBeUndefined();
    expect(summarizeBuckets(buckets({}))).toBeUndefined();
    expect(percentileUpperBound([1, 2, 3], 0.5)).toBeUndefined();
  });

  it("one observation in one bucket gives that bucket's bound for every percentile", () => {
    expect(summarizeBuckets(buckets({ 7: 1 }))).toEqual({ p50Ms: 200, p95Ms: 200, p99Ms: 200 });
  });

  it("uses the nearest rank: p50 of 10 is the 5th observation, p95 the 10th", () => {
    const b = buckets({ 0: 5, 8: 4, 11: 1 }); // 5 at <=1, 4 at <=500, 1 at <=5000
    expect(percentileUpperBound(b, 0.5)).toBe(1);
    expect(percentileUpperBound(b, 0.51)).toBe(500);
    expect(percentileUpperBound(b, 0.9)).toBe(500);
    expect(percentileUpperBound(b, 0.95)).toBe(5000);
  });

  it("is null (above 5 s) when the rank lands in the open-ended last bucket, and for all +inf", () => {
    expect(summarizeBuckets(buckets({ 12: 4 }))).toEqual({ p50Ms: null, p95Ms: null, p99Ms: null });
    expect(summarizeBuckets(buckets({ 2: 98, 12: 2 }))).toEqual({ p50Ms: 5, p95Ms: 5, p99Ms: null });
  });

  it("keeps p50 <= p95 <= p99", () => {
    const s = summarizeBuckets(buckets({ 1: 30, 4: 30, 9: 30, 12: 10 }))!;
    expect(rankOf(s.p50Ms)).toBeLessThanOrEqual(rankOf(s.p95Ms));
    expect(rankOf(s.p95Ms)).toBeLessThanOrEqual(rankOf(s.p99Ms));
  });

  it("sums the total", () => {
    expect(bucketTotal(buckets({ 0: 2, 12: 3 }))).toBe(5);
    expect(rankOf(null)).toBe(Number.POSITIVE_INFINITY);
  });
});
