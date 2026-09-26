/**
 * Clean, source-agnostic types returned by SatisfactoryServerAdapter. `routes/` and
 * `services/` depend only on these — never on the raw vanilla-API or FRM response
 * shapes. See the "isolate the game-server adapter" rule in the root CLAUDE.md.
 */

export interface ServerHealth {
  /** Vanilla HealthCheck: "healthy" above 10 ticks/s, else "slow"
   *  (docs-vault/raw-sources/dedicated-server-api.md:310). */
  tickHealth: "healthy" | "slow";
}

export interface ServerStatus {
  sessionName: string;
  isGameRunning: boolean;
  isPaused: boolean;
  connectedPlayers: number;
  playerLimit: number;
  /** Ticks per second, averaged. Below ~10 is FRM/vanilla's own "slow" threshold
   *  (docs-vault/raw-sources/dedicated-server-api.md, HealthCheck). */
  tickRate: number;
  totalGameDurationSeconds: number;
}

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
   *  overflow signal (see services/productionService.ts isBackedUp and
   *  docs-vault/wiki/frm-api.md); no direct "belt full" field exists in either API. */
  outputInventory: InventorySlot[];
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

/** ADR-0029: a name and whether they are online, nothing else. FRM's ID, location, HP, speed,
 *  "dead" flag and inventory are dropped at the raw schema and never enter the domain. */
export interface Player {
  name: string;
  online: boolean;
}

export interface SessionInfo {
  sessionName: string;
  isPaused: boolean;
  isDay: boolean;
  dayLength: number;
  nightLength: number;
  passedDays: number;
  totalPlayDurationSeconds: number;
}

