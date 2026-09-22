import type { SatisfactoryServerConfig } from "./config.js";
import { VanillaApiClient } from "./vanillaApiClient.js";
import { FrmApiClient } from "./frmApiClient.js";
import type {
  RawHealthCheckResponse,
  RawQueryServerStateResponse,
  RawFrmFactoryBuilding,
  RawFrmProductionItem,
  RawFrmIngredientItem,
  RawFrmInventorySlot,
  RawFrmPowerCircuit,
  RawFrmPowerUsageBuilding,
  RawFrmPlayer,
  RawFrmSessionInfo,
} from "./rawTypes.js";
import type {
  ServerHealth,
  ServerStatus,
  ProductionRate,
  InventorySlot,
  FactoryBuilding,
  PowerCircuit,
  BuildingPowerUsage,
  Player,
  SessionInfo,
} from "./domain.js";

/** Narrow interfaces so the adapter can be tested against fakes without a real
 *  network transport. VanillaApiClient/FrmApiClient satisfy these directly. */
export interface VanillaApiClientLike {
  call<T>(functionName: string, data?: unknown): Promise<T>;
}
export interface FrmApiClientLike {
  get<T>(endpoint: string): Promise<T>;
}

function mapProduction(items: RawFrmProductionItem[] | undefined): ProductionRate[] {
  return (items ?? []).map((item) => ({
    name: item.Name,
    className: item.ClassName,
    currentPerMinute: item.CurrentProd,
    maxPerMinute: item.MaxProd,
    percent: item.ProdPercent,
  }));
}

function mapConsumption(items: RawFrmIngredientItem[] | undefined): ProductionRate[] {
  return (items ?? []).map((item) => ({
    name: item.Name,
    className: item.ClassName,
    currentPerMinute: item.CurrentConsumed,
    maxPerMinute: item.MaxConsumed,
    percent: item.ConsPercent,
  }));
}

function mapInventory(items: RawFrmInventorySlot[] | undefined): InventorySlot[] {
  return (items ?? []).map((item) => ({
    name: item.Name,
    className: item.ClassName,
    amount: item.Amount,
    maxAmount: item.MaxAmount,
  }));
}

/**
 * The single point of contact with a Satisfactory dedicated server — vanilla HTTPS
 * API for server/session status, FicsitRemoteMonitoring for factory/power/player
 * data. See docs-vault/wiki/data-gap-analysis.md for what each source covers.
 *
 * `services/` and `routes/` should depend on this class (or its `SatisfactoryServerAdapterLike`
 * shape) and the types in domain.ts, never on rawTypes.ts or the two low-level clients
 * directly — that's what keeps "one server now, many via AWS later" a config change.
 */
export class SatisfactoryServerAdapter {
  constructor(
    private readonly vanillaApi: VanillaApiClientLike,
    private readonly frmApi: FrmApiClientLike,
  ) {}

  static fromConfig(config: SatisfactoryServerConfig): SatisfactoryServerAdapter {
    const vanillaApi = new VanillaApiClient({
      host: config.host,
      port: config.apiPort,
      authToken: config.apiToken,
      allowSelfSignedCert: config.apiAllowSelfSignedCert,
      timeoutMs: config.requestTimeoutMs,
    });
    const frmApi = new FrmApiClient({
      host: config.host,
      port: config.frmPort,
      authToken: config.frmToken,
      timeoutMs: config.requestTimeoutMs,
    });
    return new SatisfactoryServerAdapter(vanillaApi, frmApi);
  }

  async getServerHealth(): Promise<ServerHealth> {
    const raw = await this.vanillaApi.call<RawHealthCheckResponse>("HealthCheck", { ClientCustomData: "" });
    return { healthy: raw.health === "healthy" };
  }

  async getServerStatus(): Promise<ServerStatus> {
    const raw = await this.vanillaApi.call<RawQueryServerStateResponse>("QueryServerState");
    const state = raw.serverGameState;
    return {
      sessionName: state.activeSessionName,
      isGameRunning: state.isGameRunning,
      isPaused: state.isGamePaused,
      connectedPlayers: state.numConnectedPlayers,
      playerLimit: state.playerLimit,
      tickRate: state.averageTickRate,
      totalGameDurationSeconds: state.totalGameDuration,
    };
  }

  async getFactoryBuildings(): Promise<FactoryBuilding[]> {
    const raw = await this.frmApi.get<RawFrmFactoryBuilding[]>("getFactory");
    return raw.map((building) => ({
      id: building.ID,
      name: building.Name,
      className: building.ClassName,
      recipe: building.Recipe ?? null,
      isProducing: building.IsProducing,
      isPaused: building.IsPaused,
      production: mapProduction(building.production),
      consumption: mapConsumption(building.ingredients),
      outputInventory: mapInventory(building.OutputInventory),
      circuitId: building.PowerInfo?.CircuitID ?? -1,
      powerConsumed: building.PowerInfo?.PowerConsumed ?? 0,
      maxPowerConsumed: building.PowerInfo?.MaxPowerConsumed ?? 0,
    }));
  }

  async getPowerCircuits(): Promise<PowerCircuit[]> {
    const raw = await this.frmApi.get<RawFrmPowerCircuit[]>("getPower");
    return raw.map((circuit) => ({
      circuitGroupId: circuit.CircuitGroupID,
      powerProduction: circuit.PowerProduction,
      powerConsumed: circuit.PowerConsumed,
      powerCapacity: circuit.PowerCapacity,
      maxPowerConsumed: circuit.PowerMaxConsumed,
      fuseTriggered: circuit.FuseTriggered,
      batteryPercent: circuit.BatteryPercent,
      batteryDifferential: circuit.BatteryDifferential,
      batteryCapacity: circuit.BatteryCapacity,
    }));
  }

  async getPowerUsage(): Promise<BuildingPowerUsage[]> {
    const raw = await this.frmApi.get<RawFrmPowerUsageBuilding[]>("getPowerUsage");
    return raw.map((building) => ({
      id: building.ID,
      name: building.Name,
      className: building.ClassName,
      circuitId: building.PowerInfo.CircuitID,
      powerConsumed: building.PowerInfo.PowerConsumed,
      maxPowerConsumed: building.PowerInfo.MaxPowerConsumed,
      fuseTriggered: building.PowerInfo.FuseTriggered ?? false,
    }));
  }

  async getPlayers(): Promise<Player[]> {
    const raw = await this.frmApi.get<RawFrmPlayer[]>("getPlayer");
    return raw.map((player) => ({
      id: player.ID,
      name: player.Name,
      online: player.Online,
      dead: player.Dead,
      hp: player.PlayerHP,
      location: { x: player.location.x, y: player.location.y, z: player.location.z },
    }));
  }

  async getSessionInfo(): Promise<SessionInfo> {
    const raw = await this.frmApi.get<RawFrmSessionInfo>("getSessionInfo");
    return {
      sessionName: raw.SessionName,
      isPaused: raw.IsPaused,
      isDay: raw.IsDay,
      dayLength: raw.DayLength,
      nightLength: raw.NightLength,
      passedDays: raw.PassedDays,
      totalPlayDurationSeconds: raw.TotalPlayDuration,
    };
  }
}
