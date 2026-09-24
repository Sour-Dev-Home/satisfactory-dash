import type { Factory, FactoryBuilding } from "@satisfactory-dash/shared";
import { formatPercent } from "../format";
import {
  BACKED_UP_TOKEN,
  STATE_LABEL,
  STATE_TOKEN,
  buildingState,
  outputPercent,
  type BuildingState,
} from "./buildingState";
import type { MapLayer } from "./layers";

const STATES: BuildingState[] = ["producing", "idle", "paused", "noRecipe"];
const SWATCH: Record<BuildingState, string> = {
  producing: "bg-ok",
  idle: "bg-muted",
  paused: "bg-info",
  noRecipe: "bg-idle-solid",
};

/** Buildings the backend placed; an older backend (ADR-0007 skew) sends none. */
export const placed = (buildings: readonly FactoryBuilding[]) =>
  buildings.filter((b): b is FactoryBuilding & { location: NonNullable<FactoryBuilding["location"]> } => !!b.location);

/**
 * The tooltip, built as DOM text nodes: names come from the game server, so they never go
 * through HTML (Leaflet sets a string tooltip with innerHTML).
 */
function tooltip(building: FactoryBuilding): HTMLElement {
  const box = document.createElement("div");
  const line = (text: string, strong = false) => {
    const el = document.createElement(strong ? "strong" : "div");
    el.textContent = text;
    box.append(el);
  };
  line(building.name, true);
  line(building.recipe ?? "No recipe");
  const percent = outputPercent(building);
  const state = STATE_LABEL[buildingState(building)];
  line(percent === null ? state : `${state} · ${formatPercent(percent)}`);
  if (building.isBackedUp) line("Backed up");
  return box;
}

/** Layer (a) of ADR-0023: every building at its position, coloured by state. */
export const buildingsLayer: MapLayer<Factory> = {
  id: "buildings",
  label: "Buildings",
  defaultVisible: true,

  draw({ L, map, project, renderer, color }, data) {
    const group = L.layerGroup();
    const ring = color(BACKED_UP_TOKEN);
    for (const building of placed(data.buildings)) {
      const fill = color(STATE_TOKEN[buildingState(building)]);
      L.circleMarker(project(building.location.xM, building.location.yM), {
        renderer,
        radius: 6,
        fillColor: fill,
        fillOpacity: 1,
        // Backed up is a ring, not a colour: the state still shows inside it.
        color: building.isBackedUp ? ring : fill,
        weight: building.isBackedUp ? 3 : 1,
      })
        .bindTooltip(() => tooltip(building), { direction: "top", offset: [0, -6] })
        .addTo(group);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  },

  legend: () => (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {STATES.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`size-3 rounded-full ${SWATCH[state]}`} />
          {STATE_LABEL[state]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-full border-2 border-warn" />
        Backed up (ring)
      </li>
    </ul>
  ),

  describe(data) {
    const shown = placed(data.buildings);
    const count = (state: BuildingState) => shown.filter((b) => buildingState(b) === state).length;
    const missing = data.buildings.length - shown.length;
    return (
      <>
        {shown.length} buildings on the map: {count("producing")} producing, {count("idle")} not producing,{" "}
        {count("paused")} paused, {count("noRecipe")} without a recipe; {shown.filter((b) => b.isBackedUp).length}{" "}
        backed up.
        {missing > 0 && ` ${missing} more have no position yet (the backend doesn't send one).`}
      </>
    );
  },
};
