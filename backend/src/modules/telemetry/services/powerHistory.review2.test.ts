import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PowerHistoryResponseSchema } from "@satisfactory-dash/shared";
import type { PowerCircuit, ServerStatus } from "../../gameserver/index.js";
import { createLogger } from "../../../platform/logger.js";
import { PowerHistoryPoller } from "./powerHistoryPoller.js";
import type { PowerHistoryPorts } from "./powerHistoryPoller.js";
import { InMemoryPowerHistoryStore } from "./powerHistoryStore.js";
import type { PowerHistoryStore, PowerSample } from "./powerHistoryStore.js";

// Second-round fresh-eyes review of ADR-0022 (PR #81): steady-state log volume, memory, and
// the store's guarantee that anything it serves passes the shared response schema.

const T0 = 1_700_000_000_000;
const INTERVAL_MS = 5000;

const status = (over: Partial<ServerStatus> = {}): ServerStatus => ({
  sessionName: "Session A",
  isGameRunning: true,
  isPaused: false,
  connectedPlayers: 1,
  playerLimit: 4,
  tickRate: 30,
  totalGameDurationSeconds: 1000,
  ...over,
});
const circuit = (id: number, over: Partial<PowerCircuit> = {}): PowerCircuit => ({
  circuitGroupId: id,
  powerProduction: 50,
  powerConsumed: 40,
  powerCapacity: 100,
  maxPowerConsumed: 120,
  fuseTriggered: false,
  batteryPercent: 0,
  batteryDifferential: 0,
  batteryCapacity: 0,
  ...over,
});
const sample = (t: number, circuits: PowerSample["circuits"]): PowerSample => ({ t, gamePaused: false, circuits });
const reading = (id: number, over: Record<string, unknown> = {}) => ({
  circuitGroupId: id,
  productionMW: 1,
  consumptionMW: 1,
  capacityMW: 1,
  batteryPercent: 0,
  fuseTriggered: false,
  ...over,
});
const envelope = (data: unknown) => ({ serverId: "s", observedAt: new Date(T0).toISOString(), stale: false, data });

function captureLogs() {
  const lines: { level: number; msg: string }[] = [];
  const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(JSON.parse(line)) });
  return { logger, lines };
}

describe("store: whatever it serves passes the shared response schema (no poisoned buffer)", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["NaN production", { productionMW: NaN }],
    ["Infinity consumption", { consumptionMW: Infinity }],
    ["-Infinity capacity", { capacityMW: -Infinity }],
    ["negative battery", { batteryPercent: -1 }],
    ["NaN battery", { batteryPercent: NaN }],
    ["non-boolean fuse", { fuseTriggered: "yes" }],
  ];
  it.each(bad)("a circuit reading with %s is dropped, not served", (_name, over) => {
    const store = new InMemoryPowerHistoryStore();
    store.append(sample(T0, [reading(0), reading(1, over)]));
    store.append(sample(T0 + INTERVAL_MS, [reading(0), reading(1, over)]));
    const data = store.window(T0 + INTERVAL_MS);
    expect(PowerHistoryResponseSchema.safeParse(envelope(data)).success).toBe(true);
    expect(data.series.map((s) => s.circuitGroupId)).toEqual([0]);
  });

  it.each([
    ["fractional id", 1.5],
    ["NaN id", NaN],
    ["unsafe id", 1e300],
  ])("a circuit with a %s is dropped, not served", (_name, id) => {
    const store = new InMemoryPowerHistoryStore();
    store.append(sample(T0, [reading(0), reading(id)]));
    const data = store.window(T0);
    expect(PowerHistoryResponseSchema.safeParse(envelope(data)).success).toBe(true);
    expect(data.series.map((s) => s.circuitGroupId)).toEqual([0]);
  });

  it("a bad circuit in one sample does not affect a good sample around it", () => {
    const store = new InMemoryPowerHistoryStore();
    store.append(sample(T0, [reading(0)]));
    store.append(sample(T0 + INTERVAL_MS, [reading(0, { productionMW: NaN })]));
    store.append(sample(T0 + 2 * INTERVAL_MS, [reading(0)]));
    const points = store.window(T0 + 2 * INTERVAL_MS).series[0].points;
    expect(points.map((p) => p.t)).toEqual([T0, T0 + 2 * INTERVAL_MS]);
  });
});

