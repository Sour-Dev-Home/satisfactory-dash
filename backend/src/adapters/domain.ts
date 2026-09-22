/**
 * Clean, source-agnostic types returned by SatisfactoryServerAdapter. `routes/` and
 * `services/` depend only on these — never on the raw vanilla-API or FRM response
 * shapes. See the "isolate the game-server adapter" rule in the root CLAUDE.md.
 */

export interface ServerHealth {
  healthy: boolean;
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
  /** Output inventory at (amount === maxAmount) while producing is the closest
   *  available overflow/backed-up-belt signal — see docs-vault/wiki/frm-api.md,
   *  no direct "belt full" field exists in either API. */
  outputInventory: InventorySlot[];
  circuitId: number;
  powerConsumed: number;
  maxPowerConsumed: number;
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
  circuitId: number;
  powerConsumed: number;
  maxPowerConsumed: number;
  fuseTriggered: boolean;
}

export interface Player {
  id: string;
  name: string;
  online: boolean;
  dead: boolean;
  hp: number;
  location: { x: number; y: number; z: number };
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
