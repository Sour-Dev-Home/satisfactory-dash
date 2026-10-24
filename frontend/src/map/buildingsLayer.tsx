import { isBackedUpState, ownValue, type Factory, type FactoryBuilding } from "@satisfactory-dash/shared";
import type * as Leaflet from "leaflet";
import { formatPercent } from "../format";
import {
  BACKED_UP_TOKEN,
  isHollow,
  MARK_TOKEN,
  stateLabel,
  stateToken,
  buildingState,
  outputPercent,
  type BuildingState,
} from "./buildingState";
import type { MapLayer } from "./layers";
import { drawMachine, drawRing, hitRadius, ICON_MIN_PX, iconPx, ringReach } from "./machineIcon";
import { MachineGlyph } from "./MachineGlyph";

const STATES: BuildingState[] = ["producing", "idle", "paused", "noRecipe"];
/** The legend's housing colour per state: the same tokens the canvas reads (buildingState.ts). */
const FILL: Record<BuildingState, string> = {
  producing: "fill-ok",
  idle: "fill-muted",
  paused: "fill-info",
  noRecipe: "fill-none",
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
  const state = stateLabel(buildingState(building));
  line(percent === null ? state : `${state} · ${formatPercent(percent)}`);
  if (isBackedUpState(building)) line("Backed up");
  return box;
}

/** Paints a marker at its point; `size` is the icon's size at the current zoom (iconPx). */
type Paint = (ctx: CanvasRenderingContext2D, at: { x: number; y: number }, size: number) => void;
type DrawnOptions = Leaflet.CircleMarkerOptions & {
  paint: Paint;
  /** The marker's radius (its hit circle and redraw area) for an icon size. */
  radiusAt: (size: number) => number;
};
/** The parts of Leaflet's canvas renderer a custom-drawn marker uses (Leaflet 1.9, pinned). */
interface CanvasInternals {
  _renderer: { _drawing: boolean; _ctx: CanvasRenderingContext2D };
  _map: Leaflet.Map;
  _point: { x: number; y: number };
  _radius: number;
  _size: number;
  _empty(): boolean;
  options: DrawnOptions;
}

/**
 * A circle marker that draws its own picture on the shared canvas renderer (ADR-0023/ADR-0038: no
 * DOM node per building). It stays a CircleMarker, so Leaflet's hit test (the circle), hover and
 * tooltips work as for any marker. Two hooks change: `_updatePath`, the renderer's per-layer draw
 * hook, and `_project`, which Leaflet already runs for every layer when the zoom changes: there the
 * marker takes the zoom's icon size and sets its radius to match, so the hit circle is always the
 * drawn size, at no cost beyond the reprojection Leaflet does anyway.
 */
function drawnMarker(L: typeof Leaflet) {
  const base = L.CircleMarker.prototype as unknown as { _project(this: unknown): void };
  return L.CircleMarker.extend({
    _project(this: CanvasInternals) {
      this._size = iconPx(this._map.getZoom());
      this._radius = this.options.radiusAt(this._size);
      base._project.call(this);
    },
    _updatePath(this: CanvasInternals) {
      const renderer = this._renderer;
      if (!renderer._drawing || this._empty()) return;
      this.options.paint(renderer._ctx, this._point, this._size);
    },
  }) as unknown as new (at: Leaflet.LatLngExpression, options: DrawnOptions) => Leaflet.CircleMarker;
}

/**
 * The rings' canvas renderer. Unlike the shared one it's removed with the layer (on every redraw),
 * and Leaflet can lose track of a queued repaint (a zoom repaints at once and forgets the queued
 * frame), which would then run on the removed canvas. Off the map, a repaint does nothing.
 */
function ringCanvas(L: typeof Leaflet) {
  const base = L.Canvas.prototype as unknown as { _redraw(this: unknown): void };
  return L.Canvas.extend({
    _redraw(this: { _map: unknown }) {
      if (this._map) base._redraw.call(this);
    },
  }) as unknown as new (options: Leaflet.RendererOptions) => Leaflet.Canvas;
}

