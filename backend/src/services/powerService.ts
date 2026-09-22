import type { PowerCircuitResponse, PowerCircuitStatus, PowerOverviewResponse } from "@satisfactory-dash/shared";
import type { PowerCircuit } from "../adapters/domain.js";

export interface PowerAdapterLike {
  getPowerCircuits(): Promise<PowerCircuit[]>;
}

/** Battery percent below which a net-draining circuit counts as "at risk" rather
 *  than "ok". Not sourced from docs-vault — FRM's own DiscIT.Battery webhook config
 *  (docs-vault/raw-sources/frm-config.md) takes an arbitrary comma-separated list of
 *  thresholds rather than a single documented default, so this is our own choice,
 *  not a documented value. Adjust freely; it's not grounded in anything besides
 *  "seems reasonable." */
const AT_RISK_BATTERY_PERCENT = 20;

/**
 * Deterministic threshold check (ground rule 3, not an LLM call):
 * - "outage": the fuse has tripped, or consumption already exceeds capacity.
 * - "at_risk": batteries are net-draining (BatteryDifferential < 0, per
 *   docs-vault/raw-sources/frm-getPower.md: "Negative = Drains batteries") and
 *   below AT_RISK_BATTERY_PERCENT.
 * - "ok" otherwise.
 */
export function classifyPowerCircuit(circuit: PowerCircuit): PowerCircuitStatus {
  if (circuit.fuseTriggered || circuit.powerConsumed > circuit.powerCapacity) {
    return "outage";
  }
  if (circuit.batteryDifferential < 0 && circuit.batteryPercent < AT_RISK_BATTERY_PERCENT) {
    return "at_risk";
  }
  return "ok";
}

export class PowerService {
  constructor(private readonly adapter: PowerAdapterLike) {}

  async getPowerOverview(): Promise<PowerOverviewResponse> {
    const circuits = await this.adapter.getPowerCircuits();
    const mapped: PowerCircuitResponse[] = circuits.map((circuit) => ({
      circuitGroupId: circuit.circuitGroupId,
      powerProduction: circuit.powerProduction,
      powerConsumed: circuit.powerConsumed,
      powerCapacity: circuit.powerCapacity,
      fuseTriggered: circuit.fuseTriggered,
      batteryPercent: circuit.batteryPercent,
      batteryDifferential: circuit.batteryDifferential,
      status: classifyPowerCircuit(circuit),
    }));
    return {
      circuits: mapped,
      hasOutage: mapped.some((circuit) => circuit.status === "outage"),
    };
  }
}
