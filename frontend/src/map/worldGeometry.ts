import { ownValue, type RailSegment, type ResourceNode } from "@satisfactory-dash/shared";
import type { ViewM } from "./MapCanvas";

/**
 * Pure helpers for the world layers (ADR-0038 M5): lengths, view tests and labels. World coordinates
 * are whole metres, +x east and +y south (docs-vault/raw-sources/world-coordinates.md: the game unit is
 * the centimetre, divided by 100 by the mapper), the same space `project` takes.
 */

/** Length of a polyline in metres: the sum of its straight steps. */
export function polylineLengthM(points: RailSegment["points"]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
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
export const formatPoint = ([x, y]: readonly [number, number]) => `x ${x.toLocaleString("en-US")}, y ${y.toLocaleString("en-US")}`;

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
