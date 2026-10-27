import type { PowerLine } from "@satisfactory-dash/shared";
import type { MapLayer } from "./layers";
import { countOf, formatMetres, totalLengthM } from "./worldGeometry";

/** Power lines get their own copper token, apart from the rails' steel and every other layer's hue (index.css). */
export const POWER_LINE_TOKEN = "--color-map-power-line";
/**
 * On-screen stroke width in pixels, the same at every zoom: a hairline next to the rails' 4, so hundreds of wires
 * over a factory read as wiring, not as track. Round caps keep a 2 m line (the capture's shortest) a visible dot.
 */
export const POWER_LINE_WEIGHT_PX = 1.5;

/**
 * ADR-0038 §1 (#330): every power line as a straight segment between its two ends. A mid-size save has about 800
 * and the contract allows 20,000, so the whole layer is ONE Leaflet path (a multi-polyline, one sub-path per line)
 * on the shared canvas renderer, never a path per line. It isn't interactive: a wire has nothing to say on hover
 * that the text doesn't, and it must not take the hover from the building or marker under the pointer.
 */
export const powerLinesLayer: MapLayer<PowerLine[]> = {
  id: "powerLines",
  label: "Power lines",
  // Off until asked for: a factory's wiring is dense where the buildings and markers already sit, and the layer
  // costs a read of its own (ADR-0038 §2: a world layer is fetched only while its toggle is on).
  defaultVisible: false,

  draw({ L, map, project, renderer, color }, lines) {
    if (lines.length === 0) return () => {};
    const parts = lines.map((line) => line.points.map(([x, y]) => project(x, y)));
    const path = L.polyline(parts, {
      renderer,
      color: color(POWER_LINE_TOKEN),
      weight: POWER_LINE_WEIGHT_PX,
      opacity: 1,
      lineCap: "round",
      interactive: false,
    }).addTo(map);
    return () => {
      path.remove();
    };
  },

  legend: () => (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <li className="flex items-center gap-1.5">
        {/* The same stroke as drawn: POWER_LINE_WEIGHT_PX wide, round caps (viewBox units are pixels). */}
        <svg viewBox="0 0 24 8" aria-hidden="true" focusable="false" className="h-2 w-6 flex-none">
          <line x1="3" y1="4" x2="21" y2="4" className="stroke-map-power-line" strokeWidth={POWER_LINE_WEIGHT_PX} strokeLinecap="round" />
        </svg>
        Power line
      </li>
    </ul>
  ),

  // A count and the wire in all, the way the rails are summed; the lines in view are listed in PowerLinesTable.
  describe(lines, options) {
    if (lines.length === 0) return "No power lines built yet.";
    return `${countOf(lines.length, "power line", "power lines")} on the map, ${formatMetres(totalLengthM(lines))} of wire ${options?.truncated ? "shown" : "in all"}.`;
  },
};
