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
    expect(roundedOrthogonalPath([P(0, 0), P(100, 0), P(100, 16), P(200, 16)], 10)).toBe("M0 0 L92 0 A8 8 0 0 1 100 8 A8 8 0 0 0 108 16 L200 16");
  });

  it("draws a tiny jog square, not as two small arcs that read as an S", () => {
    expect(roundedOrthogonalPath([P(0, 0), P(100, 0), P(100, 6), P(200, 6)], 10)).toBe("M0 0 L100 0 L100 6 L200 6");
  });

  it("keeps a straight tail for the arrowhead on the last leg, squaring the corner when the leg is too short", () => {
    // A 30-unit last leg: the arc may take 20 of it, leaving the 10-unit tail; the usual 10 fits.
    expect(roundedOrthogonalPath([P(0, 0), P(0, 50), P(30, 50)], 10)).toBe("M0 0 L0 40 A10 10 0 0 0 10 50 L30 50");
    // A 14-unit last leg leaves room for an arc of 4, under half the radius: a square corner, the head on a straight line.
    expect(roundedOrthogonalPath([P(0, 0), P(0, 50), P(14, 50)], 10)).toBe("M0 0 L0 50 L14 50");
  });

  it("ends on the route's last point along its last leg, so the arrowhead meets the card", () => {
    expect(roundedOrthogonalPath([P(0, 0), P(50, 0), P(50, 40), P(120, 40)]).endsWith("L120 40")).toBe(true);
  });

  it("stops `trimEnd` short of the end along the last leg, every corner where it was", () => {
    const route = [P(0, 0), P(50, 0), P(50, 40), P(120, 40)];
    const full = roundedOrthogonalPath(route);
    const trimmed = roundedOrthogonalPath(route, undefined, 3.2);
    expect(trimmed).toBe(full.replace(/L120 40$/, "L116.8 40"));
    // Upward and leftward last legs trim towards their previous point too.
    expect(roundedOrthogonalPath([P(0, 100), P(0, 0)], 10, 8)).toBe("M0 100 L0 8");
    expect(roundedOrthogonalPath([P(100, 0), P(0, 0)], 10, 8)).toBe("M100 0 L8 0");
  });

  it("never trims into the arc before the last run, and a trim of 0 or less is the full path", () => {
    // The last run after the arc is 10 (ARROW_TAIL): a trim of 25 stops at the arc's end.
    expect(roundedOrthogonalPath([P(0, 0), P(0, 50), P(20, 50)], 10, 25)).toBe("M0 0 L0 40 A10 10 0 0 0 10 50");
    expect(roundedOrthogonalPath([P(0, 0), P(100, 0)], 10, 0)).toBe("M0 0 L100 0");
    expect(roundedOrthogonalPath([P(0, 0), P(100, 0)], 10, -4)).toBe("M0 0 L100 0");
    expect(roundedOrthogonalPath([P(5, 5)], 10, 4)).toBe("M5 5");
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
