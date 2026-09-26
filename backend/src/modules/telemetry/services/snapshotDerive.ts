import type { AgentFactory, AgentPower, Factory, FactoryBuilding, Power, PowerCircuit as PowerCircuitResponse } from "@satisfactory-dash/shared";
import type { PowerCircuit } from "../../gameserver/index.js";
import { classifyBuilding } from "./classifyBuilding.js";
import { classifyPowerCircuit } from "./classifyPower.js";
import type { UnitResolver } from "./productionService.js";

/**
 * ADR-0031: what an edge agent sends for power and factory carries no backend-derived field (see the contract's
 * `AgentPowerSchema` / `AgentFactorySchema`). These functions derive them with the SAME rules the local path uses
 * (`classifyPowerCircuit`, `classifyBuilding`, the unit catalog), so a rule change needs no agent update and an agent
 * cannot disagree with the rules of the deployed backend. Pure: no clock, no state.
 */

/** The adapter's circuit shape, rebuilt from the contract's fields, because the rule reads the adapter's names. */
function asAdapterCircuit(circuit: AgentPower["circuits"][number]): PowerCircuit {
  return {
    circuitGroupId: circuit.circuitGroupId,
    powerProduction: circuit.productionMW,
    powerConsumed: circuit.consumptionMW,
    powerCapacity: circuit.capacityMW,
    maxPowerConsumed: circuit.maxConsumptionMW,
    fuseTriggered: circuit.fuseTriggered,
    batteryPercent: circuit.batteryPercent,
    batteryDifferential: circuit.batteryDifferentialMW,
    batteryCapacity: circuit.batteryCapacityMWh,
  };
}

/** Circuit `status` and `hasOutage`, as the power service derives them for a polled server. */
export function derivePower(agent: AgentPower): Power {
  // Explicit fields, never `...circuit`: an agent's own `status` must not survive by any route.
  const circuits: PowerCircuitResponse[] = agent.circuits.map((circuit) => ({
    circuitGroupId: circuit.circuitGroupId,
    productionMW: circuit.productionMW,
    consumptionMW: circuit.consumptionMW,
    capacityMW: circuit.capacityMW,
    maxConsumptionMW: circuit.maxConsumptionMW,
    fuseTriggered: circuit.fuseTriggered,
    batteryCapacityMWh: circuit.batteryCapacityMWh,
    batteryPercent: circuit.batteryPercent,
    batteryDifferentialMW: circuit.batteryDifferentialMW,
    status: classifyPowerCircuit(asAdapterCircuit(circuit)),
  }));
  return { circuits, hasOutage: circuits.some((circuit) => circuit.status === "outage") };
}

/** circuitGroupId -> whether that circuit's fuse has tripped, from a derived power reading. */
export function fuseByCircuit(power: Power): ReadonlyMap<number, boolean> {
  return new Map(power.circuits.map((circuit) => [circuit.circuitGroupId, circuit.fuseTriggered]));
}

type AgentBuilding = AgentFactory["buildings"][number];

/** Whether a machine's fuse has tripped, or undefined when that is not known (never assumed false, ADR-0027). */
export type FuseLookup = (building: AgentBuilding) => boolean | undefined;

/** An agent's machines: the fuse comes from the power circuit each is wired to; without a (fresh) power reading it is unknown. */
export function fuseFromCircuits(fuses: ReadonlyMap<number, boolean> | undefined): FuseLookup {
  return (building) => (building.circuitGroupId === undefined ? undefined : fuses?.get(building.circuitGroupId));
}

/**
 * Each building's `state`, its rates' `unit`, `backedUpCount` and `stateCounts`: the backend's classification step, applied
 * to a polled server's mapped buildings and to an edge agent's alike (ADR-0031). `fuseOf` says whether a machine's fuse has
 * tripped: FRM sends it on the machine for a polled server, and for an agent it is joined from the power circuits. Unknown
 * means the classifier leaves `state` out rather than guess, exactly as when FRM sends none.
 */
export function deriveFactory(agent: AgentFactory, fuseOf: FuseLookup, resolveUnit: UnitResolver): Factory {
  const buildings: FactoryBuilding[] = agent.buildings.map((building) => {
    const withUnit = (rate: AgentFactory["buildings"][number]["production"][number]) => ({
      name: rate.name,
      className: rate.className,
      currentPerMinute: rate.currentPerMinute,
      maxPerMinute: rate.maxPerMinute,
      percent: rate.percent,
      unit: resolveUnit(rate.className),
    });
    const production = building.production.map(withUnit);
    const ingredients = building.ingredients?.map(withUnit);
    const circuit = building.circuitGroupId;
    const fuse = fuseOf(building);
    // A pause needs no circuit or fuse (the local rule checks it first), so it is decided even when the id is missing.
    const classified =
      circuit === undefined
        ? building.isPaused
          ? { state: "paused" as const }
          : undefined
        : classifyBuilding(
            { recipe: building.recipe, isPaused: building.isPaused, production, consumption: building.ingredients ?? [], circuitGroupId: circuit, ...(fuse !== undefined ? { fuseTriggered: fuse } : {}) },
            building.isBackedUp,
          );
    // Explicit field mapping, never `...building`: a derived field that reached here by any route (a caller that skipped the
    // schema's stripping, or a future field) must not slip into the result as the agent's word.
    return {
      id: building.id,
      name: building.name,
      className: building.className,
      recipe: building.recipe,
      isProducing: building.isProducing,
      isPaused: building.isPaused,
      isBackedUp: building.isBackedUp,
      ...(building.circuitGroupId !== undefined ? { circuitGroupId: building.circuitGroupId } : {}),
      ...(building.location !== undefined ? { location: building.location } : {}),
      ...(building.clockSpeedPercent !== undefined ? { clockSpeedPercent: building.clockSpeedPercent } : {}),
      production,
      ...(ingredients !== undefined ? { ingredients } : {}),
      ...(classified !== undefined ? { state: classified.state } : {}),
    };
  });
  const stateCounts: Record<string, number> = {};
  for (const building of buildings) {
    if (building.state !== undefined) stateCounts[building.state] = (stateCounts[building.state] ?? 0) + 1;
  }
  return { buildings, backedUpCount: buildings.filter((building) => building.isBackedUp).length, stateCounts };
}
