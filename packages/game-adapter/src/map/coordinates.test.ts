import { describe, it, expect } from "vitest";
import { toWholeMetres, inWholeMetreBounds, MAX_WHOLE_METRES } from "./coordinates.js";

/**
 * test-hunter pass (fresh-eyes, ADR-0038 M2): toWholeMetres is a one-line Math.round wrapper, but
 * Math.round has documented, non-obvious behaviour at exact .5 boundaries that's worth pinning down
 * independently of the mapper tests (which only exercise real capture values, none of which land on
 * an exact .5 boundary).
 */
describe("toWholeMetres", () => {
  it("rounds a positive .5-boundary value up (away from zero)", () => {
    expect(toWholeMetres(50)).toBe(1); // 0.5 -> 1
    expect(toWholeMetres(150)).toBe(2); // 1.5 -> 2
  });

  it("rounds a negative .5-boundary value toward positive infinity, not away from zero", () => {
    // Math.round(-1.5) === -1, not -2: JS rounds half-way ties toward +Infinity for every sign.
    expect(toWholeMetres(-150)).toBe(-1);
    expect(toWholeMetres(-250)).toBe(-2); // -2.5 -> -2
  });

  it("produces negative zero for -50 (the -0.5 tie), not positive zero", () => {
    // Math.round(-0.5) is exactly -0 per spec. -0 === 0 and JSON.stringify(-0) === "0" (so it's
    // indistinguishable on the wire), but Vitest's own toBe/toEqual use Object.is, which DOES
    // distinguish it -- so a fixture asserting `toEqual(0)` here would itself fail. Documenting
    // the actual behaviour, not asserting it's "wrong".
    const result = toWholeMetres(-50);
    expect(result == 0).toBe(true); // eslint-disable-line eqeqeq -- deliberately loose: -0 and 0 are equal
    expect(Object.is(result, -0)).toBe(true);
    expect(Object.is(result, 0)).toBe(false);
  });

  it("does not produce negative zero for an exact multiple of 100", () => {
    expect(Object.is(toWholeMetres(-100), -0)).toBe(false);
    expect(toWholeMetres(-100)).toBe(-1);
  });

  it("rounds exact multiples of 100 with no drift", () => {
    expect(toWholeMetres(0)).toBe(0);
    expect(toWholeMetres(100)).toBe(1);
    expect(toWholeMetres(-100)).toBe(-1);
    expect(toWholeMetres(1_000_000)).toBe(10_000);
  });

  it("handles very large finite values without overflow (bounds-checking is the M1 contract's job, not this function's)", () => {
    expect(toWholeMetres(1e10)).toBe(1e8);
    expect(toWholeMetres(-1e10)).toBe(-1e8);
  });

  it("passes through non-finite input rather than throwing (NaN/Infinity are the raw schema's job to reject)", () => {
    expect(toWholeMetres(Infinity)).toBe(Infinity);
    expect(toWholeMetres(-Infinity)).toBe(-Infinity);
    expect(Number.isNaN(toWholeMetres(NaN))).toBe(true);
  });

  it("rounds a small fractional value below one metre toward the nearest metre, not toward zero", () => {
    expect(toWholeMetres(49)).toBe(0); // 0.49 -> 0
    expect(toWholeMetres(-49)).toBe(-0); // -0.49 -> -0 (still ties-to-+Infinity semantics off Math.round(-0.49))
    expect(toWholeMetres(51)).toBe(1); // 0.51 -> 1
    expect(toWholeMetres(-51)).toBe(-1); // -0.51 -> -1
  });
});

// Architect follow-up on #367: the M1 contract's WholeMetreSchema bound, used by the mappers to
// drop a bad item instead of rejecting a whole layer.
describe("inWholeMetreBounds", () => {
  it("is +-1,000,000 m", () => {
    expect(MAX_WHOLE_METRES).toBe(1_000_000);
  });

  it("rejects non-finite values", () => {
    expect(inWholeMetreBounds(Infinity)).toBe(false);
    expect(inWholeMetreBounds(-Infinity)).toBe(false);
    expect(inWholeMetreBounds(NaN)).toBe(false);
  });

  it("accepts the boundary itself (inclusive), rejects one past it", () => {
    expect(inWholeMetreBounds(1_000_000)).toBe(true);
    expect(inWholeMetreBounds(-1_000_000)).toBe(true);
    expect(inWholeMetreBounds(1_000_001)).toBe(false);
    expect(inWholeMetreBounds(-1_000_001)).toBe(false);
  });

  it("accepts 0, -0 and ordinary in-range values", () => {
    expect(inWholeMetreBounds(0)).toBe(true);
    expect(inWholeMetreBounds(-0)).toBe(true);
    expect(inWholeMetreBounds(1783)).toBe(true);
  });
});
