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

/** Set on adapter request errors so callers (routes/errorResponse.ts) can tell
 *  "the server couldn't be reached" apart from "it answered with something
 *  unusable" without importing adapter-specific error classes. Absent means the
 *  adapter didn't classify it (e.g. an HTTP status error, which carries `status`). */
export type RequestFailureKind = "unreachable" | "invalid_response";

/**
 * Base class for every error that means "the game server (or the path to it) failed":
 * transport failures, HTTP error statuses, vanilla-API error bodies, and responses that
 * fail raw-schema validation. routes/errorResponse.ts maps ONLY these to upstream_*
 * codes (502/503). Any other error, even one with a numeric `status`, is treated as our
 * own failure and fails closed (400 for a client's bad request, else 500), never a 502
 * by default (architect ruling, PR 3).
 */
export class UpstreamError extends Error {
  readonly failureKind?: RequestFailureKind;
  /** The game server's HTTP status, when it answered with one. */
  readonly status?: number;
  /** The vanilla API's own error code, from an Error Response body. */
  readonly errorCode?: string;

  constructor(
    message: string,
    options?: ErrorOptions & { failureKind?: RequestFailureKind; status?: number; errorCode?: string },
  ) {
    super(message, options);
    this.name = "UpstreamError";
    this.failureKind = options?.failureKind;
    this.status = options?.status;
    this.errorCode = options?.errorCode;
  }
}
