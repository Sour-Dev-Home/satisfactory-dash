import { describe, expect, it } from "vitest";
import { UserRateLimiter } from "./userRateLimiter.js";

describe("UserRateLimiter", () => {
  it("allows up to max hits per window, then reports the seconds left", () => {
    let now = 1_000;
    const limiter = new UserRateLimiter({ max: 3, windowMs: 60_000, now: () => now });
    expect([limiter.hit("u"), limiter.hit("u"), limiter.hit("u")]).toEqual([0, 0, 0]);
    expect(limiter.hit("u")).toBe(60);
    now += 30_000;
    expect(limiter.hit("u")).toBe(30);
  });

  it("starts a fresh window once the old one has ended", () => {
    let now = 0;
    const limiter = new UserRateLimiter({ max: 1, windowMs: 1_000, now: () => now });
    expect(limiter.hit("u")).toBe(0);
    expect(limiter.hit("u")).toBeGreaterThan(0);
    now += 1_000;
    expect(limiter.hit("u")).toBe(0);
  });

  it("keeps a separate count per key", () => {
    const limiter = new UserRateLimiter({ max: 1, windowMs: 60_000, now: () => 0 });
    expect(limiter.hit("a")).toBe(0);
    expect(limiter.hit("b")).toBe(0);
    expect(limiter.hit("a")).toBeGreaterThan(0);
    expect(limiter.hit("b")).toBeGreaterThan(0);
  });

  it("a flood of distinct keys evicts one counter at a time, not everyone's at once", () => {
    const limiter = new UserRateLimiter({ max: 1, windowMs: 60_000, now: () => 0 });
    for (let i = 0; i < 1_000; i++) limiter.hit(`user-${i}`);
    limiter.hit("newcomer"); // the table is full: only user-0's window is dropped
    expect(limiter.hit("user-1")).toBeGreaterThan(0); // still counted, still limited
    expect(limiter.hit("user-999")).toBeGreaterThan(0);
  });

  it("stays bounded under many distinct keys", () => {
    const limiter = new UserRateLimiter({ max: 1, windowMs: 60_000, now: () => 0 });
    for (let i = 0; i < 5_000; i++) limiter.hit(`user-${i}`);
    expect(limiter.hit("fresh")).toBe(0);
  });
});
