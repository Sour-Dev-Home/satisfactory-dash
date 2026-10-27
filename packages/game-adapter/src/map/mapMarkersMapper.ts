import { createHash } from "node:crypto";
import { MAP_MARKER_NAME_MAX_CHARS, MAP_MARKERS_MAX_ITEMS } from "@satisfactory-dash/shared";
import type { MapMarker, MapMarkerKind } from "@satisfactory-dash/shared";
import { RawFrmMapMarkerSchema } from "../rawSchemas.js";
import { inWholeMetreBounds, toWholeMetres } from "./coordinates.js";
import { MAX_STRING, byId, compareText } from "./itemClasses.js";

/** The contract's `icon` bound (packages/shared/src/map.ts MapMarkerSchema). */
const MAX_ICON = 1_000_000;

/** A marker whose `ColorSlot` is missing or not 8 hex digits gets white: the colour of every uncoloured stamp in the
 *  capture (`FFFFFFFF`), so it reads as "no colour picked" rather than inventing one. */
export const DEFAULT_MARKER_COLOR = "#ffffff";

/** Prefix of an id the mapper derives when FRM's `ID` is missing, empty or over the contract's 200 characters. */
export const DERIVED_ID_PREFIX = "derived-";

export interface MappedMapMarkers {
  /** Markers sorted by id, then by content: the same game state always serializes the same, so the hash dedup writes
   *  nothing between reads. */
  data: MapMarker[];
  /** Markers skipped: no finite position or one out of bounds, an icon that is not a whole number in the contract's
   *  range, or past the layer cap. An odd id, name or colour is repaired, not counted. */
  dropped: number;
}

/** Trim, then cut to the contract's 60 characters counted in UTF-16 code units, as zod's `.max` counts them; a cut that
 *  would end on the first half of a surrogate pair drops that half too, so the name never holds a lone surrogate. */
export function markerName(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length <= MAP_MARKER_NAME_MAX_CHARS) return trimmed;
  const cut = trimmed.slice(0, MAP_MARKER_NAME_MAX_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** "RT_Stamp" is a stamp, "RT_MapMarker" a marker (the two values the capture shows). Any other type is folded into
 *  "marker" [NEEDS VERIFICATION: no other value is captured or documented], as the contract asks. */
export function markerKind(raw: string | undefined): MapMarkerKind {
  return raw === "RT_Stamp" ? "stamp" : "marker";
}

/** `ColorSlot` read as RRGGBBAA, alpha dropped, lower-cased [NEEDS VERIFICATION: byte order; the capture shows
 *  `FFFFFFFF` and `6EA37BFF`, whose trailing FF fits an opaque alpha, but no doc states the order]. */
export function markerColor(raw: string | undefined): string {
  return raw !== undefined && /^[0-9a-fA-F]{8}$/.test(raw) ? `#${raw.slice(0, 6).toLowerCase()}` : DEFAULT_MARKER_COLOR;
}

/** FRM's `ID` when the contract can hold it; otherwise an id derived from the marker's mapped content, so the same marker
 *  gets the same id on every read (never random, which would change the layer's hash each time). */
function markerId(raw: string | undefined, content: Omit<MapMarker, "id">): string {
  if (raw !== undefined && raw.length > 0 && raw.length <= MAX_STRING) return raw;
  const digest = createHash("sha256")
    .update(JSON.stringify([content.x, content.y, content.kind, content.icon, content.color, content.name]))
    .digest("hex");
  return `${DERIVED_ID_PREFIX}${digest.slice(0, 32)}`;
}

/**
 * ADR-0038 §1 (#330): projects getMapMarkers into the `mapMarkers` layer (packages/shared/src/map.ts). Lenient
 * throughout; a marker without a usable position or icon is dropped and counted. Names are player text: this function
 * never logs, and its callers log only the `dropped` count.
 */
export function mapMapMarkers(raw: readonly unknown[]): MappedMapMarkers {
  let dropped = 0;
  const markers: MapMarker[] = [];
  for (const item of raw) {
    const parsed = RawFrmMapMarkerSchema.safeParse(item);
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const marker = parsed.data;
    const x = toWholeMetres(marker.location.x);
    const y = toWholeMetres(marker.location.y);
    const icon = marker.IconID;
    // An icon that is not a whole number in range drops the item rather than becoming 0: 0 would draw some real icon the
    // player never chose, and the icon is most of what a marker shows.
    if (!inWholeMetreBounds(x) || !inWholeMetreBounds(y) || icon === undefined || !Number.isInteger(icon) || icon < 0 || icon > MAX_ICON) {
      dropped++;
      continue;
    }
    const content = { name: markerName(marker.Name), kind: markerKind(marker.MapMarkerType), icon, color: markerColor(marker.ColorSlot), x, y };
    markers.push({ id: markerId(marker.ID, content), ...content });
  }
  // Ids should be unique; if two are not (or two derived ids collide), their whole content breaks the tie, so FRM's
  // order never changes the hash.
  markers.sort((a, b) => byId(a, b) || compareText(JSON.stringify(a), JSON.stringify(b)));
  if (markers.length > MAP_MARKERS_MAX_ITEMS) {
    dropped += markers.length - MAP_MARKERS_MAX_ITEMS;
    markers.length = MAP_MARKERS_MAX_ITEMS;
  }
  return { data: markers, dropped };
}
