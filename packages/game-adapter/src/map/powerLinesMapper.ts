import { createHash } from "node:crypto";
import { POWER_LINES_MAX_ITEMS } from "@satisfactory-dash/shared";
import type { PowerLine } from "@satisfactory-dash/shared";
import { RawFrmCableSchema } from "../rawSchemas.js";
import { inWholeMetreBounds, toWholeMetres } from "./coordinates.js";
import { MAX_STRING, byId, compareText } from "./itemClasses.js";

/** Prefix of an id the mapper derives when FRM's `ID` is missing, empty or over the contract's 200 characters. */
export const DERIVED_ID_PREFIX = "derived-";

export interface MappedPowerLines {
  /** Lines sorted by id, then by content: the same game state always serializes the same, so the hash dedup writes
   *  nothing between reads. */
  data: PowerLine[];
  /** Lines skipped: an end missing, not finite or out of bounds, or past the layer cap. An odd id is repaired, not
   *  counted. */
  dropped: number;
}

/** FRM's `ID` when the contract can hold it; otherwise an id derived from the line's two ends, so the same line gets the
 *  same id on every read (never random, which would change the layer's hash each time). */
function lineId(raw: string | undefined, points: PowerLine["points"]): string {
  if (raw !== undefined && raw.length > 0 && raw.length <= MAX_STRING) return raw;
  const digest = createHash("sha256").update(JSON.stringify(points)).digest("hex");
  return `${DERIVED_ID_PREFIX}${digest.slice(0, 32)}`;
}

/**
 * ADR-0038 §1 (#330): projects getCables into the `powerLines` layer (packages/shared/src/map.ts). Each line is its two
 * ends, `location0` and `location1`, cm to whole metres. Lenient throughout; a line without two usable ends is dropped
 * and counted. Two ends that round to the same metre are kept: the contract allows it, and the line is still real.
 */
export function mapPowerLines(raw: readonly unknown[]): MappedPowerLines {
  let dropped = 0;
  const lines: PowerLine[] = [];
  for (const item of raw) {
    const parsed = RawFrmCableSchema.safeParse(item);
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const cable = parsed.data;
    const coords = [cable.location0.x, cable.location0.y, cable.location1.x, cable.location1.y].map(toWholeMetres);
    if (!coords.every(inWholeMetreBounds)) {
      dropped++;
      continue;
    }
    const [x0, y0, x1, y1] = coords as [number, number, number, number];
    const points: PowerLine["points"] = [
      [x0, y0],
      [x1, y1],
    ];
    lines.push({ id: lineId(cable.ID, points), points });
  }
  // Ids should be unique; if two are not (or two derived ids collide), the ends break the tie, so FRM's order never
  // changes the hash.
  lines.sort((a, b) => byId(a, b) || compareText(JSON.stringify(a.points), JSON.stringify(b.points)));
  if (lines.length > POWER_LINES_MAX_ITEMS) {
    dropped += lines.length - POWER_LINES_MAX_ITEMS;
    lines.length = POWER_LINES_MAX_ITEMS;
  }
  return { data: lines, dropped };
}
