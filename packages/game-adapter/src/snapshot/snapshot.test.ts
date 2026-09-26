import { describe, expect, it } from "vitest";
import { AgentFactorySchema, AgentPowerSchema, ServerPlayersResponseSchema, StatusSchema } from "@satisfactory-dash/shared";
import type { FactoryBuilding, PowerCircuit } from "../domain.js";
import { UpstreamError } from "../errors.js";
import { isBackedUp, isFrmAbsent, mapFactoryBuilding, mapPlayers, mapPowerCircuit, mapStatus, readPlayers } from "./index.js";

/** ADR-0031: the shape mapping the backend's services and the edge agent share. */

const rate = (className: string, percent = 100) => ({ name: className, className, currentPerMinute: 20, maxPerMinute: 20, percent });
const building = (overrides: Partial<FactoryBuilding> = {}): FactoryBuilding => ({
  id: "b1",
  name: "Constructor",
  className: "Build_ConstructorMk1_C",
  recipe: "Iron Plate",
  isProducing: true,
  isPaused: false,
  production: [rate("Desc_IronPlate_C")],
  consumption: [rate("Desc_IronIngot_C", 80)],
  outputInventory: [],
  circuitGroupId: 3,
  powerConsumed: 4,
  maxPowerConsumed: 4,
  ...overrides,
});
const circuit = (overrides: Partial<PowerCircuit> = {}): PowerCircuit => ({
  circuitGroupId: 3,
  powerProduction: 100,
  powerConsumed: 60,
  powerCapacity: 120,
  maxPowerConsumed: 80,
  fuseTriggered: false,
  batteryPercent: 50,
  batteryDifferential: -1.5,
  batteryCapacity: 10,
  ...overrides,
});

describe("mapStatus", () => {
  it("merges health and state field by field into the contract's Status, and leaks no other field", () => {
    const status = mapStatus(
      { tickHealth: "slow" },
      { sessionName: "Save", isGameRunning: true, isPaused: true, connectedPlayers: 2, playerLimit: 4, tickRate: 9.5, totalGameDurationSeconds: 1234, secret: "leak" } as never,
    );
    expect(status).toEqual({ tickHealth: "slow", sessionName: "Save", isGameRunning: true, gamePaused: true, connectedPlayers: 2, playerLimit: 4, tickRate: 9.5, totalGameDurationSeconds: 1234 });
    expect(StatusSchema.safeParse(status).success).toBe(true);
  });
});

describe("players", () => {
  it("maps name and online only (ADR-0029), dropping every other field", () => {
    const response = mapPlayers([{ name: "Ada", online: true, id: "steam-1", location: { x: 1 } } as never, { name: "Bo", online: false }]);
    expect(response).toEqual({ available: true, players: [{ name: "Ada", online: true }, { name: "Bo", online: false }] });
    expect(ServerPlayersResponseSchema.safeParse(response).success).toBe(true);
  });

  it("FRM absent (unreachable, or an HTTP error status) is `available: false`; an invalid response is still an error", async () => {
    for (const err of [
      new UpstreamError("down", { failureKind: "unreachable" }),
      new UpstreamError("404", { status: 404 }),
      new UpstreamError("refused", { status: 403 }),
    ]) {
      expect(isFrmAbsent(err)).toBe(true);
      expect(await readPlayers(() => Promise.reject(err))).toEqual({ available: false, players: [] });
    }
    const invalid = new UpstreamError("bad shape", { failureKind: "invalid_response" });
    expect(isFrmAbsent(invalid)).toBe(false);
    await expect(readPlayers(() => Promise.reject(invalid))).rejects.toBe(invalid);
  });

  it("anything that is not an UpstreamError (our own bug) is rethrown, never turned into `available: false`", async () => {
    const bug = new TypeError("boom");
    expect(isFrmAbsent(bug)).toBe(false);
    await expect(readPlayers(() => Promise.reject(bug))).rejects.toBe(bug);
  });

  it("a successful read is available", async () => {
    expect(await readPlayers(async () => [{ name: "Ada", online: true }])).toEqual({ available: true, players: [{ name: "Ada", online: true }] });
  });
});

