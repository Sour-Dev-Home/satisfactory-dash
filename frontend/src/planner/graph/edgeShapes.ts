/**
 * Drawing an orthogonal route (ADR-0059): rounded corners on the router's polylines. Pure functions over points in layout
 * units.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** The corner radius of every bend, in layout units (clamped per corner, see `roundedOrthogonalPath`). */
export const CORNER_RADIUS = 10;
/** The straight run the last leg keeps before the target, so the arrowhead (8 units, `SiteGraph`'s marker) sits on a
 *  straight line and points along it, not on the curve. */
export const ARROW_TAIL = 10;
/** An arc clamped below this is drawn as a square corner instead: two tiny arcs on a short jog read as an S. */
const MIN_ARC = CORNER_RADIUS / 2;

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
 * the shorter of its two segments so neighbouring arcs never overlap, and on the last corner to leave `ARROW_TAIL` of
 * straight line before the end. An arc clamped below half the radius is drawn square. Other corners stay sharp.
 * `trimEnd` stops the path that much short of its end along the last straight run (never into the arc before it), with
 * every corner where it was: a line drawn under an arrowhead, or a mixed belt's inner stroke, ends inside the marker.
 */
export function roundedOrthogonalPath(points: readonly Point[], radius = CORNER_RADIUS, trimEnd = 0): string {
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
    const last = i + 2 === p.length;
    const clamped = Math.min(radius, c.len1 / 2, last ? c.len2 - ARROW_TAIL : c.len2 / 2);
    const r = clamped < Math.min(radius, MIN_ARC) ? 0 : clamped;
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
  if (p.length > 1) {
    const end = p[p.length - 1];
    const run = Math.hypot(end.x - at.x, end.y - at.y);
    const cut = Math.min(Math.max(trimEnd, 0), run);
    lineTo(cut > 0 ? along(end, { x: (at.x - end.x) / run, y: (at.y - end.y) / run }, cut) : end);
  }
  return d;
}

/** Whether a segment enters a rectangle (Liang-Barsky, with a positive length inside). */
export function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const inside = clipSegment(a, b, r);
  return inside !== null && (inside[1] - inside[0]) * Math.hypot(b.x - a.x, b.y - a.y) > 0.5;
}

/** The part of a segment inside a rectangle, as fractions `[t0, t1]` of the way from `a` to `b` (Liang-Barsky), or null. */
function clipSegment(a: Point, b: Point, r: Rect): [number, number] | null {
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
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

const at = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const runLength = (piece: readonly Point[]): number => piece.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - piece[i - 1].x, p.y - piece[i - 1].y)), 0);

/**
 * A path cut where it runs through a rectangle: the pieces outside it, in order, each longer than half a unit. A path that
 * never enters the box is one piece; one wholly inside it is none.
 */
export function piecesOutside(points: readonly Point[], box: Rect): Point[][] {
  const p = simplify(points);
  const pieces: Point[][] = [];
  let current: Point[] = [];
  const close = () => {
    if (current.length > 1 && runLength(current) > 0.5) pieces.push(current);
    current = [];
  };
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    const inside = clipSegment(a, b, box);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (inside === null || (inside[1] - inside[0]) * len <= 1e-6) {
      if (current.length === 0) current.push({ ...a });
      current.push({ ...b });
      continue;
    }
    const [t0, t1] = inside;
    if (t0 > 0) {
      if (current.length === 0) current.push({ ...a });
      current.push(at(a, b, t0));
    }
    close();
    if (t1 < 1) current.push(at(a, b, t1), { ...b });
  }
  close();
  return pieces;
}

/**
 * The path a transport's moving glyph rides (`animateMotion`): the edge's route with the stretch through its own label box
 * (grown by `clearance`, the glyph's radius) left out, so the glyph never passes over the item bubbles. Each piece starts
 * with a moveto, and a moveto is a jump in a motion path, so the glyph leaps the gap. Null when nothing is left outside.
 */
export function motionPathAround(points: readonly Point[], box: Rect, clearance: number): string | null {
  const grown = { x: box.x - clearance, y: box.y - clearance, width: box.width + 2 * clearance, height: box.height + 2 * clearance };
  const pieces = piecesOutside(points, grown);
  return pieces.length === 0 ? null : pieces.map((piece) => roundedOrthogonalPath(piece)).join(" ");
}
