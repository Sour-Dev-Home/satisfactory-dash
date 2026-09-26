import { describe, expect, it } from "vitest";
import { BASE_DELAY_MS, DEAD_AFTER_MS, isDead, MAX_DELAY_MS, retryDelayMs } from "./retryPolicy.js";

describe("retryDelayMs: exponential backoff, never sooner than Discord asked", () => {
  it("starts at 30 s and doubles", () => {
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt))).toEqual([30_000, 60_000, 120_000, 240_000, 480_000]);
  });

  it("is capped at 30 minutes, however many attempts, without overflowing", () => {
    expect(retryDelayMs(7)).toBe(MAX_DELAY_MS);
    expect(retryDelayMs(1000)).toBe(MAX_DELAY_MS);
    expect(retryDelayMs(Number.MAX_SAFE_INTEGER)).toBe(MAX_DELAY_MS);
  });

  it("honours a longer retry_after, and ignores a shorter one", () => {
    expect(retryDelayMs(1, 120_000)).toBe(120_000);
    expect(retryDelayMs(3, 1000)).toBe(120_000);
    expect(retryDelayMs(10, 3_600_000)).toBe(3_600_000);
  });

  it("treats nonsense attempts and hints as the first attempt and no hint", () => {
    for (const attempt of [0, -3, Number.NaN, Infinity, 0.5]) expect(retryDelayMs(attempt), String(attempt)).toBeGreaterThanOrEqual(BASE_DELAY_MS);
    expect(retryDelayMs(0)).toBe(BASE_DELAY_MS);
    expect(retryDelayMs(1, Number.NaN)).toBe(BASE_DELAY_MS);
    expect(retryDelayMs(1, -5)).toBe(BASE_DELAY_MS);
  });
});

describe("isDead: a delivery is given up after 24 hours", () => {
  it("is alive up to the last millisecond and dead from exactly 24 hours", () => {
    const created = 1_000_000;
    expect(isDead(created, created + DEAD_AFTER_MS - 1)).toBe(false);
    expect(isDead(created, created + DEAD_AFTER_MS)).toBe(true);
    expect(isDead(created, created + 2 * DEAD_AFTER_MS)).toBe(true);
    expect(isDead(created, created)).toBe(false);
  });
});
