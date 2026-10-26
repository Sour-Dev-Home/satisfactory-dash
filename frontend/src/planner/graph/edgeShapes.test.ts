import { describe, expect, it } from "vitest";
import { roundedOrthogonalPath, segmentHitsRect, simplify } from "./edgeShapes";

const P = (x: number, y: number) => ({ x, y });

describe("simplify", () => {
  it("drops repeated points and points in the middle of a straight run", () => {
    expect(simplify([P(0, 0), P(0, 0), P(50, 0), P(100, 0), P(100, 40)])).toEqual([P(0, 0), P(100, 0), P(100, 40)]);
  });
});

describe("roundedOrthogonalPath", () => {
  it("draws a straight route as one line, and nothing for none", () => {
    expect(roundedOrthogonalPath([P(0, 0), P(100, 0)])).toBe("M0 0 L100 0");
    expect(roundedOrthogonalPath([])).toBe("");
  });

  it("rounds a right turn with an arc of the radius, clockwise on screen", () => {
    expect(roundedOrthogonalPath([P(0, 0), P(100, 0), P(100, 100)], 10)).toBe("M0 0 L90 0 A10 10 0 0 1 100 10 L100 100");
  });

  it("sweeps the other way on a left turn", () => {
    expect(roundedOrthogonalPath([P(0, 100), P(100, 100), P(100, 0)], 10)).toBe("M0 100 L90 100 A10 10 0 0 0 100 90 L100 0");
  });

  it("clamps the radius to half the shorter neighbouring segment", () => {
    expect(roundedOrthogonalPath([P(0, 0), P(100, 0), P(100, 6), P(200, 6)], 10)).toBe("M0 0 L97 0 A3 3 0 0 1 100 3 A3 3 0 0 0 103 6 L200 6");
  });

  it("ends on the route's last point along its last leg, so the arrowhead meets the card", () => {
    expect(roundedOrthogonalPath([P(0, 0), P(50, 0), P(50, 40), P(120, 40)]).endsWith("L120 40")).toBe(true);
  });
});

describe("segmentHitsRect", () => {
  it("sees a segment through a box, and not one beside it or stopping short", () => {
    const box = { x: 10, y: 10, width: 20, height: 20 };
    expect(segmentHitsRect(P(0, 20), P(40, 20), box)).toBe(true);
    expect(segmentHitsRect(P(0, 5), P(40, 5), box)).toBe(false);
    expect(segmentHitsRect(P(0, 20), P(9, 20), box)).toBe(false);
  });
});
