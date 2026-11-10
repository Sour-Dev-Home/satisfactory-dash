/**
 * ADR-0066 Decision 5: telemetry's own domain types for one server's factory and power, which the agent path and the
 * telemetry services read. They used to come from the game-adapter package through gameserver's facade; they live here
 * so the agent path does not depend on the adapter, which build PR 7 removed.
 */

export interface ProductionRate {
  name: string;
  className: string;
  currentPerMinute: number;
  maxPerMinute: number;
  percent: number;
}

export interface InventorySlot {
  name: string;
  className: string;
  amount: number;
  maxAmount: number;
}

export interface FactoryBuilding {
  id: string;
  name: string;
  className: string;
  recipe: string | null;
  isProducing: boolean;
  isPaused: boolean;
  production: ProductionRate[];
  consumption: ProductionRate[];
  /** Non-empty output slots only: FRM omits empty ones, so [] means the output
   *  buffer is empty right now. A slot at maxAmount is the closest available
   *  overflow signal (see factoryStates.ts isBackedUp and
   *  docs-vault/wiki/frm-api.md); no direct "belt full" field exists in either API. */
  outputInventory: InventorySlot[];
  /** Non-empty input slots (FRM's InputInventory; empty slots are omitted). Absent when FRM sent none:
   *  unknown, so the machine is never judged input-full (issue 201). */
  inputInventory?: InventorySlot[];
  /** The circuit GROUP this building belongs to: the id getPower reports circuits by.
   *  Not FRM's per-building CircuitID, which differs whenever a power switch joins
   *  circuits into a group (B3, 2026-09-22 captures). -1 = not connected. */
  circuitGroupId: number;
  powerConsumed: number;
  maxPowerConsumed: number;
  /** Whether the fuse of the circuit this building is on has tripped (FRM's PowerInfo.FuseTriggered,
   *  which the 2026-09-22 CJ capture shows true for a building on the tripped grid). Absent when FRM
   *  sent none: unknown, never assumed false (ADR-0027). */
  fuseTriggered?: boolean;
  /** World position in metres, rotation in [0, 360) (ADR-0023). Absent when FRM sent none. */
  location?: { xM: number; yM: number; zM: number; rotationDeg: number };
  /** Configured clock speed in percent (FRM ManuSpeed; 100 = default, above 100 when overclocked). Absent
   *  when FRM sent none or a value that is not a finite number. */
  clockSpeedPercent?: number;
}

export interface PowerCircuit {
  circuitGroupId: number;
  /** Total produced, MW (the in-game graph's Produced); on the FRM path max(base production, consumption), #620. */
  powerProduction: number;
  powerConsumed: number;
  powerCapacity: number;
  maxPowerConsumed: number;
  fuseTriggered: boolean;
  batteryPercent: number;
  batteryDifferential: number;
  batteryCapacity: number;
}

export interface BuildingPowerUsage {
  id: string;
  name: string;
  className: string;
  /** The circuit GROUP this building belongs to: the id getPower reports circuits by.
   *  Not FRM's per-building CircuitID, which differs whenever a power switch joins
   *  circuits into a group (B3, 2026-09-22 captures). -1 = not connected. */
  circuitGroupId: number;
  powerConsumed: number;
  maxPowerConsumed: number;
  fuseTriggered: boolean;
}
