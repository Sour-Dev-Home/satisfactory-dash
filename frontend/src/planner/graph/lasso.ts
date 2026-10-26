import type { Point, View } from "./viewport";

/** A stage point (1 unit = 1 CSS px of the SVG) in the drawing's own units, under the view's pan and zoom. */
export const toLayout = (view: View, p: Point): Point => ({ x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k });

/** A lasso needs at least a triangle to enclose anything. */
export const MIN_LASSO_POINTS = 3;

/** Whether `p` is inside the closed polygon `poly` (even-odd rule; the last point joins the first). */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  if (poly.length < MIN_LASSO_POINTS) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

interface Box {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The keys of the cards whose centre the lasso encloses (ADR-0055 Decision 5), in the order given. */
export function cardsInLasso(cards: readonly Box[], poly: readonly Point[]): string[] {
  return cards.filter((c) => pointInPolygon({ x: c.x + c.width / 2, y: c.y + c.height / 2 }, poly)).map((c) => c.key);
}

/** The lasso's SVG path, closed. */
export const lassoPath = (poly: readonly Point[]): string => (poly.length === 0 ? "" : `${poly.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ")} Z`);
