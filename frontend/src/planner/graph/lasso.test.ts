import { describe, expect, it } from "vitest";
import { cardsInLasso, lassoPath, pointInPolygon, toLayout } from "./lasso";

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe("pointInPolygon", () => {
  it("is true inside and false outside a square", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 50, y: -1 }, square)).toBe(false);
  });

  it("follows a concave shape: the notch of a U is outside", () => {
    const u = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 70 },
      { x: 70, y: 70 },
      { x: 70, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon({ x: 50, y: 30 }, u)).toBe(false);
    expect(pointInPolygon({ x: 15, y: 30 }, u)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 85 }, u)).toBe(true);
  });

  it("encloses nothing with fewer than three points", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointInPolygon({ x: 1, y: 1 }, square.slice(0, 2))).toBe(false);
  });
});

describe("cardsInLasso", () => {
  it("takes a card whose centre is inside, even when its corners are not", () => {
    const cards = [
      { key: "in", x: 80, y: 80, width: 30, height: 30 }, // centre 95,95
      { key: "edge", x: 90, y: 90, width: 40, height: 40 }, // centre 110,110
      { key: "far", x: 300, y: 0, width: 10, height: 10 },
    ];
    expect(cardsInLasso(cards, square)).toEqual(["in"]);
  });
});

describe("toLayout", () => {
  it("undoes the view's pan and zoom", () => {
    expect(toLayout({ x: 20, y: 10, k: 2 }, { x: 120, y: 50 })).toEqual({ x: 50, y: 20 });
  });
});

describe("lassoPath", () => {
  it("is a closed path, or empty without points", () => {
    expect(lassoPath(square.slice(0, 3))).toBe("M0 0 L100 0 L100 100 Z");
    expect(lassoPath([])).toBe("");
  });
});
