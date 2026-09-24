import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { ApiErrorResponseSchema, PowerHistoryResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { PowerHistoryResponse } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import type { PowerCircuit, ServerStatus } from "../../gameserver/index.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { createTelemetryRouters, createTelemetryServices } from "../index.js";
import type { TelemetryPorts } from "../index.js";

const T0 = 1_700_000_000_000;
const INTERVAL_MS = 5000;

const circuit = (id: number, production: number, over: Partial<PowerCircuit> = {}): PowerCircuit => ({
  circuitGroupId: id,
  powerProduction: production,
  powerConsumed: production - 10,
  powerCapacity: 500,
  maxPowerConsumed: 600,
  fuseTriggered: false,
  batteryPercent: 0,
  batteryDifferential: 0,
  batteryCapacity: 0,
  ...over,
});

/** What the fake game server answers at each tick; the test changes it between steps. */
const world = {
  session: "Session A",
  gameSeconds: 1000,
  paused: false,
  down: false,
  circuits: [circuit(0, 100)] as PowerCircuit[],
};

const ports = {
  async getServerStatus(): Promise<ServerStatus> {
    if (world.down) throw new Error("game server unreachable");
    return {
      sessionName: world.session,
      isGameRunning: true,
      isPaused: world.paused,
      connectedPlayers: 0,
      playerLimit: 4,
      tickRate: 30,
      totalGameDurationSeconds: world.gameSeconds,
    };
  },
  async getPowerCircuits() {
    if (world.down) throw new Error("game server unreachable");
    return world.circuits;
  },
  getServerHealth: async () => ({ tickHealth: "healthy" as const }),
  getFactoryBuildings: async () => [],
  getBuildingPowerUsage: async () => [],
} as unknown as TelemetryPorts;

function build() {
  const bundle = createTelemetryServices(ports, undefined, { logger: createLogger({ level: "silent" }) });
  const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: { telemetry: bundle } }]);
  const app = createApp({ logger: createLogger({ level: "silent" }), routers: createTelemetryRouters(directory) });
  return { app, workers: bundle.workers };
}

async function fetchHistory(app: ReturnType<typeof build>["app"]): Promise<PowerHistoryResponse> {
  const res = await request(app).get(endpoints.powerHistory.path("default"));
  expect(res.status).toBe(200);
  return PowerHistoryResponseSchema.parse(res.body);
}

/** The three invariants the contract relies on but the schema does not enforce (the
 *  architect's rule: every shared constraint is enforced first by the producer). */
function expectInvariants(body: PowerHistoryResponse) {
  const { series, pausedRanges, windowSeconds, intervalSeconds } = body.data;
  const cap = windowSeconds / intervalSeconds;
  for (const { circuitGroupId, points } of series) {
    expect(points.length, `circuit ${circuitGroupId} within the cap`).toBeLessThanOrEqual(cap);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].t, `circuit ${circuitGroupId} ascending at ${i}`).toBeGreaterThan(points[i - 1].t);
    }
  }
  for (const { fromT, toT } of pausedRanges) {
    expect(fromT).toBeLessThanOrEqual(toT);
  }
}

