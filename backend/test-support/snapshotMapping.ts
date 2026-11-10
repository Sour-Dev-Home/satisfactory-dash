import type { AgentFactory, AgentPower } from "@satisfactory-dash/shared";
import type { FactoryBuilding, PowerCircuit } from "../src/modules/telemetry/domain.js";
import { areInputsFull, isBackedUp } from "../src/modules/telemetry/factoryStates.js";

/**
 * ADR-0066 build PR 7: the domain-to-contract shape mapping the game adapter's `snapshot/` mappers did, moved here
 * unchanged when the package was removed. Only tests use it: it turns domain-shaped buildings and circuits into what a
 * sender puts in an `/agent/v1` snapshot, so the tests can run them through the same derivation a mod's snapshot does.
 */

/** A building as the contract has it, without the derived `state` and without `unit` on its rates. */
export type MappedFactoryBuilding = AgentFactory["buildings"][number];

/** A circuit as a sender sends it: the contract's fields without the derived `status`. */
export type MappedPowerCircuit = AgentPower["circuits"][number];

/** One building to the contract, including `isBackedUp`, without `state` and without `unit` on the rates. Explicit
 *  field mapping, so a future domain field can never leak in. */
export function mapFactoryBuilding(building: FactoryBuilding): MappedFactoryBuilding {
  return {
    id: building.id,
    name: building.name,
    className: building.className,
    recipe: building.recipe,
    isProducing: building.isProducing,
    isPaused: building.isPaused,
    isBackedUp: isBackedUp(building),
    ...(building.inputInventory !== undefined ? { inputsFull: areInputsFull(building) } : {}),
    circuitGroupId: building.circuitGroupId,
    ...(building.location ? { location: building.location } : {}),
    ...(building.clockSpeedPercent !== undefined ? { clockSpeedPercent: building.clockSpeedPercent } : {}),
    production: building.production.map((rate) => ({ ...rate })),
    // ADR-0027: what it consumes, in the same shape.
    ingredients: building.consumption.map((rate) => ({ ...rate })),
  };
}

/** One circuit to the contract's fields (MW/MWh unit names), without `status` and `hasOutage`. */
export function mapPowerCircuit(circuit: PowerCircuit): MappedPowerCircuit {
  return {
    circuitGroupId: circuit.circuitGroupId,
    productionMW: circuit.powerProduction,
    consumptionMW: circuit.powerConsumed,
    capacityMW: circuit.powerCapacity,
    maxConsumptionMW: circuit.maxPowerConsumed,
    fuseTriggered: circuit.fuseTriggered,
    batteryCapacityMWh: circuit.batteryCapacity,
    batteryPercent: circuit.batteryPercent,
    batteryDifferentialMW: circuit.batteryDifferential,
  };
}
