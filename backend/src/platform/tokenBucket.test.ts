import { describe, expect, it } from "vitest";
import { TokenBucketLimiter } from "./tokenBucket.js";

describe("TokenBucketLimiter.take", () => {
  it("allows exactly `capacity` at once (n allowed, n+1 refused), then reports the seconds until one more refills", () => {
    const bucket = new TokenBucketLimiter({ capacity: 3, refillPerSecond: 0.5, now: () => 0 });
    expect([bucket.take("k"), bucket.take("k"), bucket.take("k")]).toEqual([0, 0, 0]);
    expect(bucket.take("k")).toBe(2); // one token at 0.5 a second
  });

  it("refills at the steady rate, never above capacity", () => {
    let now = 0;
    const bucket = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 1, now: () => now });
    bucket.take("k");
    bucket.take("k");
    now += 1_000;
    expect(bucket.take("k")).toBe(0);
    expect(bucket.take("k")).toBe(1);
    now += 60_000; // a long rest refills to 2, not 60
    expect([bucket.take("k"), bucket.take("k")]).toEqual([0, 0]);
    expect(bucket.take("k")).toBeGreaterThan(0);
  });

  it("a refused take spends nothing", () => {
    let now = 0;
    const bucket = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 1, now: () => now });
    bucket.take("k");
    for (let i = 0; i < 10; i++) expect(bucket.take("k")).toBe(1);
    now += 1_000;
    expect(bucket.take("k")).toBe(0);
  });

  it("takes a cost larger than one, and keeps keys apart", () => {
    const bucket = new TokenBucketLimiter({ capacity: 10, refillPerSecond: 1, now: () => 0 });
    expect(bucket.take("a", 10)).toBe(0);
    expect(bucket.take("a", 1)).toBe(1);
    expect(bucket.take("b", 10)).toBe(0);
    expect(bucket.take("c", 11)).toBe(1); // more than the bucket holds: waits for the missing one
  });

  it("refuses a bad configuration", () => {
    expect(() => new TokenBucketLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow(RangeError);
    expect(() => new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0 })).toThrow(RangeError);
  });
});

describe("TokenBucketLimiter.admit and charge (cost known only afterwards)", () => {
  it("admits while the balance is positive; one charge may go into debt; then refuses until the debt is repaid", () => {
    let now = 0;
    const bucket = new TokenBucketLimiter({ capacity: 100, refillPerSecond: 10, now: () => now });
    expect(bucket.admit("k")).toBe(0);
    bucket.charge("k", 99);
    expect(bucket.admit("k")).toBe(0); // 1 left: still admitted
    bucket.charge("k", 51); // -50
    expect(bucket.admit("k")).toBe(5); // 50 at 10 a second
    now += 4_000;
    expect(bucket.admit("k")).toBe(1); // -10
    now += 1_000;
    expect(bucket.admit("k")).toBe(1); // exactly 0 is not positive
    now += 100;
    expect(bucket.admit("k")).toBe(0);
  });

  it("an item bigger than the whole bucket is still admitted from a positive balance, so it is slowed, never locked out", () => {
    let now = 0;
    const bucket = new TokenBucketLimiter({ capacity: 10, refillPerSecond: 1, now: () => now });
    expect(bucket.admit("k")).toBe(0);
    bucket.charge("k", 1_000); // debt is floored at -capacity
    expect(bucket.admit("k")).toBe(10);
    now += 10_100;
    expect(bucket.admit("k")).toBe(0);
  });

  it("admit spends nothing", () => {
    const bucket = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 1, now: () => 0 });
    for (let i = 0; i < 10; i++) expect(bucket.admit("k")).toBe(0);
    expect(bucket.take("k")).toBe(0);
  });
});

describe("TokenBucketLimiter's key table is bounded", () => {
  it("never tracks more than maxKeys, dropping full buckets first", () => {
    const bucket = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 1, maxKeys: 3, now: () => 0 });
    bucket.take("busy", 2);
    for (let i = 0; i < 100; i++) bucket.take(`k${i}`);
    expect(bucket.size).toBeLessThanOrEqual(3);
  });

  it("keeps a key in debt when the table is full of refilled ones", () => {
    let now = 0;
    const bucket = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 1, maxKeys: 3, now: () => now });
    bucket.take("a");
    bucket.take("b");
    now += 5_000; // a and b are full again
    bucket.take("busy", 2);
    bucket.take("c");
    bucket.take("d");
    expect(bucket.take("busy")).toBeGreaterThan(0); // its spent balance survived the evictions
  });
});