describe("poller steady state (fake time)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const okPorts = (): PowerHistoryPorts => ({
    getServerStatus: async () => status(),
    getPowerCircuits: async () => [circuit(0), circuit(1)],
  });

  it("24 h of healthy polling keeps the buffer at its fixed size and logs nothing", async () => {
    const { logger, lines } = captureLogs();
    const store = new InMemoryPowerHistoryStore();
    const poller = new PowerHistoryPoller(okPorts(), store, { logger });
    poller.start();
    await vi.advanceTimersByTimeAsync(24 * 3600 * 1000);
    const internals = store as unknown as { buffer: unknown[]; size: number };
    expect(internals.buffer.length).toBe(60);
    expect(internals.size).toBe(60);
    const data = store.window(T0 + 24 * 3600 * 1000);
    expect(data.series).toHaveLength(2);
    for (const s of data.series) {
      expect(s.points.length).toBeLessThanOrEqual(60);
    }
    expect(lines).toEqual([]);
    await poller.stop();
  });

  it("24 h with the game server down logs once, not once per poll", async () => {
    const { logger, lines } = captureLogs();
    const poller = new PowerHistoryPoller(
      {
        getServerStatus: async () => {
          throw new Error("ECONNREFUSED");
        },
        getPowerCircuits: async () => [],
      },
      new InMemoryPowerHistoryStore(),
      { logger },
    );
    poller.start();
    await vi.advanceTimersByTimeAsync(24 * 3600 * 1000);
    expect(lines.length).toBeLessThanOrEqual(2);
    await poller.stop();
  });

  it("a store whose append keeps throwing does not log an error on every tick", async () => {
    const { logger, lines } = captureLogs();
    const inner = new InMemoryPowerHistoryStore();
    const broken: PowerHistoryStore = {
      append: () => {
        throw new Error("disk full");
      },
      reset: () => inner.reset(),
      window: (n) => inner.window(n),
    };
    const poller = new PowerHistoryPoller(okPorts(), broken, { logger });
    poller.start();
    await vi.advanceTimersByTimeAsync(3600 * 1000); // 720 ticks
    expect(lines.length).toBeLessThanOrEqual(5);
    // ... and it keeps polling (never crashes, never stalls)
    await poller.stop();
  });

  it("a poll that succeeds while stop() is in progress does not write to the store", async () => {
    const store = new InMemoryPowerHistoryStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const poller = new PowerHistoryPoller(
      {
        getServerStatus: async () => {
          await gate;
          return status();
        },
        getPowerCircuits: async () => [circuit(0)],
      },
      store,
      { logger: captureLogs().logger },
    );
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const stopping = poller.stop();
    release();
    await stopping;
    expect(store.window(T0 + 1000).series).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.window(T0 + 60_000).series).toEqual([]);
  });

  it("start() from inside a poll does not start a second loop", async () => {
    let polls = 0;
    let poller!: PowerHistoryPoller;
    poller = new PowerHistoryPoller(
      {
        getServerStatus: async () => {
          polls++;
          poller.start();
          return status();
        },
        getPowerCircuits: async () => [circuit(0)],
      },
      new InMemoryPowerHistoryStore(),
      { logger: captureLogs().logger },
    );
    poller.start();
    await vi.advanceTimersByTimeAsync(4 * INTERVAL_MS);
    expect(polls).toBe(5);
    await poller.stop();
  });

  it("its timer does not keep the process alive (unref'd) and stop() leaves none pending", async () => {
    const poller = new PowerHistoryPoller(okPorts(), new InMemoryPowerHistoryStore(), {
      logger: captureLogs().logger,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);
    await poller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
