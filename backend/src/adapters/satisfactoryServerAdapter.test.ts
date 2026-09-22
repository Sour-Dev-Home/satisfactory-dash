import { describe, it, expect, vi } from "vitest";
import { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
import type { VanillaApiClientLike, FrmApiClientLike } from "./satisfactoryServerAdapter.js";
import {
  healthCheckFixture,
  queryServerStateFixture,
  factoryBuildingFixture,
  powerCircuitFixture,
  powerUsageBuildingFixture,
  playerFixture,
  sessionInfoFixture,
} from "./__fixtures__/rawFixtures.js";

function buildAdapter(overrides: { vanilla?: Partial<VanillaApiClientLike>; frm?: Partial<FrmApiClientLike> } = {}) {
  const vanillaApi: VanillaApiClientLike = {
    call: vi.fn(),
    ...overrides.vanilla,
  };
  const frmApi: FrmApiClientLike = {
    get: vi.fn(),
    ...overrides.frm,
  };
  return { adapter: new SatisfactoryServerAdapter(vanillaApi, frmApi), vanillaApi, frmApi };
}

describe("SatisfactoryServerAdapter", () => {
  it("maps HealthCheck to ServerHealth", async () => {
    const { adapter, vanillaApi } = buildAdapter({
      vanilla: { call: vi.fn().mockResolvedValue(healthCheckFixture) },
    });
    await expect(adapter.getServerHealth()).resolves.toEqual({ healthy: true });
    expect(vanillaApi.call).toHaveBeenCalledWith("HealthCheck", { ClientCustomData: "" });
  });

  it("maps QueryServerState to ServerStatus using the live camelCase field names", async () => {
    const { adapter } = buildAdapter({
      vanilla: { call: vi.fn().mockResolvedValue(queryServerStateFixture) },
    });
    await expect(adapter.getServerStatus()).resolves.toEqual({
      sessionName: "docs-vault-spike",
      isGameRunning: true,
      isPaused: false,
      connectedPlayers: 0,
      playerLimit: 4,
      tickRate: 29.885358810424805,
      totalGameDurationSeconds: 29,
    });
  });

  it("maps getFactory buildings, including production/consumption/inventory", async () => {
    const { adapter, frmApi } = buildAdapter({
      frm: { get: vi.fn().mockResolvedValue([factoryBuildingFixture]) },
    });
    const buildings = await adapter.getFactoryBuildings();
    expect(frmApi.get).toHaveBeenCalledWith("getFactory");
    expect(buildings).toEqual([
      {
        id: "Build_ConstructorMk1_C_2147415548",
        name: "Constructor",
        className: "Build_ConstructorMk1_C",
        recipe: "Concrete",
        isProducing: false,
        isPaused: true,
        production: [
          { name: "Concrete", className: "Desc_Cement_C", currentPerMinute: 0, maxPerMinute: 1.649999976158142, percent: 0 },
        ],
        consumption: [
          { name: "Limestone", className: "Desc_Stone_C", currentPerMinute: 0, maxPerMinute: 4.949999809265137, percent: 0 },
        ],
        outputInventory: [{ name: "Concrete", className: "Desc_Cement_C", amount: 100, maxAmount: 100 }],
        circuitId: 1,
        powerConsumed: 0.10000000149011612,
        maxPowerConsumed: 0.21619677543640137,
      },
    ]);
  });

  it("flags a building whose output inventory is full while producing (overflow proxy)", async () => {
    const backedUp = { ...factoryBuildingFixture, IsProducing: true, IsPaused: false };
    const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([backedUp]) } });
    const [building] = await adapter.getFactoryBuildings();
    const isBackedUp = building.isProducing && building.outputInventory.some((slot) => slot.amount >= slot.maxAmount);
    expect(isBackedUp).toBe(true);
  });

  it("defaults every optional getFactory field when the building has no recipe/production/power configured yet", async () => {
    // Per docs-vault/raw-sources/frm-getFactory.md, production/ingredients/
    // OutputInventory/PowerInfo/Recipe are all documented as present in the example,
    // but rawTypes.ts marks them optional -- e.g. an unconfigured or non-manufacturer
    // building (conveyor, storage container) plausibly omits them. This exercises the
    // adapter's `?? []` / `?? -1` / `?? 0` fallback branches, which no existing
    // fixture triggers.
    const unconfigured = {
      ID: "Build_StorageContainerMk1_C_1",
      Name: "Storage Container",
      ClassName: "Build_StorageContainerMk1_C",
      IsProducing: false,
      IsPaused: false,
      // Recipe, production, ingredients, OutputInventory, PowerInfo all omitted.
    };
    const { adapter, frmApi } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([unconfigured]) } });
    const buildings = await adapter.getFactoryBuildings();
    expect(frmApi.get).toHaveBeenCalledWith("getFactory");
    expect(buildings).toEqual([
      {
        id: "Build_StorageContainerMk1_C_1",
        name: "Storage Container",
        className: "Build_StorageContainerMk1_C",
        recipe: null,
        isProducing: false,
        isPaused: false,
        production: [],
        consumption: [],
        outputInventory: [],
        circuitId: -1,
        powerConsumed: 0,
        maxPowerConsumed: 0,
      },
    ]);
  });

  it("defaults fuseTriggered to false on getPowerUsage when PowerInfo omits it", async () => {
    // powerUsageBuildingFixture always sets FuseTriggered explicitly, so the `?? false`
    // fallback in getPowerUsage's mapping was never exercised.
    const noFuseField = {
      ...powerUsageBuildingFixture,
      PowerInfo: { ...powerUsageBuildingFixture.PowerInfo, FuseTriggered: undefined },
    };
    const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([noFuseField]) } });
    const [building] = await adapter.getPowerUsage();
    expect(building.fuseTriggered).toBe(false);
  });

  it("maps getPower circuits", async () => {
    const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([powerCircuitFixture]) } });
    await expect(adapter.getPowerCircuits()).resolves.toEqual([
      {
        circuitGroupId: 0,
        powerProduction: 0,
        powerConsumed: 0,
        powerCapacity: 0,
        maxPowerConsumed: 100,
        fuseTriggered: false,
        batteryPercent: 0,
        batteryDifferential: 0,
        batteryCapacity: 0,
      },
    ]);
  });

  // Found by a review pass: a null entry in getPower's response used to throw
  // (circuit.CircuitGroupID on null) before PowerService's own defensive
  // placeholder logic ever got a chance to run, crashing the whole /api/power
  // call. Mapped to NaN/false sentinels instead -- classifyPowerCircuit's
  // existing Number.isFinite/typeof-boolean guards then correctly read this as
  // at_risk downstream, same as any other malformed circuit.
  it("maps a null entry in getPower's response to a sentinel-invalid PowerCircuit instead of throwing", async () => {
    const { adapter } = buildAdapter({
      frm: { get: vi.fn().mockResolvedValue([powerCircuitFixture, null]) },
    });
    const circuits = await adapter.getPowerCircuits();
    expect(circuits).toHaveLength(2);
    expect(Number.isNaN(circuits[1].circuitGroupId)).toBe(true);
    expect(circuits[1].fuseTriggered).toBe(false);
  });

  it("maps getPowerUsage buildings", async () => {
    const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([powerUsageBuildingFixture]) } });
    await expect(adapter.getPowerUsage()).resolves.toEqual([
      {
        id: "Build_OilRefinery_C_2147345255",
        name: "Refinery",
        className: "Build_OilRefinery_C",
        circuitId: -1,
        powerConsumed: 0,
        maxPowerConsumed: 0,
        fuseTriggered: false,
      },
    ]);
  });

  it("maps getPlayer", async () => {
    const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([playerFixture]) } });
    await expect(adapter.getPlayers()).resolves.toEqual([
      {
        id: "Char_Player_C_2147452680",
        name: "derpierre65",
        online: true,
        dead: false,
        hp: 100,
        location: { x: -57604.6796875, y: 260436.1875, z: -3018.36083984375 },
      },
    ]);
  });

  it("maps getSessionInfo using the live-confirmed PascalCase field names", async () => {
    const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue(sessionInfoFixture) } });
    await expect(adapter.getSessionInfo()).resolves.toEqual({
      sessionName: "docs-vault-spike",
      isPaused: false,
      isDay: true,
      dayLength: 50,
      nightLength: 10,
      passedDays: 0,
      totalPlayDurationSeconds: 29,
    });
  });
});
