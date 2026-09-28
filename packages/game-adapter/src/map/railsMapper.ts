import type { z } from "zod";
import type { RailSegment } from "@satisfactory-dash/shared";
import type { RawFrmTrainRailSchema } from "../rawSchemas.js";
import { toWholeMetres, inWholeMetreBounds } from "./coordinates.js";

// rawTypes.ts is private to satisfactoryServerAdapter.ts, so the raw type is derived locally from
// the schema rather than imported from there.
type RawTrainRail = z.infer<typeof RawFrmTrainRailSchema>;

export interface MappedRailSegments {
  data: RailSegment[];
  /** Segments skipped: every spline point was bad (finite/±1,000,000 m, coordinates.ts), or fewer
   *  than 2 points survived rounding and consecutive-duplicate removal (a line needs two ends) —
   *  the agent's own conform-don't-reject rule (docs-vault/wiki/runbooks/agent-app.md: a bad entry
   *  is dropped, never sent, rather than failing the whole layer). M3/M4 log this at warn. */
  dropped: number;
}

/**
 * ADR-0038 M2 (architect follow-up on #367): projects one getTrainRails segment into the M1
 * contract's RailSegment (packages/shared/src/map.ts), or `undefined` if too few valid points
 * survive. `z`, rotation, `Connected0`/`Connected1` and `Length` are dropped: the map only draws a
 * line, per M1's `{id, points}` shape.
 *
 * A bad point (non-finite or out of bounds after rounding) is skipped, not the whole segment —
 * then consecutive duplicate points are collapsed (the game's spline is far finer than a whole
 * metre, so many adjacent points round to the same value) — then the segment itself is dropped if
 * fewer than 2 points remain.
 */
export function mapRailSegment(raw: RawTrainRail): RailSegment | undefined {
  const points: [number, number][] = [];
  for (const point of raw.SplineData) {
    const x = toWholeMetres(point.x);
    const y = toWholeMetres(point.y);
    if (!inWholeMetreBounds(x) || !inWholeMetreBounds(y)) continue;
    const last = points[points.length - 1];
    if (last === undefined || last[0] !== x || last[1] !== y) {
      points.push([x, y]);
    }
  }
  if (points.length < 2) return undefined;
  return { id: raw.ID, points };
}

export function mapRailSegments(raw: readonly RawTrainRail[]): MappedRailSegments {
  const data: RailSegment[] = [];
  let dropped = 0;
  for (const item of raw) {
    const mapped = mapRailSegment(item);
    if (mapped === undefined) {
      dropped++;
    } else {
      data.push(mapped);
    }
  }
  return { data, dropped };
}