describe("GET /api/servers/:serverId/power/history", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(T0);
    Object.assign(world, { session: "Session A", gameSeconds: 1000, paused: false, down: false, circuits: [circuit(0, 100)] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves an empty, well-formed history before anything has been sampled, marked stale once it should have been", async () => {
    const { app } = build();
    const body = await fetchHistory(app);
    expect(body.data).toEqual({ windowSeconds: 300, intervalSeconds: 5, series: [], pausedRanges: [] });
    expect(body.serverId).toBe("default");
    expect(body.stale).toBe(true); // nothing is polling yet
  });

  it("the whole story: gaps, a pause and a reset, with every invariant true on the real response", async () => {
    const { app, workers } = build();
    workers.forEach((w) => w.start());
    const tick = (n = 1) => vi.advanceTimersByTimeAsync(n * INTERVAL_MS);

    await tick(0); // sample at +0 s
    await tick(4); // +5 .. +20 s: five samples so far
    world.down = true;
    await tick(3); // +25, +30, +35 s fail: a gap
    world.down = false;
    world.paused = true;
    world.circuits = [circuit(0, 100), circuit(1, 20)]; // a second circuit appears
    await tick(3); // +40, +45, +50 s: paused
    world.paused = false;
    world.circuits = [circuit(0, 110), circuit(1, 25, { fuseTriggered: true, powerProduction: 0, powerConsumed: 0, powerCapacity: 0 })];
    await tick(3); // +55, +60, +65 s

    let body = await fetchHistory(app);
    expectInvariants(body);
    const main = body.data.series.find((s) => s.circuitGroupId === 0)!.points;
    const side = body.data.series.find((s) => s.circuitGroupId === 1)!.points;
    // The gap is real (25-35 s) and nothing was made up for it.
    expect(main.map((p) => p.t - T0)).toEqual([0, 5, 10, 15, 20, 40, 45, 50, 55, 60, 65].map((s) => s * 1000));
    // The side circuit only exists from 40 s on, and its fuse trip shows.
    expect(side.map((p) => p.t - T0)).toEqual([40, 45, 50, 55, 60, 65].map((s) => s * 1000));
    expect(side.slice(0, 3).every((p) => !p.fuseTriggered)).toBe(true);
    expect(side.slice(3).every((p) => p.fuseTriggered && p.productionMW === 0)).toBe(true);
    // The pause is one well-formed range covering exactly the paused samples.
    expect(body.data.pausedRanges).toEqual([{ fromT: T0 + 40_000, toT: T0 + 50_000 }]);
    expect(body.stale).toBe(false);

    // A long run: the history stays capped, ordered, and forgets what left the window.
    await tick(80); // to +465 s
    body = await fetchHistory(app);
    expectInvariants(body);
    const later = body.data.series.find((s) => s.circuitGroupId === 0)!.points;
    expect(later).toHaveLength(60);
    expect(later[0].t).toBeGreaterThan(Date.now() - 300_000);
    expect(body.data.pausedRanges).toEqual([]); // the pause has left the window

    // A new game session clears the history: series never span a reload.
    world.session = "Session B";
    world.circuits = [circuit(4, 300)];
    await tick(2);
    body = await fetchHistory(app);
    expectInvariants(body);
    expect(body.data.series.map((s) => s.circuitGroupId)).toEqual([4]);
    expect(body.data.series[0].points).toHaveLength(2);

    // The game clock going backwards (an older save) clears it as well.
    world.gameSeconds = 10;
    await tick(1);
    body = await fetchHistory(app);
    expectInvariants(body);
    expect(body.data.series[0].points).toHaveLength(1);

    // While the game server is down the last data is served, flagged stale after 3 intervals.
    world.down = true;
    await tick(2);
    expect((await fetchHistory(app)).stale).toBe(false);
    await tick(2);
    body = await fetchHistory(app);
    expect(body.stale).toBe(true);
    expectInvariants(body);
    expect(body.data.series[0].points).toHaveLength(1);
    expect(new Date(body.observedAt).getTime()).toBeLessThan(Date.now());

    await Promise.all(workers.map((w) => w.stop()));
  });

  it("a pause still open at the newest sample ends at that sample", async () => {
    const { app, workers } = build();
    workers.forEach((w) => w.start());
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    world.paused = true;
    await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);
    const body = await fetchHistory(app);
    expectInvariants(body);
    expect(body.data.pausedRanges).toEqual([{ fromT: T0 + 2 * INTERVAL_MS, toT: T0 + 3 * INTERVAL_MS }]);
    await Promise.all(workers.map((w) => w.stop()));
  });

  it("never touches the game server when a client asks: the request is a memory read", async () => {
    const { app, workers } = build();
    workers.forEach((w) => w.start());
    await vi.advanceTimersByTimeAsync(0);
    const spy = vi.spyOn(ports, "getPowerCircuits");
    for (let i = 0; i < 5; i++) await fetchHistory(app);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    await Promise.all(workers.map((w) => w.stop()));
  });

  it("an unknown server id is the usual 404 server_not_found", async () => {
    const { app } = build();
    const res = await request(app).get(endpoints.powerHistory.path("nope"));
    expect(res.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("server_not_found");
  });

  it("the live power route still works next to it (the /power/history path does not shadow /power)", async () => {
    const { app } = build();
    const res = await request(app).get(endpoints.power.path("default"));
    expect(res.status).toBe(200);
    expect(res.body.data.circuits[0].circuitGroupId).toBe(0);
  });
});
