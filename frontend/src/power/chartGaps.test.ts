import { describe, expect, it } from "vitest";
import { bandSpan, isolatedIndices } from "./chartGaps";

describe("bandSpan", () => {
  // A plot from x=10 to x=110, with a 6 px minimum.
  const span = (x0: number, x1: number) => bandSpan(x0, x1, 10, 110, 6);

  it("draws a wide stretch as is, clipped to the plot", () => {
    expect(span(20, 50)).toEqual({ left: 20, width: 30 });
    expect(span(0, 50)).toEqual({ left: 10, width: 40 });
    expect(span(90, 200)).toEqual({ left: 90, width: 20 });
  });

  it("still shows a stretch that starts at the plot's right edge (the newest bucket)", () => {
    expect(span(110, 140)).toEqual({ left: 104, width: 6 });
  });

  it("widens a sub-pixel stretch to the minimum, centred where it can be", () => {
    expect(span(50, 50.2)).toEqual({ left: 47.1, width: 6 });
    expect(span(10, 10.5)).toEqual({ left: 10, width: 6 });
  });

  it("skips a stretch wholly outside the plot", () => {
    expect(span(0, 9)).toBeNull();
    expect(span(111, 150)).toBeNull();
  });
});

describe("isolatedIndices", () => {
  it("picks values with a gap (or the edge) on both sides", () => {
    expect(isolatedIndices([5, null, 7, null, 1, 2])).toEqual([0, 2]);
    expect(isolatedIndices([null, 3])).toEqual([1]);
  });

  it("is null when every value has a neighbour, so uPlot draws no dots", () => {
    expect(isolatedIndices([1, 2, null, 3, 4])).toBeNull();
    expect(isolatedIndices([null, null])).toBeNull();
    expect(isolatedIndices([])).toBeNull();
  });

  it("counts a zero as a value, not a gap", () => {
    expect(isolatedIndices([null, 0, null])).toEqual([1]);
    expect(isolatedIndices([0, 0])).toBeNull();
  });

  it("treats a value at the very start or end of the array as isolated when its one neighbour is a gap", () => {
    // A reading right after the array starts, with nothing before it and a gap after: isolated.
    expect(isolatedIndices([5, null, 1, 2])).toEqual([0]);
    // A reading right before the array ends, with a gap before it and nothing after: isolated.
    expect(isolatedIndices([1, 2, null, 9])).toEqual([3]);
  });

  it("is null (not an empty array) when nothing qualifies, so uPlot's points.filter sees no override", () => {
    expect(isolatedIndices([1, 2, 3])).toBeNull();
  });
});
