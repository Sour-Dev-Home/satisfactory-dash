import type { z } from "zod";
import type { MapTrain } from "@satisfactory-dash/shared";
import type { RawFrmTrainSchema } from "../rawSchemas.js";
import { toWholeMetres, inWholeMetreBounds } from "./coordinates.js";

// rawTypes.ts is private to satisfactoryServerAdapter.ts, so the raw type is derived locally from
// the schema rather than imported from there.
type RawTrain = z.infer<typeof RawFrmTrainSchema>;

export interface MappedTrains {
  data: MapTrain[];
  /** Trains skipped because a coordinate wasn't finite or fell outside the M1 contract's
   *  WholeMetreSchema bound (±1,000,000 m) — the agent's own conform-don't-reject rule
   *  (docs-vault/wiki/runbooks/agent-app.md): a bad item is dropped, never sent, rather than
   *  failing the whole layer. M3/M4 log this at warn. */
  dropped: number;
}

/**
 * ADR-0038 M3 (#353): projects one getTrains item into the M1 contract's MapTrain
 * (packages/shared/src/map.ts), or `undefined` if a coordinate is bad. `Status` is FRM's own
 * field, passed through as-is (docs-vault/raw-sources/captured-responses/
 * frm-getTrains-2026-09-27-full.json: e.g. "Self-Driving"); the timetable, cars and power are not
 * the map's concern.
 */
export function mapTrain(raw: RawTrain): MapTrain | undefined {
  const x = toWholeMetres(raw.location.x);
  const y = toWholeMetres(raw.location.y);
  if (!inWholeMetreBounds(x) || !inWholeMetreBounds(y)) return undefined;
  return { id: raw.ID, name: raw.Name, x, y, status: raw.Status };
}

export function mapTrains(raw: readonly RawTrain[]): MappedTrains {
  const data: MapTrain[] = [];
  let dropped = 0;
  for (const item of raw) {
    const mapped = mapTrain(item);
    if (mapped === undefined) {
      dropped++;
    } else {
      data.push(mapped);
    }
  }
  return { data, dropped };
}