/** Layer (a) of ADR-0023: every building at its position, a machine icon coloured by state. */
export const buildingsLayer: MapLayer<Factory> = {
  id: "buildings",
  label: "Buildings",
  defaultVisible: true,

  draw({ L, map, project, renderer, color }, data) {
    const Drawn = drawnMarker(L);
    const group = L.layerGroup();
    const warn = color(BACKED_UP_TOKEN);
    const mark = color(MARK_TOKEN);
    const buildings = placed(data.buildings);
    const backedUp = buildings.filter(isBackedUpState);

    // The backed-up ring: one still ring per backed-up machine, drawn only when Leaflet repaints
    // (zoom, pan, data change), never on a timer. It sits on a canvas of its own (the one overlay
    // #443 allows; still canvas, no DOM per building) in the tile pane (unused: the base map is
    // drawn lines, not tiles), under the shared canvas, so the rings show beneath the icons and
    // never take the pointer from them; they are not interactive, so the icons' hit circles stay
    // the icon's size. Each ring's radius and stroke are shares of the zoom's icon size, set in
    // the marker's projection step like the icon's, so they scale together. None of it exists
    // when nothing is backed up.
    const ringRenderer = backedUp.length > 0 ? new (ringCanvas(L))({ pane: "tilePane", padding: 0.5 }) : null;
    if (ringRenderer) {
      for (const b of backedUp) {
        new Drawn(project(b.location.xM, b.location.yM), {
          renderer: ringRenderer,
          radius: ringReach(iconPx(map.getZoom())),
          radiusAt: ringReach,
          stroke: false,
          interactive: false,
          paint: (ctx, at, size) => drawRing(ctx, at.x, at.y, size, warn),
        }).addTo(group);
      }
    }

    for (const building of buildings) {
      const state = buildingState(building);
      // Backed up wins (warn, filled, the triangle); no recipe is hollow (an outline, no fill).
      const backedUpNow = isBackedUpState(building);
      const hollow = !backedUpNow && isHollow(state);
      const stateColor = color(stateToken(state));
      const colors = backedUpNow
        ? { body: warn, mark }
        : hollow
          ? { mark, outline: stateColor }
          : { body: stateColor, mark };
      new Drawn(project(building.location.xM, building.location.yM), {
        renderer,
        radius: hitRadius(iconPx(map.getZoom())),
        radiusAt: hitRadius,
        stroke: false,
        paint: (ctx, at, size) => drawMachine(ctx, at.x, at.y, size, colors, isBackedUpState(building)),
      })
        // Leaflet opens a path's tooltip where the pointer is: lift it clear of the smallest icon.
        .bindTooltip(() => tooltip(building), { direction: "top", offset: [0, -hitRadius(ICON_MIN_PX)] })
        .addTo(group);
    }
    group.addTo(map);

    return () => {
      group.remove();
      ringRenderer?.remove();
    };
  },

  legend: () => (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {STATES.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <MachineGlyph fill={ownValue(FILL, state) ?? FILL.idle} outline={isHollow(state) ? "stroke-muted" : undefined} />
          {stateLabel(state)}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <MachineGlyph fill="fill-warn" backedUp />
        Backed up (a ring marks it)
      </li>
    </ul>
  ),

  describe(data, options) {
    const shown = placed(data.buildings);
    const count = (state: BuildingState) => shown.filter((b) => buildingState(b) === state).length;
    const missing = data.buildings.length - shown.length;
    const of = options?.filteredOf;
    return (
      <>
        {shown.length} {of ? `of ${of} buildings shown` : "buildings on the map"}: {count("producing")} producing,{" "}
        {count("idle")} not producing, {count("paused")} paused, {count("noRecipe")} without a recipe;{" "}
        {shown.filter(isBackedUpState).length} backed up{of ? "; the rest are hidden by the filters." : "."}
        {missing > 0 && ` ${missing} more have no position yet (the backend doesn't send one).`}
      </>
    );
  },
};
