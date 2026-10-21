import type { RailSegment } from "@satisfactory-dash/shared";
import type { MapLayer } from "./layers";
import { countOf, formatMetres, polylineLengthM } from "./worldGeometry";

/** Rails are landmarks, not the subject (ADR-0041): the muted token, thin. */
export const RAIL_TOKEN = "--color-muted";
const RAIL_WEIGHT_PX = 2;

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
      L.polyline(
        segment.points.map(([x, y]) => project(x, y)),
        { renderer, color: stroke, weight: RAIL_WEIGHT_PX, opacity: 1, lineCap: "butt" },
      )
        .bindTooltip(() => tooltip(segment), { sticky: true })
        .addTo(group);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  },

  legend: () => (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 24 4" aria-hidden="true" focusable="false" className="h-1 w-6 flex-none">
          <line x1="0" y1="2" x2="24" y2="2" className="stroke-muted" strokeWidth="2" />
        </svg>
        Rail segment
      </li>
    </ul>
  ),

  describe(segments) {
    if (segments.length === 0) return "No rails built yet.";
    const total = segments.reduce((sum, s) => sum + polylineLengthM(s.points), 0);
    return `${countOf(segments.length, "rail segment", "rail segments")} on the map, ${formatMetres(total)} of track in all.`;
  },
};
