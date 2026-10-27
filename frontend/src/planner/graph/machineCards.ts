import type { FactoryBuilding, PlannerNode } from "@satisfactory-dash/shared";
import { machineState } from "../../factory/machineState";
import { outputLine } from "../plannerText";
import type { CardMachines } from "./canvasScene";
import { withName } from "./graphModel";
import { MACHINE_LINE_CHARS } from "./layoutSite";
import { clockText } from "./panelJoin";

/**
 * The words on an opened group's machine cards, from what the frontend already has: the Factory read's building for each
 * id (its name, state, clock and output, as the side panel lists them) and, for a machine that read does not hold (a
 * generator, a storage, a stale end), only what the graph's group says. Per-machine rates exist only in the Factory read;
 * the graph reads belts and rates per group, so a machine outside the read gets its group's item without a rate.
 */
export interface MachineCardText {
  /** Unique in the canvas: the group's key and the machine's id, or the group's key and "+" for the "+k more" card. */
  key: string;
  /** The machine's id; null on the "+k more" card. */
  id: string | null;
  /** The three drawn lines, each cut to `MACHINE_LINE_CHARS`. */
  lines: [string, string, string];
  /** Whether the second line is muted (no state known). */
  mutedState: boolean;
  /** Every word, for the machine's button and tooltip. */
  full: string;
}

const cut = (text: string): string => (text.length > MACHINE_LINE_CHARS ? `${text.slice(0, MACHINE_LINE_CHARS - 1)}…` : text);

export const machineCardKey = (groupKey: string, id: string | null): string => `${groupKey}\u0001${id ?? "+"}`;

/** What a machine outside the Factory read does, from its group: the fuel a generator burns, else its product or input. */
function groupLine(node: Pick<PlannerNode, "role" | "products" | "ingredients">): string {
  const input = node.ingredients[0]?.name;
  const product = node.products[0]?.name;
  if (node.role === "power" && input !== undefined) return `Fuel: ${input}`;
  if (product !== undefined) return `Makes ${product}`;
  if (input !== undefined) return `Takes ${input}`;
  return "No output data";
}

/**
 * One card per shown machine, in the group's order, then the "+k more" card. `buildings` is the Factory read (manufacturers
 * and extractors), undefined while it has not answered.
 */
export function machineCards(
  node: Pick<PlannerNode, "key" | "name" | "className" | "count" | "role" | "products" | "ingredients">,
  machines: Pick<CardMachines, "ids" | "more">,
  buildings: readonly FactoryBuilding[] | undefined,
): MachineCardText[] {
  const byId = new Map((buildings ?? []).map((b) => [b.id, b]));
  const group = withName(node).name;
  const cards = machines.ids.map((id, i): MachineCardText => {
    const ordinal = `machine ${i + 1} of ${node.count}`;
    const b = byId.get(id);
    if (b === undefined) {
      const state = buildings === undefined ? "Reading machines…" : "State not read";
      const line = groupLine(node);
      const why = buildings === undefined ? "" : ". Not in the factory read: its rate is read per group";
      return { key: machineCardKey(node.key, id), id, lines: [cut(group), state, cut(line)], mutedState: true, full: `${group}, ${ordinal}: ${state}. ${line}${why}` };
    }
    const label = machineState(b.state)?.label ?? null;
    const clock = clockText(b.clockSpeedPercent);
    const state = [label ?? "No state", ...(clock === null ? [] : [clock])].join(" · ");
    const outputs = b.production.map((r) => outputLine(r));
    const line = outputs[0] ?? "No output data";
    return {
      key: machineCardKey(node.key, id),
      id,
      lines: [cut(b.name), cut(state), cut(line)],
      mutedState: label === null,
      full: `${b.name}, ${ordinal}: ${state}. ${outputs.length === 0 ? line : outputs.join(", ")}`,
    };
  });
  if (machines.more > 0) {
    const more = `${machines.more} more ${machines.more === 1 ? "machine" : "machines"}`;
    cards.push({ key: machineCardKey(node.key, null), id: null, lines: [`+${more}`, "Open the group panel", ""], mutedState: true, full: `${more} in ${group}: open the group panel` });
  }
  return cards;
}
