import type { FactoryBuilding, PlannerNode } from "@satisfactory-dash/shared";
import { machineState } from "../../factory/machineState";
import { formatPercent, formatRate } from "../../format";

/** One machine of a group, as the side panel lists it. */
export interface PanelMachine {
  id: string;
  name: string;
  /** The state's label ("Producing"), or null when the backend sent none this build knows. */
  state: string | null;
  /** "Clock 160%", only when it is not the default 100%; same rule as the Factory page. */
  clock: string | null;
  /** One "Iron Plate: 36 / 60 items/min" per product. */
  outputs: string[];
}

export interface PanelJoin {
  machines: PanelMachine[];
  /** Machine ids the group lists that the factory read does not have (a machine removed since the graph was read). */
  missing: number;
}

/** The clock speed's words when it is a setting worth saying (not 100%, not zero), else null. */
export function clockText(percent: number | undefined): string | null {
  if (percent === undefined || !Number.isFinite(percent) || percent <= 0) return null;
  const text = formatPercent(percent);
  return text === formatPercent(100) || text === formatPercent(0) ? null : `Clock ${text}`;
}

/** Joins a group's `machineIds` onto the factory read's buildings, in the group's order. */
export function joinMachines(node: Pick<PlannerNode, "machineIds">, buildings: readonly FactoryBuilding[]): PanelJoin {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const machines: PanelMachine[] = [];
  let missing = 0;
  for (const id of node.machineIds) {
    const b = byId.get(id);
    if (!b) {
      missing += 1;
      continue;
    }
    machines.push({
      id,
      name: b.name,
      state: machineState(b.state)?.label ?? null,
      clock: clockText(b.clockSpeedPercent),
      outputs: b.production.map((r) => `${r.name}: ${formatRate(r.currentPerMinute, r.maxPerMinute, r.unit)}`),
    });
  }
  return { machines, missing };
}
