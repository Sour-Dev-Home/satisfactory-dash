/**
 * Drawing an orthogonal route (ADR-0059): rounded corners on the router's polylines. Pure functions over points in layout
 * units.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** The corner radius of every bend, in layout units (clamped per corner, see `roundedOrthogonalPath`). */
export const CORNER_RADIUS = 10;

const f1 = (n: number) => Math.round(n * 10) / 10;

/** The path without repeated points and without points in the middle of a straight run. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push({ ...p });
  }
  for (let i = 1; i + 1 < out.length; ) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-6) out.splice(i, 1);
    else i++;
  }
  return out;
}

interface Corner {
  v: Point;
  /** Unit directions into and out of the corner, and the lengths of the two segments. */
  u1: Point;
  u2: Point;
  len1: number;
  len2: number;
  right: boolean;
}

function cornerAt(points: readonly Point[], i: number): Corner {
  const a = points[i - 1];
  const v = points[i];
  const b = points[i + 1];
  const len1 = Math.hypot(v.x - a.x, v.y - a.y);
  const len2 = Math.hypot(b.x - v.x, b.y - v.y);
  const u1 = { x: (v.x - a.x) / len1, y: (v.y - a.y) / len1 };
  const u2 = { x: (b.x - v.x) / len2, y: (b.y - v.y) / len2 };
  return { v, u1, u2, len1, len2, right: Math.abs(u1.x * u2.x + u1.y * u2.y) < 1e-6 };
}

const along = (p: Point, u: Point, d: number): Point => ({ x: p.x + u.x * d, y: p.y + u.y * d });

/**
 * An SVG path for an orthogonal route with each right-angle corner drawn as a circular arc of `radius`, clamped to half
 * the shorter of its two segments so neighbouring arcs never overlap. Other corners stay sharp.
 */
export function roundedOrthogonalPath(points: readonly Point[], radius = CORNER_RADIUS): string {
  const p = simplify(points);
  if (p.length === 0) return "";
  let d = `M${f1(p[0].x)} ${f1(p[0].y)}`;
  let at = p[0];
  // A line to where the pen already is (two arcs meeting) is left out.
  const lineTo = (q: Point) => {
    if (Math.abs(q.x - at.x) > 1e-6 || Math.abs(q.y - at.y) > 1e-6) d += ` L${f1(q.x)} ${f1(q.y)}`;
    at = q;
  };
  for (let i = 1; i + 1 < p.length; i++) {
    const c = cornerAt(p, i);
    const r = Math.min(radius, c.len1 / 2, c.len2 / 2);
    if (!c.right || r <= 0) {
      lineTo(c.v);
      continue;
    }
    const e = along(c.v, c.u2, r);
    const sweep = c.u1.x * c.u2.y - c.u1.y * c.u2.x > 0 ? 1 : 0;
    lineTo(along(c.v, c.u1, -r));
    d += ` A${f1(r)} ${f1(r)} 0 0 ${sweep} ${f1(e.x)} ${f1(e.y)}`;
    at = e;
  }
  if (p.length > 1) lineTo(p[p.length - 1]);
  return d;
}

/** Whether a segment enters a rectangle (Liang-Barsky, with a positive length inside). */
export function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - r.x],
    [dx, r.x + r.width - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.height - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return (t1 - t0) * Math.hypot(dx, dy) > 0.5;
}
