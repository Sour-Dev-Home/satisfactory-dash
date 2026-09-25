import type { SatisfactoryServerConfig } from "./connectionConfig.js";
import { VanillaApiClient } from "./vanillaApiClient.js";
import { z } from "zod";
import { FrmApiClient } from "./frmApiClient.js";
import {
  RawHealthCheckResponseSchema,
  RawQueryServerStateResponseSchema,
  RawFrmFactoryBuildingSchema,
  RawFrmPowerResponseSchema,
  RawFrmPowerUsageBuildingSchema,
  RawFrmPlayerSchema,
  RawFrmSessionInfoSchema,
} from "./rawSchemas.js";
import type { RawFrmProductionItem, RawFrmIngredientItem, RawFrmInventorySlot, RawFrmLocation } from "./rawTypes.js";
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
import { UpstreamError } from "../../platform/errors.js";

const MAX_REPORTED_ISSUES = 5;

/**
 * The single place raw upstream data is validated (ADR-0002; PR 3). A response that
 * doesn't match its schema -- wrong type, a missing field, a null entry in an array,
 * an out-of-range value, a non-array body, an empty vanilla body -- becomes one
 * UpstreamError(invalid_response), i.e. a 502 upstream_invalid_response, instead of a
 * TypeError somewhere in the mapping below. The zod error rides along as `cause` for
 * the logs; the message names the first few failing paths.
 */
function parseUpstream<S extends z.ZodType>(source: string, schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new UpstreamError(`${source} response failed validation: ${issues}`, {
    failureKind: "invalid_response",
    cause: result.error,
  });
}

/** Narrow interfaces so the adapter can be tested against fakes without a real
 *  network transport. VanillaApiClient/FrmApiClient satisfy these directly. */
export interface VanillaApiClientLike {
  call<T>(functionName: string, data?: unknown): Promise<T>;
}
export interface FrmApiClientLike {
  get<T>(endpoint: string): Promise<T>;
}

/** FRM positions are Unreal centimetres: 333 of 338 captured buildings sit on a 100-unit grid
 *  (ADR-0023), and two community sources agree (docs-vault/raw-sources/world-coordinates.md,
 *  themselves approximate); the owner's in-game check is still pending. The contract is
 *  metres (ADR-0006) and the yaw is normalized to [0, 360); FRM's pitch is dropped. */
const CM_PER_M = 100;
function mapLocation(location: RawFrmLocation): NonNullable<FactoryBuilding["location"]> {
  const yaw = (((location.rotation ?? 0) % 360) + 360) % 360;
  return {
    xM: location.x / CM_PER_M,
    yM: location.y / CM_PER_M,
    zM: location.z / CM_PER_M,
    rotationDeg: yaw,
  };
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
    const raw = parseUpstream(
      "HealthCheck",
      RawHealthCheckResponseSchema,
      await this.vanillaApi.call<unknown>("HealthCheck", { ClientCustomData: "" }),
    );
    return { tickHealth: raw.health };
  }

  async getServerStatus(): Promise<ServerStatus> {
    const raw = parseUpstream(
      "QueryServerState",
      RawQueryServerStateResponseSchema,
      await this.vanillaApi.call<unknown>("QueryServerState"),
    );
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
    const raw = parseUpstream("getFactory", z.array(RawFrmFactoryBuildingSchema), await this.frmApi.get<unknown>("getFactory"));
    return raw.map((building) => {
      // B2 (2026-09-22 captures): FRM reports an unconfigured machine as Recipe
      // "Unassigned" plus a placeholder "Unassigned" production/ingredient entry, not
      // as a missing recipe. IsConfigured (frm-getFactory.md:57) is the explicit
      // signal; "Unassigned" is checked too so the mapping still holds if a response
      // ever omits the flag (the PR's fresh-eyes review found that gap), and a missing
      // Recipe counts as unconfigured so recipe and production can't disagree (PR #17).
      const configured =
        building.IsConfigured !== false && building.Recipe !== undefined && building.Recipe !== "Unassigned";
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
        ...(building.location ? { location: mapLocation(building.location) } : {}),
      };
    });
  }

  async getPowerCircuits(): Promise<PowerCircuit[]> {
    const raw = parseUpstream("getPower", RawFrmPowerResponseSchema, await this.frmApi.get<unknown>("getPower"));
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
    const raw = parseUpstream("getPowerUsage", z.array(RawFrmPowerUsageBuildingSchema), await this.frmApi.get<unknown>("getPowerUsage"));
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
    const raw = parseUpstream("getPlayer", z.array(RawFrmPlayerSchema), await this.frmApi.get<unknown>("getPlayer"));
    return raw.map((player) => ({ name: player.Name, online: player.Online }));
  }

  async getSessionInfo(): Promise<SessionInfo> {
    const raw = parseUpstream("getSessionInfo", RawFrmSessionInfoSchema, await this.frmApi.get<unknown>("getSessionInfo"));
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
