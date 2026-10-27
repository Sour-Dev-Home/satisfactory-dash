import type * as Leaflet from "leaflet";
import { mapBounds, project, type BaseMapConfig } from "./projection";

/**
 * The neutral grid base map (ADR-0023 decision 4): lines every gridStepM, plus the world border.
 * Quiet on purpose (ADR-0041): the lines in the map-grid colour (a step above the terrain's highest band), the border in the line
 * colour, so the machines stand out. The grid is a backdrop, not information: the scale is also
 * stated in text under the map ("500 m per square").
 */
export function drawGrid(
  L: typeof Leaflet,
  map: Leaflet.Map,
  renderer: Leaflet.Canvas,
  config: BaseMapConfig,
  color: (token: string) => string,
) {
  const { minX, maxX, minY, maxY } = config.worldBoundsM;
  const step = config.gridStepM;
  const style = { renderer, opacity: 1, weight: 1, interactive: false };
  const line = { ...style, color: color("--color-map-grid") };
  const at = (x: number, y: number) => project(config, x, y);
  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) L.polyline([at(x, minY), at(x, maxY)], line).addTo(map);
  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) L.polyline([at(minX, y), at(maxX, y)], line).addTo(map);
  L.rectangle(mapBounds(config), { ...style, color: color("--color-line"), fill: false }).addTo(map);
}
