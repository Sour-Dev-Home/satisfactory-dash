import { describe, expect, it } from "vitest";
import { TokenBucketLimiter } from "./tokenBucket.js";

describe("TokenBucketLimiter against clock steps and long gaps (#514)", () => {
  it("a clock that steps back does not later refill the bucket for time that never passed", () => {
    let t = 10_000_000;
    const bucket = new TokenBucketLimiter({ capacity: 10, refillPerSecond: 1, now: () => t });
    for (let i = 0; i < 10; i++) expect(bucket.take("k")).toBe(0);
    t += 5_000; // 5 tokens back
    expect(bucket.take("k", 1)).toBe(0); // 4 left
    t -= 3_600_000; // the clock is set back an hour
    expect(bucket.take("k", 1)).toBe(0); // 3 left, stored at the earlier time unless guarded
    t += 3_600_000; // corrected: no real time has passed since the last spend
    for (let i = 0; i < 3; i++) expect(bucket.take("k")).toBe(0);
    expect(bucket.take("k")).toBeGreaterThan(0); // an hour of phantom refill would refill it to 10
  });

  it("refills across a very long gap to exactly the capacity, never beyond", () => {
    let t = 0;
    const bucket = new TokenBucketLimiter({ capacity: 5, refillPerSecond: 0.6, now: () => t });
    for (let i = 0; i < 5; i++) bucket.take("k");
    t += 365 * 24 * 3600 * 1000;
    for (let i = 0; i < 5; i++) expect(bucket.take("k")).toBe(0);
    expect(bucket.take("k")).toBeGreaterThan(0);
  });

  it("debt is floored at minus the capacity and repaid at the refill rate", () => {
    let t = 0;
    const bucket = new TokenBucketLimiter({ capacity: 100, refillPerSecond: 10, now: () => t });
    bucket.charge("k", 1_000_000);
    expect(bucket.admit("k")).toBe(10);
    t += 10_000;
    expect(bucket.admit("k")).toBeGreaterThan(0); // exactly zero is still in debt
    t += 1_000;
    expect(bucket.admit("k")).toBe(0);
  });
});
