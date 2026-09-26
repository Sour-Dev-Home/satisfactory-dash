import type { AgentPower } from "@satisfactory-dash/shared";
import type { PowerCircuit } from "../domain.js";

/** A circuit as an agent sends it: the contract's fields without the derived `status` (a RULE the backend applies, ADR-0031). */
export type MappedPowerCircuit = AgentPower["circuits"][number];

/**
 * Maps one adapter circuit to the contract's fields (packages/shared/src/power.ts): MW/MWh unit names, and the two
 * fields that tell the frontend more than the old shape did (maxConsumptionMW: "could overload" when above capacity;
 * batteryCapacityMWh: tells "0%" apart from "no batteries"). The adapter validates every circuit, so there are no
 * placeholder rows.
 *
 * Deliberately NOT here: `status` and `hasOutage`. Deciding "outage" or "at risk" is a tunable rule that stays in the
 * backend (ADR-0031), so a change to it never needs an agent update.
 */
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
