import type { z } from "zod";
import type { RailSegment } from "@satisfactory-dash/shared";
import type { RawFrmTrainRailSchema } from "../rawSchemas.js";
import { toWholeMetres } from "./coordinates.js";

// rawTypes.ts is private to satisfactoryServerAdapter.ts, so the raw type is derived locally from
// the schema rather than imported from there.
type RawTrainRail = z.infer<typeof RawFrmTrainRailSchema>;

/**
 * ADR-0038 M2: projects one getTrainRails segment into the M1 contract's RailSegment
 * (packages/shared/src/map.ts) — the spline's x/y (game units) rounded to whole metres
 * (docs-vault/raw-sources/world-coordinates.md). `z`, `rotation`, `Connected0`/`Connected1` and
 * `Length` are dropped: the map only draws a line, per M1's `{id, points}` shape.
 */
export function mapRailSegment(raw: RawTrainRail): RailSegment {
  return {
    id: raw.ID,
    points: raw.SplineData.map((point): [number, number] => [toWholeMetres(point.x), toWholeMetres(point.y)]),
  };
}

export function mapRailSegments(raw: readonly RawTrainRail[]): RailSegment[] {
  return raw.map(mapRailSegment);
}
