import { describe, expect, it, vi } from "vitest";
import { UpstreamError, createGameServerConnection, createSatisfactoryServerConfig } from "@satisfactory-dash/game-adapter";
import type { FactoryBuilding, PowerCircuit } from "@satisfactory-dash/game-adapter";
import { AgentFactorySchema, AgentPowerSchema, MapLiveSchema, ServerPlayersResponseSchema, StatusSchema } from "@satisfactory-dash/shared";
import { connectToGame, createGameReader } from "./gameReader.js";
import type { GameReaderDeps } from "./gameReader.js";

// The real factories, wrapped only to count calls: `connectToGame` must build one connection, not one per port.
vi.mock("@satisfactory-dash/game-adapter", async (importOriginal) => {
  const real = await importOriginal<typeof import("@satisfactory-dash/game-adapter")>();
  return { ...real, createGameServerConnection: vi.fn(real.createGameServerConnection), createSatisfactoryServerConfig: vi.fn(real.createSatisfactoryServerConfig) };
});

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
    getTrains: vi.fn(async () => ({ data: [{ id: "t1", name: "Iron Express", x: 120, y: -40, status: "Self-Driving" }], dropped: 1 })),
    getTrainStations: vi.fn(async () => ({ data: [{ id: "s1", name: "Iron Mine", x: 100, y: -50 }], dropped: 2 })),
    getRails: vi.fn(async () => ({ data: [], dropped: 4 })),
    getResourceNodes: vi.fn(async () => ({ data: [], dropped: 5 })),
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

  it("mapLive is the adapter's trains and stations, with both mappers' dropped counts added up", async () => {
    const d = deps();
    const live = await createGameReader(d).readMapLive!();
    expect(live).toEqual({
      trains: [{ id: "t1", name: "Iron Express", x: 120, y: -40, status: "Self-Driving" }],
      stations: [{ id: "s1", name: "Iron Mine", x: 100, y: -50 }],
      dropped: 3,
    });
    expect(MapLiveSchema.safeParse({ trains: live.trains, stations: live.stations }).success).toBe(true);
    expect(d.raw.adapter.getTrains).toHaveBeenCalledTimes(1);
    expect(d.raw.adapter.getTrainStations).toHaveBeenCalledTimes(1);
  });

  it("mapLive fails as a whole when either read fails (the sampler leaves the part out), with the adapter's error unchanged", async () => {
    const down = new UpstreamError("down", { failureKind: "unreachable" });
    await expect(createGameReader(deps({ getTrains: vi.fn(async () => Promise.reject(down)) })).readMapLive!()).rejects.toBe(down);
    await expect(createGameReader(deps({ getTrainStations: vi.fn(async () => Promise.reject(down)) })).readMapLive!()).rejects.toBe(down);
  });

  it("world: the ports are the SAME adapter's getRails/getResourceNodes, results and errors unchanged (ADR-0038 M4)", async () => {
    const d = deps();
    const game = createGameReader(d);
    expect(await game.world.getRails()).toEqual({ data: [], dropped: 4 });
    expect(await game.world.getResourceNodes()).toEqual({ data: [], dropped: 5 });
    expect(d.raw.adapter.getRails).toHaveBeenCalledTimes(1);
    expect(d.raw.adapter.getResourceNodes).toHaveBeenCalledTimes(1);
    const down = new UpstreamError("down", { failureKind: "unreachable" });
    await expect(createGameReader(deps({ getRails: vi.fn(async () => Promise.reject(down)) })).world.getRails()).rejects.toBe(down);
  });

  it("edge: the world ports are not read until the world reader asks (building the reader reads nothing)", () => {
    const d = deps();
    createGameReader(d);
    expect(d.raw.adapter.getRails).not.toHaveBeenCalled();
    expect(d.raw.adapter.getResourceNodes).not.toHaveBeenCalled();
  });

  it("a failing game read is the adapter's error, unchanged (the sampler turns it into a code)", async () => {
    const error = new UpstreamError("unreachable", { failureKind: "unreachable" });
    const reader = createGameReader(deps({ getServerHealth: vi.fn(async () => Promise.reject(error)) }));
    await expect(reader.readStatus()).rejects.toBe(error);
  });
});

describe("connectToGame (one connection for the snapshot reads and the world ports)", () => {
  it("builds ONE config and ONE adapter connection, and the world ports read through that connection", async () => {
    vi.mocked(createSatisfactoryServerConfig).mockClear();
    vi.mocked(createGameServerConnection).mockClear();
    const game = connectToGame({ host: "127.0.0.1", apiPort: 7777, frmPort: 8080, apiToken: "t" });
    expect(createSatisfactoryServerConfig).toHaveBeenCalledTimes(1);
    expect(createGameServerConnection).toHaveBeenCalledTimes(1);
    const connection = vi.mocked(createGameServerConnection).mock.results[0]!.value as Record<"getRails" | "getResourceNodes", () => Promise<unknown>>;
    const rails = vi.spyOn(connection, "getRails").mockResolvedValue({ data: [], dropped: 0 });
    const nodes = vi.spyOn(connection, "getResourceNodes").mockResolvedValue({ data: [], dropped: 0 });
    await game.world.getRails();
    await game.world.getResourceNodes();
    expect(rails).toHaveBeenCalledTimes(1);
    expect(nodes).toHaveBeenCalledTimes(1);
  });
});
