import { ownValue, type RailSegment, type ResourceNode } from "@satisfactory-dash/shared";
import type { ViewM } from "./MapCanvas";

/**
 * Pure helpers for the world layers (ADR-0038 M5): lengths, view tests and labels. World coordinates
 * are whole metres, +x east and +y south (docs-vault/raw-sources/world-coordinates.md: the game unit is
 * the centimetre, divided by 100 by the mapper), the same space `project` takes.
 */

/** A line on the map in whole metres: a rail segment's polyline or a power line's two ends. */
type Line = { readonly points: readonly (readonly [number, number])[] };

/** Length of a polyline in metres: the sum of its straight steps. */
export function polylineLengthM(points: Line["points"]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return sum;
}

/** All the lines' lengths together, in metres (each item as received: a repeated FRM id still counts once per item). */
export function totalLengthM(lines: readonly Line[]): number {
  let sum = 0;
  for (const line of lines) sum += polylineLengthM(line.points);
  return sum;
}

/** Whether any part of a segment's bounding box lies in the view (a cheap test, not exact geometry). */
export function railInView(view: ViewM | null, segment: RailSegment): boolean {
  if (!view) return true;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of segment.points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return maxX >= view.minX && minX <= view.maxX && maxY >= view.minY && minY <= view.maxY;
}

/** Whether the straight step a-b touches the view (Liang-Barsky clipping; the edge counts). */
function stepInView(view: ViewM, a: readonly [number, number], b: readonly [number, number]): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edges: [number, number][] = [
    [-dx, a[0] - view.minX],
    [dx, view.maxX - a[0]],
    [-dy, a[1] - view.minY],
    [dy, view.maxY - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/**
 * Whether any part of a line is in the view, exact step by step: a long diagonal wire whose bounding box overlaps
 * the view but which passes beside it is out; one crossing the view with both ends outside is in.
 */
export function lineInView(view: ViewM | null, line: Line): boolean {
  if (!view) return true;
  const { points } = line;
  if (points.length === 1) return stepInView(view, points[0], points[0]);
  for (let i = 1; i < points.length; i++) if (stepInView(view, points[i - 1], points[i])) return true;
  return false;
}

export function nodeInView(view: ViewM | null, node: ResourceNode): boolean {
  return !view || (node.x >= view.minX && node.x <= view.maxX && node.y >= view.minY && node.y <= view.maxY);
}

/** Known values get words; an unknown one (a newer game or backend, deploy skew) is shown as received. */
const PURITY_LABEL = { impure: "Impure", normal: "Normal", pure: "Pure" } as const;
const KIND_LABEL = { node: "Node", frackingSatellite: "Fracking satellite", geyser: "Geyser" } as const;
export const purityLabel = (purity: string) => ownValue(PURITY_LABEL, purity) ?? purity;
export const nodeKindLabel = (nodeType: string) => ownValue(KIND_LABEL, nodeType) ?? nodeType;

/** Node radius in pixels by purity, so the size says what the colour doesn't. Unknown purity reads as normal. */
export const PURITY_RADIUS_PX = { impure: 3, normal: 6, pure: 9 } as const;
export const nodeRadiusPx = (purity: string) => ownValue(PURITY_RADIUS_PX, purity) ?? PURITY_RADIUS_PX.normal;

/** "1,234 m": whole metres with a thousands separator; the map's own unit, never converted. */
export const formatMetres = (m: number) => `${Math.round(m).toLocaleString("en-US")} m`;
// `+ 0` turns a -0 coordinate into 0, which would otherwise print as "-0".
export const formatPoint = ([x, y]: readonly [number, number]) => `x ${(x + 0).toLocaleString("en-US")}, y ${(y + 0).toLocaleString("en-US")}`;

/** Resource names with their counts, most common first (a Map: names come from the game). */
export function countByType(nodes: readonly ResourceNode[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** "1 rail segment", "2 rail segments": the count with the right form of the noun. */
export const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Whether a point (a train, a station) lies in the view; no view yet means everything is. */
export const pointInView = (view: ViewM | null, p: { x: number; y: number }) =>
  !view || (p.x >= view.minX && p.x <= view.maxX && p.y >= view.minY && p.y <= view.maxY);
