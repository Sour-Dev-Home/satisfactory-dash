import { describe, expect, it } from "vitest";
import { edgeCurvePath } from "./edgeCurve";

/** Every coordinate pair a path command names, in order. */
const coords = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe("edgeCurvePath", () => {
  it("draws two points as a straight line and nothing for none", () => {
    expect(edgeCurvePath([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe("M0 0 L10 5");
    expect(edgeCurvePath([])).toBe("");
  });

  it("starts and ends exactly on the route's ends, so the arrowhead still meets the card", () => {
    const d = edgeCurvePath([{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }]);
    const all = coords(d);
    expect(d.startsWith("M0 0 ")).toBe(true);
    expect(all.at(-1)).toEqual([100, 0]);
    expect(d).toContain("C");
  });

  it("rounds a V: the curve never reaches the waypoint it bends round", () => {
    // dagre's long-edge detour: down to a waypoint far below, then back up.
    const d = edgeCurvePath([{ x: 0, y: 0 }, { x: 100, y: 300 }, { x: 200, y: 0 }]);
    const deepest = Math.max(...coords(d).map(([, y]) => y));
    expect(deepest).toBeLessThan(300);
  });

  it("ends along the last leg, so the arrowhead points the way the route arrives", () => {
    const d = edgeCurvePath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 40 }, { x: 200, y: 40 }]);
    const all = coords(d);
    const [bx, by] = all.at(-2)!;
    const [ex, ey] = all.at(-1)!;
    expect(ey - by).toBeCloseTo(0);
    expect(ex).toBeGreaterThan(bx);
  });
});