describe("mapPowerCircuit", () => {
  it("renames the adapter's fields to the contract's, carries no `status`, and passes the agent-input schema", () => {
    const mapped = mapPowerCircuit(circuit());
    expect(mapped).toEqual({
      circuitGroupId: 3,
      productionMW: 100,
      consumptionMW: 60,
      capacityMW: 120,
      maxConsumptionMW: 80,
      fuseTriggered: false,
      batteryCapacityMWh: 10,
      batteryPercent: 50,
      batteryDifferentialMW: -1.5,
    });
    expect(mapped).not.toHaveProperty("status");
    expect(AgentPowerSchema.safeParse({ circuits: [mapped] }).success).toBe(true);
  });

  it("does not leak a field the adapter type does not name", () => {
    expect(Object.keys(mapPowerCircuit({ ...circuit(), extra: 1 } as never)).sort()).toEqual(
      ["batteryCapacityMWh", "batteryDifferentialMW", "batteryPercent", "capacityMW", "circuitGroupId", "consumptionMW", "fuseTriggered", "maxConsumptionMW", "productionMW"],
    );
  });
});

describe("isBackedUp (a raw fact: an output slot at capacity)", () => {
  const full = [{ name: "Plate", className: "Desc_IronPlate_C", amount: 100, maxAmount: 100 }];
  it("is true for a configured, unpaused machine with a full output slot, even when it is not producing (B1)", () => {
    expect(isBackedUp(building({ isProducing: false, outputInventory: full }))).toBe(true);
    expect(isBackedUp(building({ outputInventory: [{ ...full[0]!, amount: 150 }] }))).toBe(true);
  });
  it("is false when paused, unconfigured, empty, partly full, or the slot has no capacity", () => {
    expect(isBackedUp(building({ isPaused: true, outputInventory: full }))).toBe(false);
    expect(isBackedUp(building({ recipe: null, outputInventory: full }))).toBe(false);
    expect(isBackedUp(building({ outputInventory: [] }))).toBe(false);
    expect(isBackedUp(building({ outputInventory: [{ ...full[0]!, amount: 99 }] }))).toBe(false);
    expect(isBackedUp(building({ outputInventory: [{ ...full[0]!, amount: 0, maxAmount: 0 }] }))).toBe(false);
  });
  it("any full slot is enough", () => {
    expect(isBackedUp(building({ outputInventory: [{ ...full[0]!, amount: 1 }, ...full] }))).toBe(true);
  });
});

describe("mapFactoryBuilding", () => {
  it("maps the contract's fields with isBackedUp, no `state` and no `unit`, and passes the agent-input schema", () => {
    const mapped = mapFactoryBuilding(building({ location: { xM: 1, yM: 2, zM: 3, rotationDeg: 90 }, clockSpeedPercent: 150, fuseTriggered: false }));
    expect(mapped).toEqual({
      id: "b1",
      name: "Constructor",
      className: "Build_ConstructorMk1_C",
      recipe: "Iron Plate",
      isProducing: true,
      isPaused: false,
      isBackedUp: false,
      circuitGroupId: 3,
      location: { xM: 1, yM: 2, zM: 3, rotationDeg: 90 },
      clockSpeedPercent: 150,
      production: [rate("Desc_IronPlate_C")],
      ingredients: [rate("Desc_IronIngot_C", 80)],
    });
    for (const key of ["state", "fuseTriggered", "outputInventory", "powerConsumed", "maxPowerConsumed"]) expect(mapped, key).not.toHaveProperty(key);
    expect(AgentFactorySchema.safeParse({ buildings: [mapped] }).success).toBe(true);
  });

  it("omits location and clockSpeedPercent when the adapter has none, and always sends ingredients (possibly empty)", () => {
    const mapped = mapFactoryBuilding(building({ consumption: [] }));
    expect(mapped).not.toHaveProperty("location");
    expect(mapped).not.toHaveProperty("clockSpeedPercent");
    expect(mapped.ingredients).toEqual([]);
  });

  it("copies the rates, so a later change to the adapter's object cannot alter what was mapped", () => {
    const source = building();
    const mapped = mapFactoryBuilding(source);
    source.production[0]!.percent = 1;
    expect(mapped.production[0]!.percent).toBe(100);
  });

  it("marks a backed-up machine", () => {
    expect(mapFactoryBuilding(building({ isProducing: false, outputInventory: [{ name: "Plate", className: "Desc_IronPlate_C", amount: 5, maxAmount: 5 }] })).isBackedUp).toBe(true);
  });
});
