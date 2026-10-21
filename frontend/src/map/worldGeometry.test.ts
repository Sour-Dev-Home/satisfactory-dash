import { describe, expect, it } from "vitest";
import {
  countByType,
  formatMetres,
  formatPoint,
  nodeInView,
  nodeKindLabel,
  nodeRadiusPx,
  polylineLengthM,
  purityLabel,
  railInView,
} from "./worldGeometry";

const VIEW = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
const node = (type: string, x = 0, y = 0) => ({ type, purity: "normal", nodeType: "node", x, y, exploited: false });

describe("polylineLengthM", () => {
  it("sums the straight steps in metres", () => {
    expect(polylineLengthM([[0, 0], [3, 4]])).toBe(5);
    expect(polylineLengthM([[0, 0], [3, 4], [3, 14]])).toBe(15);
  });
});

describe("view tests", () => {
  it("keeps a rail whose box touches the view, though no vertex is inside", () => {
    // A long straight rail crossing the view with both ends far outside it.
    expect(railInView(VIEW, { id: "a", points: [[-500, 50], [500, 50]] })).toBe(true);
    expect(railInView(VIEW, { id: "b", points: [[200, 200], [300, 300]] })).toBe(false);
  });

  it("shows everything when the view isn't known yet", () => {
    expect(railInView(null, { id: "a", points: [[9000, 9000], [9001, 9001]] })).toBe(true);
    expect(nodeInView(null, node("Iron Ore", 9000, 9000))).toBe(true);
  });

  it("includes a node exactly on the view's edge, not one outside", () => {
    expect(nodeInView(VIEW, node("Iron Ore", 100, 0))).toBe(true);
    expect(nodeInView(VIEW, node("Iron Ore", 101, 0))).toBe(false);
  });
});

describe("labels", () => {
  it("words known values and shows an unknown one as received (deploy skew)", () => {
    expect(purityLabel("pure")).toBe("Pure");
    expect(purityLabel("legendary")).toBe("legendary");
    expect(nodeKindLabel("frackingSatellite")).toBe("Fracking satellite");
    expect(nodeKindLabel("well")).toBe("well");
  });

  it("does not read inherited properties as labels", () => {
    expect(purityLabel("constructor")).toBe("constructor");
    expect(nodeKindLabel("__proto__")).toBe("__proto__");
    expect(nodeRadiusPx("toString")).toBe(nodeRadiusPx("normal"));
  });

  it("sizes nodes by purity: impure < normal < pure", () => {
    expect(nodeRadiusPx("impure")).toBeLessThan(nodeRadiusPx("normal"));
    expect(nodeRadiusPx("normal")).toBeLessThan(nodeRadiusPx("pure"));
  });

  it("formats whole metres with a separator", () => {
    expect(formatMetres(1234.4)).toBe("1,234 m");
    expect(formatPoint([-1119, 2061])).toBe("x -1,119, y 2,061");
  });
});

describe("countByType", () => {
  it("counts per resource, most common first, ties alphabetical", () => {
    expect(countByType([node("Coal"), node("Iron Ore"), node("Iron Ore"), node("Bauxite")])).toEqual([
      ["Iron Ore", 2],
      ["Bauxite", 1],
      ["Coal", 1],
    ]);
  });

  it("counts a type named like an Object prototype key", () => {
    expect(countByType([node("__proto__"), node("__proto__")])).toEqual([["__proto__", 2]]);
  });
});

describe("view edges (hunt)", () => {
  it("counts a node exactly on the view edge and a rail that only touches it", () => {
    expect(nodeInView(VIEW, node("a", 100, 100))).toBe(true);
    expect(nodeInView(VIEW, node("a", 101, 0))).toBe(false);
    expect(railInView(VIEW, { id: "r", points: [[100, 100], [200, 200]] })).toBe(true);
    expect(railInView(VIEW, { id: "r", points: [[-50, 50], [150, 50]] })).toBe(true);
    expect(railInView(VIEW, { id: "r", points: [[101, 0], [200, 0]] })).toBe(false);
  });
  it("a zero-length segment has zero length", () => {
    expect(polylineLengthM([[5, 5], [5, 5]])).toBe(0);
    expect(formatMetres(0)).toBe("0 m");
  });
});
