import type { ConveyorEdge, ConveyorKind, ConveyorNodeKind } from "@satisfactory-dash/shared";
import { ownValue } from "@satisfactory-dash/shared";
import type { ViewM } from "./MapCanvas";
import type { DescribeOptions } from "./layers";
import { countOf, formatMetres, lineInView, pointInView } from "./worldGeometry";

/**
 * The conveyors world layer (ADR-0048 amendment) placed on the map (#330). The layer is a connection graph, not
 * geometry: each belt, lift or pipe carries only its end 0's position (`at`) and the ids at its two ends. So the far end
 * is found, never guessed, in this order: the start of the conveyor joined to it (when that one's end 0 names this
 * one), the building the factory placed under that id, or the nearest conveyor leaving the same building (a splitter,
 * merger or junction, which the factory doesn't list). Anything else stays unplaced and is drawn as a dot. A lift runs
 * straight up or down, so it is a dot where it stands. Belts and pipes are drawn straight between their ends: the
 * layer has no spline, so the lengths are straight-line lengths.
 */

export type Point = readonly [number, number];

/** A building the factory snapshot placed, by its id (the same ids getFactory and the conveyor ends use). */
export interface BuildingPlace {
  x: number;
  y: number;
  name: string;
}

export interface PlacedConveyor {
  edge: ConveyorEdge;
  /** `${id}:${index}`: FRM ids can repeat, so never the id alone. */
  key: string;
  /** End 0, as the layer gives it. */
  from: Point;
  /** End 1 when the map can place it; null for an open end, an end nothing places, and every lift. */
  to: Point | null;
  /** The straight-line length in metres, or null when `to` is. */
  lengthM: number | null;
}

const pointOf = (at: ConveyorEdge["at"]): Point => [at.x, at.y];
const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Places every conveyor's far end (see the module comment). `buildings` is a Map: its keys are game ids. */
export function placeConveyors(edges: readonly ConveyorEdge[], buildings: ReadonlyMap<string, BuildingPlace>): PlacedConveyor[] {
  // Ids can repeat, so every conveyor under an id is kept and the one that names this end back is the join.
  const byId = new Map<string, ConveyorEdge[]>();
  const leaving = new Map<string, ConveyorEdge[]>();
  for (const e of edges) {
    const same = byId.get(e.id);
    if (same) same.push(e);
    else byId.set(e.id, [e]);
    if (e.from === null) continue;
    const list = leaving.get(e.from);
    if (list) list.push(e);
    else leaving.set(e.from, [e]);
  }

  const farEnd = (e: ConveyorEdge, from: Point): Point | null => {
    if (e.kind === "lift" || e.to === null) return null;
    const next = byId.get(e.to);
    if (next) {
      const joined = next.find((n) => n.from === e.id);
      return joined ? pointOf(joined.at) : null;
    }
    const building = buildings.get(e.to);
    if (building) return [building.x, building.y];
    let best: Point | null = null;
    for (const other of leaving.get(e.to) ?? []) {
      if (other === e) continue;
      const at = pointOf(other.at);
      if (best === null || distance(from, at) < distance(from, best)) best = at;
    }
    return best;
  };

  return edges.map((edge, index) => {
    const from = pointOf(edge.at);
    const to = farEnd(edge, from);
    return { edge, key: `${edge.id}:${index}`, from, to, lengthM: to === null ? null : distance(from, to) };
  });
}

/**
 * The layer as text: a count per kind, the belt and pipe the map could measure, plus how many are only a dot. Only the
 * placed ones have a length, so it says "measured" (never "in all"), and a kind with nothing placed says its length is
 * unknown rather than "0 m".
 */
export function conveyorsSummary(list: readonly PlacedConveyor[], options?: DescribeOptions): string {
  if (list.length === 0) return "No belts, lifts or pipes reported yet.";
  const count = { belt: 0, lift: 0, pipe: 0 };
  const metres = { belt: 0, lift: 0, pipe: 0 };
  const measured = { belt: 0, lift: 0, pipe: 0 };
  let unplaced = 0;
  for (const c of list) {
    count[c.edge.kind]++;
    if (c.lengthM !== null) {
      metres[c.edge.kind] += c.lengthM;
      measured[c.edge.kind]++;
    } else if (c.edge.kind !== "lift") unplaced++;
  }
  const kinds = `${countOf(count.belt, "belt", "belts")}, ${countOf(count.pipe, "pipe", "pipes")}, ${countOf(count.lift, "lift", "lifts")}`;
  const verb = options?.truncated ? "shown" : "measured";
  // Only the kinds on the map get a length clause: no "pipe length unknown" when there is no pipe.
  const present = (["belt", "pipe"] as const).filter((k) => count[k] > 0);
  const known = present.filter((k) => measured[k] > 0);
  const unknown = present.filter((k) => measured[k] === 0).map((k) => `${k} length unknown`);
  const lengths = [
    ...(known.length === 0 ? [] : [`${known.map((k) => `${formatMetres(metres[k])} of ${k}`).join(" and ")} ${verb}`]),
    ...unknown,
  ].join(", ");
  const drawn = lengths === "" ? "." : `, ${lengths}, drawn straight between their ends.`;
  const dots =
    unplaced === 0
      ? ""
      : ` ${countOf(unplaced, "belt or pipe", "belts and pipes")} with an end the map can't place ${unplaced === 1 ? "is" : "are"} drawn as a dot.`;
  return `${kinds} on the map${drawn}${dots}`;
}

const KIND_TEXT: Record<ConveyorKind, string> = { belt: "Belt", lift: "Lift", pipe: "Pipe" };
export const conveyorKindText = (kind: string) => ownValue(KIND_TEXT, kind) ?? kind;

const END_KIND_TEXT: Record<ConveyorNodeKind, string> = {
  machine: "Machine",
  splitter: "Splitter",
  merger: "Merger",
  storage: "Storage",
  station: "Station",
  extractor: "Extractor",
  consumer: "Generator or sink",
  junction: "Pipe junction or pump",
  conveyor: "Conveyor",
  other: "Other building",
};

/** What sits at one end, in words: the factory's name for a building it placed, else the end's kind. */
export function endText(
  id: string | null,
  kind: ConveyorNodeKind | null,
  buildings: ReadonlyMap<string, BuildingPlace>,
  conveyorKinds: ReadonlyMap<string, ConveyorKind>,
): string {
  if (id === null || kind === null) return "Open end";
  const building = buildings.get(id);
  if (building) return building.name;
  const conveyor = conveyorKinds.get(id);
  if (conveyor) return conveyorKindText(conveyor);
  return ownValue(END_KIND_TEXT, kind) ?? kind;
}

export function conveyorLengthText(c: PlacedConveyor): string {
  if (c.edge.kind === "lift") return "Vertical";
  return c.lengthM === null ? "Unknown" : formatMetres(c.lengthM);
}

/** Whether any part of a conveyor is in the view: its segment when placed, else its start. */
export function conveyorInView(view: ViewM | null, c: PlacedConveyor): boolean {
  if (c.to === null) return pointInView(view, { x: c.from[0], y: c.from[1] });
  return lineInView(view, { points: [c.from, c.to] });
}
