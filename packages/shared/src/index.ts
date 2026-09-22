export interface HealthResponse {
  status: "ok";
}

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
  /** Closest available overflow signal (no direct "belt full" field exists in
   *  either Satisfactory API) — true when producing but an output slot is full. */
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
