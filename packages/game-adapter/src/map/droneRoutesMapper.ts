import { DRONE_ROUTES_MAX_ITEMS } from "@satisfactory-dash/shared";
import type { DronePort } from "@satisfactory-dash/shared";
import { RawFrmDronePortSchema } from "../rawSchemas.js";
import { inWholeMetreBounds, toWholeMetres } from "./coordinates.js";
import { MAX_STRING, byId, compareText, itemClasses } from "./itemClasses.js";

/** FRM's `PairedStation` for a port with no pair (captured-responses/frm-getDroneStation-2026-10-25-unpaired-trimmed.json). */
const UNPAIRED = "None";

export interface MappedDroneRoutes {
  /** Ports sorted by id, item classes sorted: the same game state always serializes the same, so the hash dedup writes
   *  nothing between builds. */
  data: DronePort[];
  /** Ports skipped: not the lenient shape (no id, name or position), an id or name over the contract's length, a position
   *  out of bounds, or past the layer cap. A bad inventory entry inside a kept port is trimmed, not counted. */
  dropped: number;
}

/** FRM's exact sentinel is unpaired, so a port a player named "None" cannot be paired to by name; an empty or over-long
 *  name cannot match any kept port either. Otherwise the name is kept exactly, trailing spaces included. */
function pairedName(raw: string | undefined): string | null {
  if (raw === undefined || raw === UNPAIRED || raw.length === 0 || raw.length > MAX_STRING) return null;
  return raw;
}

/**
 * ADR-0055 PR 12a: projects getDroneStation into the `droneRoutes` layer (packages/shared/src/map.ts). Lenient
 * throughout; a port that is not even `{ID, Name, location}` is dropped and counted.
 */
export function mapDroneRoutes(raw: readonly unknown[]): MappedDroneRoutes {
  let dropped = 0;
  const ports: DronePort[] = [];
  for (const item of raw) {
    const parsed = RawFrmDronePortSchema.safeParse(item);
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const port = parsed.data;
    const x = toWholeMetres(port.location.x);
    const y = toWholeMetres(port.location.y);
    if (port.ID.length > MAX_STRING || port.Name.length > MAX_STRING || !inWholeMetreBounds(x) || !inWholeMetreBounds(y)) {
      dropped++;
      continue;
    }
    ports.push({
      id: port.ID,
      name: port.Name,
      paired: pairedName(port.PairedStation),
      input: itemClasses([port.InputInventory]),
      output: itemClasses([port.OutputInventory]),
      fuel: itemClasses([port.FuelInventory]),
      x,
      y,
    });
  }
  // Ids should be unique; if two are not, their whole content breaks the tie, so FRM's order never changes the hash.
  ports.sort((a, b) => byId(a, b) || compareText(JSON.stringify(a), JSON.stringify(b)));
  if (ports.length > DRONE_ROUTES_MAX_ITEMS) {
    dropped += ports.length - DRONE_ROUTES_MAX_ITEMS;
    ports.length = DRONE_ROUTES_MAX_ITEMS;
  }
  return { data: ports, dropped };
}
