import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@satisfactory-dash/game-adapter";
import type { FactoryBuilding, PowerCircuit } from "@satisfactory-dash/game-adapter";
import { AgentFactorySchema, AgentPowerSchema, ServerPlayersResponseSchema, StatusSchema } from "@satisfactory-dash/shared";
import { createGameReader } from "./gameReader.js";
import type { GameReaderDeps } from "./gameReader.js";

const building: FactoryBuilding = {
  id: "b1",
  name: "Constructor",
  className: "Build_ConstructorMk1_C",
  recipe: "Iron Plate",
  isProducing: false,
  isPaused: false,
  production: [{ name: "Iron Plate", className: "Desc_IronPlate_C", currentPerMinute: 20, maxPerMinute: 20, percent: 100 }],
  consumption: [{ name: "Iron Ingot", className: "Desc_IronIngot_C", currentPerMinute: 30, maxPerMinute: 30, percent: 100 }],
  outputInventory: [{ name: "Iron Plate", className: "Desc_IronPlate_C", amount: 100, maxAmount: 100 }],
  circuitGroupId: 2,
  powerConsumed: 4,
  maxPowerConsumed: 4,
  fuseTriggered: true,
};
const circuit: PowerCircuit = { circuitGroupId: 2, powerProduction: 100, powerConsumed: 60, powerCapacity: 120, maxPowerConsumed: 80, fuseTriggered: true, batteryPercent: 50, batteryDifferential: -1, batteryCapacity: 10 };

function deps(overrides: Partial<GameReaderDeps["adapter"]> = {}, options: Partial<GameReaderDeps["options"]> = {}) {
  const adapter = {
    getServerHealth: vi.fn(async () => ({ tickHealth: "healthy" as const })),
    getServerStatus: vi.fn(async () => ({ sessionName: "Save", isGameRunning: true, isPaused: false, connectedPlayers: 1, playerLimit: 4, tickRate: 30, totalGameDurationSeconds: 100 })),
    getPowerCircuits: vi.fn(async () => [circuit]),
    getFactoryBuildings: vi.fn(async () => [building]),
    getPlayers: vi.fn(async () => [{ name: "Ada", online: true }]),
    ...overrides,
  };
  const portOptions = {
    readAutoPause: vi.fn(async () => ({ autoPause: true, pending: false })),
    applyAutoPause: vi.fn(async () => undefined),
    canEditOptions: vi.fn(async () => true),
    ...options,
  };
  return { adapter: adapter as unknown as GameReaderDeps["adapter"], options: portOptions as GameReaderDeps["options"], raw: { adapter, portOptions } };
}

describe("what the reader gives the sampler", () => {
  it("status is the contract's Status, merged from health and state", async () => {
    const reader = createGameReader(deps());
    const status = await reader.readStatus();
    expect(status).toEqual({ tickHealth: "healthy", sessionName: "Save", isGameRunning: true, gamePaused: false, connectedPlayers: 1, playerLimit: 4, tickRate: 30, totalGameDurationSeconds: 100 });
    expect(StatusSchema.safeParse(status).success).toBe(true);
  });

  it("power and factory are the AGENT-INPUT shapes: raw readings and isBackedUp, and NONE of the backend's derived fields", async () => {
    const reader = createGameReader(deps());
    const power = await reader.readPower();
    const factory = await reader.readFactory();
    expect(AgentPowerSchema.safeParse(power).success).toBe(true);
    expect(AgentFactorySchema.safeParse(factory).success).toBe(true);
    expect(power.circuits[0]).not.toHaveProperty("status");
    expect(power).not.toHaveProperty("hasOutage");
    const mapped = factory.buildings[0]!;
    for (const derived of ["state", "fuseTriggered"]) expect(mapped, derived).not.toHaveProperty(derived);
    expect(factory).not.toHaveProperty("stateCounts");
    expect(factory).not.toHaveProperty("backedUpCount");
    expect(mapped.production[0]).not.toHaveProperty("unit");
    expect(mapped.isBackedUp).toBe(true); // the raw fact, computed here from the output inventory
    expect(power.circuits[0]!.fuseTriggered).toBe(true); // the raw reading the backend joins to machines
  });

  it("players: the list when FRM answers, `available: false` when it is absent, and a bug is not hidden", async () => {
    expect(await createGameReader(deps()).readPlayers()).toEqual({ available: true, players: [{ name: "Ada", online: true }] });
    const absent = createGameReader(deps({ getPlayers: vi.fn(async () => Promise.reject(new UpstreamError("down", { failureKind: "unreachable" }))) }));
    const players = await absent.readPlayers();
    expect(players).toEqual({ available: false, players: [] });
    expect(ServerPlayersResponseSchema.safeParse(players).success).toBe(true);
    const bug = createGameReader(deps({ getPlayers: vi.fn(async () => Promise.reject(new TypeError("boom"))) }));
    await expect(bug.readPlayers()).rejects.toThrow("boom");
  });

  it("auto-pause is the value IN FORCE (a waiting change is not what the game runs), and applying passes the value through", async () => {
    const d = deps({}, { readAutoPause: vi.fn(async () => ({ autoPause: false, pending: true })) });
    const reader = createGameReader(d);
    expect(await reader.readAutoPause()).toBe(false);
    await reader.applyAutoPause(true);
    expect(d.raw.portOptions.applyAutoPause).toHaveBeenCalledWith(true);
  });

  it("a failing game read is the adapter's error, unchanged (the sampler turns it into a code)", async () => {
    const error = new UpstreamError("unreachable", { failureKind: "unreachable" });
    const reader = createGameReader(deps({ getServerHealth: vi.fn(async () => Promise.reject(error)) }));
    await expect(reader.readStatus()).rejects.toBe(error);
  });
});
