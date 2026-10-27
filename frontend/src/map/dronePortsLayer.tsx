import type * as Leaflet from "leaflet";
import type { DronePort } from "@satisfactory-dash/shared";
import { labelFor } from "../factory/itemLabels";
import type { MapContext, MapLayer } from "./layers";
import type { MapPoint } from "./projection";
import { cargoText, dronePortName, pairedWithText, resolvePairings } from "./dronePorts";
import { countOf } from "./worldGeometry";

/** Drone ports and their routes get their own blue token, apart from every other layer's hue (index.css). */
export const DRONE_TOKEN = "--color-map-drone";
/** The dark rim round a port's square, so it stands off the terrain and any route under it. */
export const DRONE_EDGE_TOKEN = "--color-canvas";
export const DRONE_EDGE_PX = 1.5;
/**
 * On-screen sizes in pixels, the same at every zoom: a port is a square (a landing pad), 10 px across, so it reads
 * apart from the round nodes and trains and the diamond stations and stamps. A route is a dashed hairline, a flight
 * path rather than track or wire.
 */
export const DRONE_PORT_HALF_PX = 5;
/** 2 px, not a 1.5 px hairline: a dashed 1.5 px line all but vanished over the terrain on a phone. */
export const DRONE_ROUTE_WEIGHT_PX = 2;
/** Dash and gap in pixels (Leaflet's dashArray is in screen pixels on the canvas renderer). */
export const DRONE_ROUTE_DASH = "6 4";

const SQUARE: readonly [number, number][] = [
  [-DRONE_PORT_HALF_PX, -DRONE_PORT_HALF_PX],
  [DRONE_PORT_HALF_PX, -DRONE_PORT_HALF_PX],
  [DRONE_PORT_HALF_PX, DRONE_PORT_HALF_PX],
  [-DRONE_PORT_HALF_PX, DRONE_PORT_HALF_PX],
];

function squareAround(map: Leaflet.Map, at: MapPoint): Leaflet.LatLng[] {
  const centre = map.latLngToLayerPoint(at);
  return SQUARE.map(([dx, dy]) => map.layerPointToLatLng([centre.x + dx, centre.y + dy]));
}

/** An item class made readable without the factory's names ("Desc_IronPlate_C" → "Iron Plate"). */
const readableItem = (className: string) => labelFor(new Map(), className).name;

/** The tooltip as DOM text nodes: port names are player-written text, so they never go through HTML. */
function tooltip(port: DronePort, partner: DronePort | null, itemName: (className: string) => string): HTMLElement {
  const box = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = dronePortName(port);
  const paired = document.createElement("div");
  const pairedText = pairedWithText(port, partner);
  paired.textContent = pairedText === "Not paired" ? pairedText : `Paired with ${pairedText}`;
  const cargo = document.createElement("div");
  cargo.textContent = `Carries: ${cargoText(port.input, itemName)}`;
  box.append(title, paired, cargo);
  return box;
}

/**
 * Draws the ports and their routes. `itemName` turns a cargo class into a name: MapPanel passes the live factory's
 * names (factory/itemLabels.ts); without them, the class name is made readable.
 */
export function drawDronePorts({ L, map, project, renderer, color }: MapContext, ports: readonly DronePort[], itemName: (className: string) => string) {
  if (ports.length === 0) return () => {};
  const fill = color(DRONE_TOKEN);
  const { partner, routes } = resolvePairings(ports);
  const group = L.layerGroup();
  const places = ports.map((p) => project(p.x, p.y));
  // The routes first, under the squares: one non-interactive path, a sub-path per route.
  if (routes.length > 0) {
    L.polyline(
      routes.map(([a, b]) => [places[a], places[b]]),
      { renderer, color: fill, weight: DRONE_ROUTE_WEIGHT_PX, opacity: 1, dashArray: DRONE_ROUTE_DASH, lineCap: "round", interactive: false },
    ).addTo(group);
  }
  const squares: { polygon: Leaflet.Polygon; at: MapPoint }[] = [];
  ports.forEach((port, i) => {
    const at = places[i];
    const other = partner[i];
    const polygon = L.polygon(squareAround(map, at), {
      renderer,
      color: color(DRONE_EDGE_TOKEN),
      weight: DRONE_EDGE_PX,
      fillColor: fill,
      fillOpacity: 1,
    })
      .bindTooltip(() => tooltip(port, other === null ? null : ports[other], itemName), { sticky: true })
      .addTo(group);
    squares.push({ polygon, at });
  });
  // The squares are a fixed size on screen, so they are rebuilt from their places when the zoom changes.
  const resize = () => {
    for (const { polygon, at } of squares) polygon.setLatLngs(squareAround(map, at));
  };
  map.on("zoomend", resize);
  group.addTo(map);
  return () => {
    map.off("zoomend", resize);
    group.remove();
  };
}

/**
 * ADR-0055 Decision 1, #330: the drone ports from the `droneRoutes` world layer, each a square at its place, and a dashed
 * line between each pair that resolves to exactly one port (dronePorts.ts). Names and cargo are in the tooltip and the
 * "Drone ports in view" table.
 */
export const dronePortsLayer: MapLayer<DronePort[]> = {
  id: "droneRoutes",
  label: "Drone ports",
  // On by default: a save has a handful of ports (the contract caps it at 2,000, against 20,000 power lines), so the
  // read is small and the squares sit apart from the factory's dense middle, where drones fly between outposts.
  defaultVisible: true,

  draw: (ctx, ports) => drawDronePorts(ctx, ports, readableItem),

  legend: () => (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <li className="flex items-center gap-1.5">
        {/* The drawn square at its drawn size (viewBox units are pixels). */}
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-6 flex-none">
          <rect
            x={12 - DRONE_PORT_HALF_PX}
            y={12 - DRONE_PORT_HALF_PX}
            width={DRONE_PORT_HALF_PX * 2}
            height={DRONE_PORT_HALF_PX * 2}
            className="fill-map-drone stroke-canvas"
            strokeWidth={DRONE_EDGE_PX}
          />
        </svg>
        Drone port
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 24 8" aria-hidden="true" focusable="false" className="h-2 w-6 flex-none">
          <line x1="1" y1="4" x2="23" y2="4" className="stroke-map-drone" strokeWidth={DRONE_ROUTE_WEIGHT_PX} strokeDasharray={DRONE_ROUTE_DASH} />
        </svg>
        Drone route
      </li>
    </ul>
  ),

  describe(ports) {
    if (ports.length === 0) return "No drone ports built yet.";
    const { routes, unmatched } = resolvePairings(ports);
    const text = `${countOf(ports.length, "drone port", "drone ports")}, ${countOf(routes.length, "route", "routes")} on the map.`;
    if (unmatched === 0) return text;
    return `${text} ${countOf(unmatched, "pairing", "pairings")} couldn't be matched to one port.`;
  },
};
