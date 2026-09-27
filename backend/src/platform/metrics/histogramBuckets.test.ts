import { describe, it, expect } from "vitest";
import { BUCKET_BOUNDS_MS, bucketIndex, emptyBucketCounts, mergeBucketCounts } from "./histogramBuckets.js";

describe("bucketIndex", () => {
  it("returns the first bucket a value fits in, and the values ADR-0037 lists", () => {
    expect(bucketIndex(1)).toBe(0); // exactly the first bound
    expect(bucketIndex(1.5)).toBe(1); // between 1 and 2
    expect(bucketIndex(0)).toBe(0);
    expect(bucketIndex(5000)).toBe(BUCKET_BOUNDS_MS.length - 2); // exactly the last finite bound
  });

  it("puts anything past the last finite bound in the +Infinity bucket", () => {
    expect(bucketIndex(5001)).toBe(BUCKET_BOUNDS_MS.length - 1);
    expect(bucketIndex(1_000_000)).toBe(BUCKET_BOUNDS_MS.length - 1);
  });

  it("never returns an out-of-range index, for any non-negative value", () => {
    for (const value of [0, 0.5, 3, 999, 1_500, 4_999, 5_000, 5_000_000]) {
      const index = bucketIndex(value);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(BUCKET_BOUNDS_MS.length);
    }
  });
});

describe("mergeBucketCounts (the JS mirror of the migration's SQL merge function)", () => {
  it("adds two bucket arrays element-wise", () => {
    const a = emptyBucketCounts();
    a[0] = 3;
    a[5] = 1;
    const b = emptyBucketCounts();
    b[0] = 2;
    b[12] = 4;
    expect(mergeBucketCounts(a, b)).toEqual(
      emptyBucketCounts().map((_, i) => (i === 0 ? 5 : i === 5 ? 1 : i === 12 ? 4 : 0)),
    );
  });

  it("merging with all-zero is a no-op", () => {
    const a = emptyBucketCounts();
    a[3] = 7;
    expect(mergeBucketCounts(a, emptyBucketCounts())).toEqual(a);
  });

  it("refuses to merge arrays of different lengths", () => {
    expect(() => mergeBucketCounts(emptyBucketCounts(), [1, 2, 3])).toThrow(/length mismatch/);
  });
});
