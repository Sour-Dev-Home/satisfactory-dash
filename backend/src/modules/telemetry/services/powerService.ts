import type { Power } from "@satisfactory-dash/shared";
import type { PowerCircuit } from "../../gameserver/index.js";
import { mapPowerCircuit } from "../../gameserver/index.js";
import { classifyPowerCircuit } from "./classifyPower.js";
import { derivePower } from "./snapshotDerive.js";

export { classifyPowerCircuit };

export interface PowerAdapterLike {
  getPowerCircuits(): Promise<PowerCircuit[]>;
}

/**
 * Maps the adapter's circuits to the contract's Power (packages/shared/src/power.ts): the shared shape mapping
 * (MW/MWh unit names, `maxConsumptionMW`, `batteryCapacityMWh`; the game-adapter package's `mapPowerCircuit`), then the
 * backend's classification (`status`, `hasOutage`; snapshotDerive.ts), the same two steps an edge agent's readings go
 * through at ingest (ADR-0031). The adapter validates every circuit, so there are no placeholder rows: a malformed
 * getPower response is a 502 upstream_invalid_response instead (contract rule, PR 3).
 */
export class PowerService {
  constructor(private readonly adapter: PowerAdapterLike) {}

  async getPowerOverview(): Promise<Power> {
    const circuits = await this.adapter.getPowerCircuits();
    return derivePower({ circuits: circuits.map(mapPowerCircuit) });
  }
}
