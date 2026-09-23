/**
 * Raw response shapes as actually returned by each API, not as the docs describe
 * them. Private to this directory — only satisfactoryServerAdapter.ts should import
 * these; everything else uses domain.ts.
 *
 * Vanilla API fields are camelCase (confirmed live, differs from the docs' PascalCase
 * — see docs-vault/wiki/vanilla-dedicated-server-api.md). FRM fields are PascalCase
 * (matches the docs and was confirmed live for getSessionInfo — see
 * docs-vault/raw-sources/captured-responses/frm-getSessionInfo-sample.json).
 */

// --- Vanilla Dedicated Server HTTPS API ---

export interface RawHealthCheckResponse {
  health: string;
  serverCustomData: string;
}

export interface RawServerGameState {
  activeSessionName: string;
  numConnectedPlayers: number;
  playerLimit: number;
  techTier: number;
  activeSchematic: string;
  gamePhase: string;
  isGameRunning: boolean;
  totalGameDuration: number;
  isGamePaused: boolean;
  averageTickRate: number;
  autoLoadSessionName: string;
  agreeToCrashUploadRequested: boolean;
}

export interface RawQueryServerStateResponse {
  serverGameState: RawServerGameState;
}

// --- FicsitRemoteMonitoring Web Server ---

export interface RawFrmLocation {
  x: number;
  y: number;
  z: number;
  rotation?: number;
}

export interface RawFrmProductionItem {
  Name: string;
  ClassName: string;
  Amount: number;
  CurrentProd: number;
  MaxProd: number;
  ProdPercent: number;
}

export interface RawFrmIngredientItem {
  Name: string;
  ClassName: string;
  Amount: number;
  CurrentConsumed: number;
  MaxConsumed: number;
  ConsPercent: number;
}

export interface RawFrmInventorySlot {
  Name: string;
  ClassName: string;
  Amount: number;
  MaxAmount: number;
}

export interface RawFrmPowerInfo {
  CircuitGroupID: number;
  CircuitID: number;
  FuseTriggered?: boolean;
  PowerConsumed: number;
  MaxPowerConsumed: number;
}

export interface RawFrmFactoryBuilding {
  ID: string;
  Name: string;
  ClassName: string;
  /** "Unassigned" (not absent) when no recipe is set; see IsConfigured. */
  Recipe?: string;
  /** "Is a recipe configured?" (frm-getFactory.md:57). Present on every building in
   *  the 2026-09-22 live captures, and false exactly when Recipe is "Unassigned". */
  IsConfigured?: boolean;
  production?: RawFrmProductionItem[];
  ingredients?: RawFrmIngredientItem[];
  OutputInventory?: RawFrmInventorySlot[];
  IsProducing: boolean;
  IsPaused: boolean;
  PowerInfo?: RawFrmPowerInfo;
}

export interface RawFrmPowerCircuit {
  CircuitGroupID: number;
  PowerProduction: number;
  PowerConsumed: number;
  PowerCapacity: number;
  PowerMaxConsumed: number;
  BatteryDifferential: number;
  BatteryPercent: number;
  BatteryCapacity: number;
  FuseTriggered: boolean;
}

export interface RawFrmPowerUsageBuilding {
  ID: string;
  Name: string;
  ClassName: string;
  PowerInfo: RawFrmPowerInfo;
}

export interface RawFrmPlayer {
  ID: string;
  Name: string;
  location: RawFrmLocation;
  PlayerHP: number;
  Online: boolean;
  Dead: boolean;
}

export interface RawFrmSessionInfo {
  SessionName: string;
  IsPaused: boolean;
  DayLength: number;
  NightLength: number;
  PassedDays: number;
  IsDay: boolean;
  TotalPlayDuration: number;
}
