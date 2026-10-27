import type { ReactNode } from "react";
import type { ConveyorKind } from "@satisfactory-dash/shared";
import type { MapContext, MapLayer } from "./layers";
import { conveyorsSummary, type PlacedConveyor } from "./conveyors";

/**
 * The planner's colours (planner/graph/SiteGraph.tsx: a belt is `stroke-muted`, a pipe `stroke-info`), under map names
 * that point at them (index.css), so the map and the planner agree on what a belt and a pipe look like.
 */
export const BELT_TOKEN = "--color-map-belt";
export const PIPE_TOKEN = "--color-map-pipe";
/**
 * On-screen widths in pixels, the same at every zoom: a belt a step over the power lines' 1.5 px wire, a pipe a step
 * wider again, both under the rails' 4. A lift runs straight up or down, so it is a 6 px dot where it stands; a belt or
 * pipe whose far end the map can't place is a dot of its own width at its start (round caps on a zero-length segment).
 */
export const BELT_WEIGHT_PX = 2;
export const PIPE_WEIGHT_PX = 2.5;
export const LIFT_DOT_PX = 6;
/** The legend's not-placed dots' radius: half the lift's, so the pair never reads as a lift. */
const UNPLACED_SWATCH_R = 1.5;

/** Draw order, bottom first: pipes under belts (a belt often runs over a pipe), lifts on top as dots. */
const ORDER: readonly { kind: ConveyorKind; token: string; weight: number }[] = [
  { kind: "pipe", token: PIPE_TOKEN, weight: PIPE_WEIGHT_PX },
  { kind: "belt", token: BELT_TOKEN, weight: BELT_WEIGHT_PX },
  { kind: "lift", token: BELT_TOKEN, weight: LIFT_DOT_PX },
];

/**
 * ADR-0048 amendment's conveyors world layer on the map (#330): every belt, lift and pipe. A big save has thousands
 * (the contract allows 50,000), so each kind is ONE Leaflet path (a multi-polyline, a sub-path per conveyor) on the
 * shared canvas renderer, never a path per conveyor. Not interactive: it must not take the hover from the building
 * under the pointer, and the table says everything a tooltip would.
 */
export function drawConveyors({ L, map, project, renderer, color }: MapContext, list: readonly PlacedConveyor[]) {
  const drawn = ORDER.flatMap(({ kind, token, weight }) => {
    const parts = list
      .filter((c) => c.edge.kind === kind)
      .map((c) => [project(c.from[0], c.from[1]), c.to === null ? project(c.from[0], c.from[1]) : project(c.to[0], c.to[1])]);
    if (parts.length === 0) return [];
    return [L.polyline(parts, { renderer, color: color(token), weight, opacity: 1, lineCap: "round", interactive: false }).addTo(map)];
  });
  return () => {
    for (const path of drawn) path.remove();
  };
}

/** A legend row: the swatch drawn as on the map (viewBox units are pixels), then its words. */
const legendRow = (shape: ReactNode, text: string) => (
  <li className="flex items-center gap-1.5">
    <svg viewBox="0 0 24 8" aria-hidden="true" focusable="false" className="h-2 w-6 flex-none">
      {shape}
    </svg>
    {text}
  </li>
);

export const conveyorsLayer: MapLayer<PlacedConveyor[]> = {
  id: "conveyors",
  label: "Belts and pipes",
  // Off until asked for: thousands of edges on a big save, and a read of their own (ADR-0038 §2).
  defaultVisible: false,
  draw: drawConveyors,

  // The same strokes as drawn. The not-placed swatch is a belt dot and a pipe dot side by side, a little larger than on
  // the map, so it doesn't read as the single, bigger lift dot.
  legend: () => (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {legendRow(<line x1="3" y1="4" x2="21" y2="4" className="stroke-map-belt" strokeWidth={BELT_WEIGHT_PX} strokeLinecap="round" />, "Belt")}
      {legendRow(<line x1="3" y1="4" x2="21" y2="4" className="stroke-map-pipe" strokeWidth={PIPE_WEIGHT_PX} strokeLinecap="round" />, "Pipe")}
      {legendRow(<circle cx="12" cy="4" r={LIFT_DOT_PX / 2} className="fill-map-belt" />, "Lift (vertical)")}
      {legendRow(
        <>
          <circle cx="8" cy="4" r={UNPLACED_SWATCH_R} className="fill-map-belt" />
          <circle cx="16" cy="4" r={UNPLACED_SWATCH_R} className="fill-map-pipe" />
        </>,
        "Belt or pipe, far end not placed",
      )}
    </ul>
  ),

  describe: (list, options) => conveyorsSummary(list, options),
};
