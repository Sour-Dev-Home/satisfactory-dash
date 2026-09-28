import type { z } from "zod";
import type { MapTrainStation } from "@satisfactory-dash/shared";
import type { RawFrmTrainStationSchema } from "../rawSchemas.js";
import { toWholeMetres, inWholeMetreBounds } from "./coordinates.js";

// rawTypes.ts is private to satisfactoryServerAdapter.ts, so the raw type is derived locally from
// the schema rather than imported from there.
type RawTrainStation = z.infer<typeof RawFrmTrainStationSchema>;

export interface MappedTrainStations {
  data: MapTrainStation[];
  /** Stations skipped because a coordinate wasn't finite or fell outside the M1 contract's
   *  WholeMetreSchema bound (±1,000,000 m) — the agent's own conform-don't-reject rule
   *  (docs-vault/wiki/runbooks/agent-app.md): a bad item is dropped, never sent, rather than
   *  failing the whole layer. M3/M4 log this at warn. */
  dropped: number;
}

/**
 * ADR-0038 M3 (#353): projects one getTrainStation item into the M1 contract's MapTrainStation
 * (packages/shared/src/map.ts), or `undefined` if a coordinate is bad. Docking platform detail
 * (CargoInventory), bounding box and power are not the map's concern (docs-vault/raw-sources/
 * captured-responses/frm-getTrainStation-2026-09-27-full.json).
 */
export function mapTrainStation(raw: RawTrainStation): MapTrainStation | undefined {
  const x = toWholeMetres(raw.location.x);
  const y = toWholeMetres(raw.location.y);
  if (!inWholeMetreBounds(x) || !inWholeMetreBounds(y)) return undefined;
  return { id: raw.ID, name: raw.Name, x, y };
}

export function mapTrainStations(raw: readonly RawTrainStation[]): MappedTrainStations {
  const data: MapTrainStation[] = [];
  let dropped = 0;
  for (const item of raw) {
    const mapped = mapTrainStation(item);
    if (mapped === undefined) {
      dropped++;
    } else {
      data.push(mapped);
    }
  }
  return { data, dropped };
}
