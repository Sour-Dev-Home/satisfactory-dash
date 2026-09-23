import { describe, it, expect, vi } from "vitest";
import { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
import type { VanillaApiClientLike, FrmApiClientLike } from "./satisfactoryServerAdapter.js";
import { UpstreamError } from "../../platform/errors.js";
import {
  healthCheckFixture,
  queryServerStateFixture,
  factoryBuildingFixture,
  powerCircuitFixture,
  powerUsageBuildingFixture,
  playerFixture,
  sessionInfoFixture,
} from "./__fixtures__/rawFixtures.js";
import {
  capturedBackedUpAssembler,
  capturedFuelRefinery,
  capturedTrippedGridRefinery,
  capturedUnassignedAssembler,
} from "./__fixtures__/capturedFixtures.js";

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
    await expect(adapter.getServerHealth()).resolves.toEqual({ tickHealth: "healthy" });
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
        circuitGroupId: 0,
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
        circuitGroupId: -1,
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

  // A null entry in getPower used to throw a bare TypeError; an earlier fix mapped it
  // to NaN sentinels that PowerService turned into an at_risk placeholder row. The
  // contract now says circuits never contain placeholder rows (PR 3): malformed
  // upstream data fails validation as one upstream error instead.
  it("rejects a getPower response with a null entry as an invalid response", async () => {
    const { adapter } = buildAdapter({
      frm: { get: vi.fn().mockResolvedValue([powerCircuitFixture, null]) },
    });
    const err = await adapter.getPowerCircuits().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ failureKind: "invalid_response" });
    expect((err as Error).message).toContain("getPower response failed validation: 1:");
  });

  // Found by a review pass: every array endpoint `.map`-ed the body directly, so
  // an object or null body threw a bare TypeError, reported to the user as
  // "Could not reach the Satisfactory dedicated server" even though FRM answered.
  it.each([
    ["getFactory", (a: SatisfactoryServerAdapter) => a.getFactoryBuildings()],
    ["getPower", (a: SatisfactoryServerAdapter) => a.getPowerCircuits()],
    ["getPowerUsage", (a: SatisfactoryServerAdapter) => a.getPowerUsage()],
    ["getPlayer", (a: SatisfactoryServerAdapter) => a.getPlayers()],
  ] as const)("rejects a non-array %s body as an invalid response", async (endpoint, call) => {
    for (const body of [null, {}, "nope"]) {
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue(body) } });
      const err = await call(adapter).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UpstreamError);
      expect(err).toMatchObject({ failureKind: "invalid_response" });
      expect((err as Error).message).toContain(`${endpoint} response failed validation`);
    }
  });

  it("maps getPowerUsage buildings", async () => {
    const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([powerUsageBuildingFixture]) } });
    await expect(adapter.getPowerUsage()).resolves.toEqual([
      {
        id: "Build_OilRefinery_C_2147345255",
        name: "Refinery",
        className: "Build_OilRefinery_C",
        circuitGroupId: -1,
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

  // Regressions found by the 2026-09-22 live captures (docs-vault/wiki/frm-api.md),
  // run against real getFactory/getPowerUsage entries rather than doc-shaped ones.
  describe("live-capture regressions", () => {
    // B2: FRM reports an unconfigured machine as Recipe "Unassigned" with a placeholder
    // production entry named "Unassigned", not as a missing recipe.
    it("maps an unconfigured machine to recipe null with no production or consumption", async () => {
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([capturedUnassignedAssembler]) } });
      const [building] = await adapter.getFactoryBuildings();
      expect(building.recipe).toBeNull();
      expect(building.production).toEqual([]);
      expect(building.consumption).toEqual([]);
    });

    // Found by the PR's fresh-eyes review: the IsConfigured-absent fallback kept
    // "Unassigned" as a real recipe, which also let a leftover full slot on an
    // unconfigured machine read as backed up.
    it('treats Recipe "Unassigned" as unconfigured even when IsConfigured is absent', async () => {
      const { IsConfigured: _omitted, ...withoutFlag } = capturedUnassignedAssembler;
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([withoutFlag]) } });
      const [building] = await adapter.getFactoryBuildings();
      expect(building.recipe).toBeNull();
      expect(building.production).toEqual([]);
    });

    it("still passes a configured machine's recipe and production through", async () => {
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([capturedFuelRefinery]) } });
      const [building] = await adapter.getFactoryBuildings();
      expect(building.recipe).toBe("Fuel");
      expect(building.production.map((p) => [p.name, p.maxPerMinute])).toEqual([
        ["Fuel", 40],
        ["Polymer Resin", 30],
      ]);
    });

    // B3: getPower is keyed by CircuitGroupID; a building's CircuitID differs from it
    // when a power switch is involved (this building: group 1, circuit 2).
    it("keys a building to its circuit GROUP, the id getPower reports", async () => {
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([capturedTrippedGridRefinery]) } });
      const [building] = await adapter.getFactoryBuildings();
      expect(building.circuitGroupId).toBe(1);
    });

    it("keys getPowerUsage entries to the circuit GROUP too", async () => {
      const usage = { ...powerUsageBuildingFixture, PowerInfo: capturedTrippedGridRefinery.PowerInfo! };
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([usage]) } });
      const [entry] = await adapter.getPowerUsage();
      expect(entry.circuitGroupId).toBe(1);
    });

    it("maps a real backed-up machine's full output slot through unchanged", async () => {
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([capturedBackedUpAssembler]) } });
      const [building] = await adapter.getFactoryBuildings();
      expect(building.isProducing).toBe(false);
      expect(building.outputInventory).toEqual([
        { name: "Reinforced Iron Plate", className: "Desc_IronPlateReinforced_C", amount: 100, maxAmount: 100 },
      ]);
    });
  });

  // PR 3: raw responses are validated, so every shape problem becomes one upstream
  // invalid_response (a 502) instead of a TypeError or a bad value reaching the
  // contract. Also covers the gaps deferred from PR #12's review and issue #8.
  describe("raw response validation", () => {
    async function rejection(promise: Promise<unknown>) {
      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UpstreamError);
      expect(err).toMatchObject({ failureKind: "invalid_response" });
      return (err as Error).message;
    }

    it("rejects an out-of-range value the contract forbids (negative battery percent)", async () => {
      const bad = { ...powerCircuitFixture, BatteryPercent: -5 };
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([bad]) } });
      expect(await rejection(adapter.getPowerCircuits())).toContain("0.BatteryPercent");
    });

    it("clamps float noise just below zero to 0 instead of rejecting it", async () => {
      const noisy = { ...powerCircuitFixture, BatteryPercent: -0.0005 };
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([noisy]) } });
      const [circuit] = await adapter.getPowerCircuits();
      expect(circuit.batteryPercent).toBe(0);
    });

    it("rejects a negative production rate", async () => {
      const bad = {
        ...factoryBuildingFixture,
        production: [{ ...factoryBuildingFixture.production![0], CurrentProd: -1 }],
      };
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([bad]) } });
      expect(await rejection(adapter.getFactoryBuildings())).toContain("CurrentProd");
    });

    it("rejects a null getFactory entry", async () => {
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([factoryBuildingFixture, null]) } });
      await rejection(adapter.getFactoryBuildings());
    });

    // Deferred from PR #12's review: an empty Recipe would get past the unconfigured check.
    it("rejects an empty-string Recipe", async () => {
      const bad = { ...factoryBuildingFixture, Recipe: "" };
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([bad]) } });
      expect(await rejection(adapter.getFactoryBuildings())).toContain("Recipe");
    });

    it("rejects a getPowerUsage entry without PowerInfo", async () => {
      const { PowerInfo: _omitted, ...bad } = powerUsageBuildingFixture;
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([bad]) } });
      expect(await rejection(adapter.getPowerUsage())).toContain("PowerInfo");
    });

    // Issue #8, item 2: a 204/empty vanilla body used to crash on raw.serverGameState.
    it.each([undefined, {}, { serverGameState: null }])("rejects an unusable QueryServerState body %j", async (body) => {
      const { adapter } = buildAdapter({ vanilla: { call: vi.fn().mockResolvedValue(body) } });
      await rejection(adapter.getServerStatus());
    });

    it("rejects a HealthCheck health value other than healthy/slow", async () => {
      const { adapter } = buildAdapter({ vanilla: { call: vi.fn().mockResolvedValue({ health: "great" }) } });
      await rejection(adapter.getServerHealth());
    });

    it("rejects a non-integer or negative player count", async () => {
      for (const numConnectedPlayers of [-1, 1.5]) {
        const body = {
          ...queryServerStateFixture,
          serverGameState: { ...queryServerStateFixture.serverGameState, numConnectedPlayers },
        };
        const { adapter } = buildAdapter({ vanilla: { call: vi.fn().mockResolvedValue(body) } });
        expect(await rejection(adapter.getServerStatus())).toContain("numConnectedPlayers");
      }
    });

    it("reports at most five failing paths in the message", async () => {
      const bad = Array.from({ length: 20 }, () => null);
      const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue(bad) } });
      const message = await rejection(adapter.getPowerCircuits());
      expect(message.split(";").length).toBe(5);
    });
  });

  // Found by PR #17's fresh-eyes review: with no Recipe but a production array, the
  // building came out recipe:null with production filled in, contradicting the
  // contract ("production is empty when no recipe is configured").
  it("treats a building with no Recipe field as unconfigured, dropping any production", async () => {
    const { Recipe: _omitted, ...noRecipe } = factoryBuildingFixture;
    const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue([noRecipe]) } });
    const [building] = await adapter.getFactoryBuildings();
    expect(building).toMatchObject({ recipe: null, production: [], consumption: [] });
  });

  // Found by PR #22's fresh-eyes review: the contract says circuitGroupId is unique
  // within one response, and every contract constraint is enforced in the adapter.
  it("rejects a getPower response that repeats a circuit group id", async () => {
    const dup = [powerCircuitFixture, { ...powerCircuitFixture }];
    const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue(dup) } });
    const err = await adapter.getPowerCircuits().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as Error).message).toContain("duplicate circuit group id");
  });

  it("accepts distinct circuit group ids", async () => {
    const two = [powerCircuitFixture, { ...powerCircuitFixture, CircuitGroupID: 1 }];
    const { adapter } = buildAdapter({ frm: { get: vi.fn().mockResolvedValue(two) } });
    await expect(adapter.getPowerCircuits()).resolves.toHaveLength(2);
  });
});
