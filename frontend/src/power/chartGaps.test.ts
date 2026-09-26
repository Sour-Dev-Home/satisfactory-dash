import { describe, expect, it } from "vitest";
import { isolatedIndices } from "./chartGaps";

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
});
