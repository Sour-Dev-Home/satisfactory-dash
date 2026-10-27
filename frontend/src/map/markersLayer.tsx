import type * as Leaflet from "leaflet";
import type { MapMarker } from "@satisfactory-dash/shared";
import type { MapLayer } from "./layers";
import type { MapPoint } from "./projection";
import { countOf, formatPoint } from "./worldGeometry";

/** The light rim round every marker and stamp (index.css): the fill is the player's colour, which may be dark. */
export const MARKER_EDGE_TOKEN = "--color-marker-edge";
export const MARKER_EDGE_PX = 1.5;
/**
 * On-screen sizes in pixels, the same at every zoom, scaled to the other glyphs: a stamp is a diamond a little
 * smaller than a station's (6), so the two don't read as one; a marker is a pin whose head matches the stamp and
 * whose tip sits on the marker's place, so it stands above the resource nodes and buildings it points at.
 */
export const STAMP_RADIUS_PX = 5;
export const PIN_HEAD_RADIUS_PX = 5;
/** From the pin's tip (the marker's place) to the centre of its head. */
export const PIN_HEAD_OFFSET_PX = 9;
const PIN_ARC_STEPS = 12;

/** "Marker" or "Stamp": the kind in words. */
export const markerKindLabel = (kind: MapMarker["kind"]) => (kind === "stamp" ? "Stamp" : "Marker");

/** A marker's name as shown: players may leave it empty, so an empty one is named by its kind. */
export const markerName = (m: MapMarker) => (m.name.trim() === "" ? `Unnamed ${m.kind === "stamp" ? "stamp" : "marker"}` : m.name);

/**
 * A stable key per marker. FRM ids can repeat (#722 review), so the place is part of it; `markerKeys` adds a
 * count only when even that repeats, so React never sees two rows with one key.
 */
export function markerKeys(markers: readonly MapMarker[]): string[] {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return markers.map((m) => {
    const base = `${m.id}:${m.x}:${m.y}`;
    let n = seen.get(base) ?? 0;
    let key = n === 0 ? base : `${base}:${n}`;
    // An id may hold colons, so a suffixed key can equal another marker's base: keep counting until it is free.
    while (used.has(key)) key = `${base}:${++n}`;
    seen.set(base, n + 1);
    used.add(key);
    return key;
  });
}

/** The shape's corners in screen pixels round its place (y down): a diamond, or a pin with its tip at (0, 0). */
export function glyphOffsets(kind: MapMarker["kind"]): [number, number][] {
  if (kind === "stamp") {
    const r = STAMP_RADIUS_PX;
    return [[0, -r], [r, 0], [0, r], [-r, 0]];
  }
  // A teardrop: the tip, then the head's arc between the two lines from the tip that touch it.
  const r = PIN_HEAD_RADIUS_PX;
  const h = PIN_HEAD_OFFSET_PX;
  const touch = Math.acos(r / h);
  const points: [number, number][] = [[0, 0]];
  for (let i = 0; i <= PIN_ARC_STEPS; i++) {
    const a = touch + ((2 * Math.PI - 2 * touch) * i) / PIN_ARC_STEPS;
    points.push([r * Math.sin(a), -h + r * Math.cos(a)]);
  }
  return points;
}

/** The shape's corners as map points, a fixed number of screen pixels round its place at the current zoom. */
function shapeAround(map: Leaflet.Map, at: MapPoint, offsets: readonly [number, number][]): Leaflet.LatLng[] {
  const centre = map.latLngToLayerPoint(at);
  return offsets.map(([dx, dy]) => map.layerPointToLatLng([centre.x + dx, centre.y + dy]));
}

/** The tooltip as DOM text nodes: a marker's name is player-written text, so it never goes through HTML. */
function tooltip(m: MapMarker): HTMLElement {
  const box = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = markerName(m);
  const kind = document.createElement("div");
  kind.textContent = markerKindLabel(m.kind);
  const place = document.createElement("div");
  place.textContent = formatPoint([m.x, m.y]);
  box.append(title, kind, place);
  return box;
}

/** A legend sample: the drawn shape at its drawn size (viewBox units are pixels), in a neutral fill. */
function Sample({ kind }: { kind: MapMarker["kind"] }) {
  const points = glyphOffsets(kind)
    .map(([x, y]) => `${(12 + x).toFixed(2)},${((kind === "stamp" ? 12 : 18) + y).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-6 flex-none">
      <polygon points={points} className="fill-muted stroke-marker-edge" strokeWidth={MARKER_EDGE_PX} strokeLinejoin="round" />
    </svg>
  );
}

/**
 * ADR-0038 §1 (#330), the players' map markers and stamps from the `mapMarkers` world layer: a marker as a pin, a
 * stamp as a diamond, each filled with the colour the player picked and rimmed in a light token. The shape tells the
 * kind (not the colour); the name is in the tooltip and the table. The game's icon (`icon`, FRM's IconID) isn't drawn:
 * its mapping to an image is undocumented (a follow-up).
 */
export const markersLayer: MapLayer<MapMarker[]> = {
  id: "mapMarkers",
  label: "Markers",
  defaultVisible: true,

  draw({ L, map, project, renderer, color }, markers) {
    const group = L.layerGroup();
    const edge = color(MARKER_EDGE_TOKEN);
    const shapes: { polygon: Leaflet.Polygon; at: MapPoint; offsets: [number, number][] }[] = [];
    for (const marker of markers) {
      const at = project(marker.x, marker.y);
      const offsets = glyphOffsets(marker.kind);
      const polygon = L.polygon(shapeAround(map, at, offsets), {
        renderer,
        color: edge,
        weight: MARKER_EDGE_PX,
        lineJoin: "round",
        // The player's own colour, a runtime value from the game (the contract's #rrggbb), so a path option and no
        // token. FRM's ColorSlot read as RRGGBBAA: verified by the owner in game on 2026-10-27 (6EA37BFF shows green).
        fillColor: marker.color,
        fillOpacity: 1,
      })
        .bindTooltip(() => tooltip(marker), { sticky: true })
        .addTo(group);
      shapes.push({ polygon, at, offsets });
    }
    // The shapes are a fixed size on screen, so they are rebuilt from their places when the zoom changes.
    const resize = () => {
      for (const { polygon, at, offsets } of shapes) polygon.setLatLngs(shapeAround(map, at, offsets));
    };
    if (shapes.length > 0) map.on("zoomend", resize);
    group.addTo(map);
    return () => {
      map.off("zoomend", resize);
      group.remove();
    };
  },

  legend: () => (
    <div className="grid gap-1 text-sm text-muted">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <li className="flex items-center gap-1">
          <Sample kind="marker" />
          Marker (pin)
        </li>
        <li className="flex items-center gap-1">
          <Sample kind="stamp" />
          Stamp (diamond)
        </li>
      </ul>
      <p>Each is filled with the colour its player picked; the name is in the tooltip and the table below.</p>
    </div>
  ),

  // A cut layer gets its own note under this line (MapPanel's WorldLayerText), so the count stays "on the map".
  describe(markers) {
    if (markers.length === 0) return "No map markers or stamps placed yet.";
    const stamps = markers.filter((m) => m.kind === "stamp").length;
    const pins = markers.length - stamps;
    return `${countOf(pins, "marker", "markers")} and ${countOf(stamps, "stamp", "stamps")} on the map.`;
  },
};
