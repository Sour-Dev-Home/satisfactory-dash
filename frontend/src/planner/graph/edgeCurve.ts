/** A point of an edge's route, in layout units. */
export interface RoutePoint {
  x: number;
  y: number;
}

const r = (n: number) => Math.round(n * 100) / 100;

/**
 * An edge's SVG path through its layout route as a uniform B-spline (d3's `curveBasis`): it starts and ends exactly on the
 * route's ends, so the arrowhead still lands on the card and points along the last leg, but it rounds every bend instead
 * of drawing a corner. A route that skips columns (dagre's waypoints for a long edge) reads as one sweep, not a V.
 * Two points stay a straight line.
 */
export function edgeCurvePath(points: readonly RoutePoint[]): string {
  if (points.length === 0) return "";
  const [first] = points;
  if (points.length < 3) return points.map((p, i) => `${i === 0 ? "M" : "L"}${r(p.x)} ${r(p.y)}`).join(" ");
  const parts = [`M${r(first.x)} ${r(first.y)}`];
  const second = points[1];
  parts.push(`L${r((5 * first.x + second.x) / 6)} ${r((5 * first.y + second.y) / 6)}`);
  const bezier = (a: RoutePoint, b: RoutePoint, c: RoutePoint) =>
    parts.push(
      `C${r((2 * a.x + b.x) / 3)} ${r((2 * a.y + b.y) / 3)} ${r((a.x + 2 * b.x) / 3)} ${r((a.y + 2 * b.y) / 3)} ${r((a.x + 4 * b.x + c.x) / 6)} ${r((a.y + 4 * b.y + c.y) / 6)}`,
    );
  for (let i = 2; i < points.length; i++) bezier(points[i - 2], points[i - 1], points[i]);
  const last = points[points.length - 1];
  bezier(points[points.length - 2], last, last);
  parts.push(`L${r(last.x)} ${r(last.y)}`);
  return parts.join(" ");
}
