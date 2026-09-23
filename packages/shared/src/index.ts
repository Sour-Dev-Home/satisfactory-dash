export * from "./ids";
export * from "./envelope";
export * from "./errors";
export * from "./health";
export * from "./servers";
export * from "./status";
export * from "./factory";
export * from "./power";
export * from "./auth";
export * from "./settings";
export * from "./endpoints";

// ---------------------------------------------------------------------------------
// Legacy interfaces: the shapes today's backend routes still return. They're removed
// in the same change that moves the backend onto the schemas above (server-scoped
// routes + snapshot envelope + renames, see docs-vault/wiki/decisions/README.md), in
// one step, since no deployed frontend consumes them yet (ADR-0007). Don't add
// fields here; add them to the schemas.
// ---------------------------------------------------------------------------------

export interface ServerStatusResponse {
  healthy: boolean;
  isGameRunning: boolean;
  isPaused: boolean;
  sessionName: string;
  connectedPlayers: number;
  playerLimit: number;
  tickRate: number;
  totalGameDurationSeconds: number;
}

export interface ProductionRateResponse {
  name: string;
  className: string;
  currentPerMinute: number;
  maxPerMinute: number;
  percent: number;
}

export interface FactoryBuildingResponse {
  id: string;
  name: string;
  className: string;
  recipe: string | null;
  isProducing: boolean;
  isPaused: boolean;
  /** Overflow signal. The intended rule (see FactoryBuildingSchema) is "an output slot
   *  is at capacity, the machine isn't paused, and a recipe is configured". Today's
   *  backend also requires isProducing, which never matches on a real save because a
   *  machine with a full output stops producing (bug B1, docs-vault/wiki/decisions). */
  isBackedUp: boolean;
  production: ProductionRateResponse[];
}

export interface FactoryOverviewResponse {
  buildings: FactoryBuildingResponse[];
  backedUpCount: number;
}

export type PowerCircuitStatus = "ok" | "at_risk" | "outage";

export interface PowerCircuitResponse {
  circuitGroupId: number;
  powerProduction: number;
  powerConsumed: number;
  powerCapacity: number;
  fuseTriggered: boolean;
  batteryPercent: number;
  batteryDifferential: number;
  status: PowerCircuitStatus;
}

export interface PowerOverviewResponse {
  circuits: PowerCircuitResponse[];
  hasOutage: boolean;
}
