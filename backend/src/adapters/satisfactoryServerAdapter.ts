import type { SatisfactoryServerConfig } from "./config.js";
import { VanillaApiClient } from "./vanillaApiClient.js";
import { FrmApiClient, FrmApiRequestError } from "./frmApiClient.js";
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

  /** For FRM endpoints documented to return a JSON array (docs-vault/raw-sources/
   *  frm-get*.md). Found by a review pass: every caller used to `.map` the body
   *  directly, so an object or `null` body threw a bare TypeError that the routes
   *  then reported as "Could not reach the Satisfactory dedicated server" -- wrong,
   *  since the server did answer. [NEEDS VERIFICATION] whether FRM ever returns a
   *  non-array here; this is the layer meant to defend against it regardless. */
  private async getFrmArray<T>(endpoint: string): Promise<T[]> {
    const raw = await this.frmApi.get<unknown>(endpoint);
    if (!Array.isArray(raw)) {
      throw new FrmApiRequestError(`FRM response from ${endpoint} was not an array`, undefined, {
        failureKind: "invalid_response",
      });
    }
    return raw as T[];
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
    const raw = await this.getFrmArray<RawFrmFactoryBuilding>("getFactory");
    return raw.map((building) => {
      // B2 (2026-09-22 captures): FRM reports an unconfigured machine as Recipe
      // "Unassigned" plus a placeholder "Unassigned" production/ingredient entry, not
      // as a missing recipe. IsConfigured (frm-getFactory.md:57) is the explicit
      // signal; "Unassigned" is checked too so the mapping still holds if a response
      // ever omits the flag (the PR's fresh-eyes review found that gap).
      const configured = building.IsConfigured !== false && building.Recipe !== "Unassigned";
      return {
        id: building.ID,
        name: building.Name,
        className: building.ClassName,
        recipe: configured ? (building.Recipe ?? null) : null,
        isProducing: building.IsProducing,
        isPaused: building.IsPaused,
        production: configured ? mapProduction(building.production) : [],
        consumption: configured ? mapConsumption(building.ingredients) : [],
        outputInventory: mapInventory(building.OutputInventory),
        // B3: the group id, which is what getPower is keyed by. See domain.ts.
        circuitGroupId: building.PowerInfo?.CircuitGroupID ?? -1,
        powerConsumed: building.PowerInfo?.PowerConsumed ?? 0,
        maxPowerConsumed: building.PowerInfo?.MaxPowerConsumed ?? 0,
      };
    });
  }

  async getPowerCircuits(): Promise<PowerCircuit[]> {
    const raw = await this.getFrmArray<RawFrmPowerCircuit>("getPower");
    return raw.map((circuit) => {
      // Found by a review pass: PowerService's own null/non-object placeholder
      // logic can only run if it's ever handed a raw circuit to inspect -- a
      // null/non-object entry here used to throw (e.g. `circuit.CircuitGroupID`
      // on `null`) before ever reaching that layer, crashing the whole
      // /api/power call with a misleading "Could not reach the Satisfactory
      // dedicated server" 503. Mapping it to NaN/false sentinels instead of
      // dropping or crashing means classifyPowerCircuit's existing
      // Number.isFinite/typeof-boolean guards correctly flag it as at_risk
      // downstream, same as any other malformed circuit. [NEEDS VERIFICATION]
      // whether FRM's getPower response can actually contain a null entry --
      // not documented in docs-vault/raw-sources/frm-getPower.md -- but this is
      // the layer meant to defend against unvalidated FRM data regardless.
      if (circuit === null || typeof circuit !== "object") {
        return {
          circuitGroupId: Number.NaN,
          powerProduction: Number.NaN,
          powerConsumed: Number.NaN,
          powerCapacity: Number.NaN,
          maxPowerConsumed: Number.NaN,
          fuseTriggered: false,
          batteryPercent: Number.NaN,
          batteryDifferential: Number.NaN,
          batteryCapacity: Number.NaN,
        };
      }
      return {
        circuitGroupId: circuit.CircuitGroupID,
        powerProduction: circuit.PowerProduction,
        powerConsumed: circuit.PowerConsumed,
        powerCapacity: circuit.PowerCapacity,
        maxPowerConsumed: circuit.PowerMaxConsumed,
        fuseTriggered: circuit.FuseTriggered,
        batteryPercent: circuit.BatteryPercent,
        batteryDifferential: circuit.BatteryDifferential,
        batteryCapacity: circuit.BatteryCapacity,
      };
    });
  }

  async getPowerUsage(): Promise<BuildingPowerUsage[]> {
    const raw = await this.getFrmArray<RawFrmPowerUsageBuilding>("getPowerUsage");
    return raw.map((building) => ({
      id: building.ID,
      name: building.Name,
      className: building.ClassName,
      circuitGroupId: building.PowerInfo.CircuitGroupID,
      powerConsumed: building.PowerInfo.PowerConsumed,
      maxPowerConsumed: building.PowerInfo.MaxPowerConsumed,
      fuseTriggered: building.PowerInfo.FuseTriggered ?? false,
    }));
  }

  async getPlayers(): Promise<Player[]> {
    const raw = await this.getFrmArray<RawFrmPlayer>("getPlayer");
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
