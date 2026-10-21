import type { RailSegment } from "@satisfactory-dash/shared";
import type { MapLayer } from "./layers";
import { countOf, formatMetres, polylineLengthM } from "./worldGeometry";

/** Rails get their own light token, clear of the grid lines and the node colour (index.css). */
export const RAIL_TOKEN = "--color-rail";
/**
 * On-screen stroke width in pixels, the same at every zoom (Leaflet's weight is in pixels): wide enough
 * that a 12 m segment is still a visible dash at the default zoom. Round caps give every segment a
 * minimum length of one stroke width, and an end-point cap marks where each one stops.
 */
export const RAIL_WEIGHT_PX = 4;
export const RAIL_CAP_RADIUS_PX = 3;

/** The tooltip as DOM text nodes: a rail's id comes from the game server, so it never goes through HTML. */
function tooltip(segment: RailSegment): HTMLElement {
  const box = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "Rail segment";
  const length = document.createElement("div");
  length.textContent = formatMetres(polylineLengthM(segment.points));
  box.append(title, length);
  return box;
}

/**
 * ADR-0038 M5, the base map's rails: each captured segment as one polyline (whole-metre points, from the
 * `rails` world layer). Drawn under the buildings (the panel orders layers), on the shared canvas.
 */
export const railsLayer: MapLayer<RailSegment[]> = {
  id: "rails",
  label: "Rails",
  defaultVisible: true,

  draw({ L, map, project, renderer, color }, segments) {
    const group = L.layerGroup();
    const stroke = color(RAIL_TOKEN);
    for (const segment of segments) {
      const points = segment.points.map(([x, y]) => project(x, y));
      L.polyline(points, { renderer, color: stroke, weight: RAIL_WEIGHT_PX, opacity: 1, lineCap: "round", lineJoin: "round" })
        .bindTooltip(() => tooltip(segment), { sticky: true })
        .addTo(group);
      // End caps: a segment's two ends, so a short one still reads as a rail piece and joins show.
      for (const end of [points[0], points[points.length - 1]]) {
        L.circleMarker(end, {
          renderer,
          radius: RAIL_CAP_RADIUS_PX,
          stroke: false,
          fillColor: stroke,
          fillOpacity: 1,
          interactive: false,
        }).addTo(group);
      }
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  },

  legend: () => (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <li className="flex items-center gap-1.5">
        {/* The same stroke as drawn: RAIL_WEIGHT_PX wide, round caps (viewBox units are pixels). */}
        <svg viewBox="0 0 24 8" aria-hidden="true" focusable="false" className="h-2 w-6 flex-none">
          <line x1="4" y1="4" x2="20" y2="4" className="stroke-rail" strokeWidth={RAIL_WEIGHT_PX} strokeLinecap="round" />
        </svg>
        Rail segment
      </li>
    </ul>
  ),

  describe(segments, options) {
    if (segments.length === 0) return "No rails built yet.";
    const total = segments.reduce((sum, s) => sum + polylineLengthM(s.points), 0);
    return `${countOf(segments.length, "rail segment", "rail segments")} on the map, ${formatMetres(total)} of track ${options?.truncated ? "shown" : "in all"}.`;
  },
};
