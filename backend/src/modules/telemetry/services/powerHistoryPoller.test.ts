import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PowerCircuit, ServerStatus } from "../../gameserver/index.js";
import { createLogger } from "../../../platform/logger.js";
import { PowerHistoryPoller } from "./powerHistoryPoller.js";
import type { PowerHistoryPorts } from "./powerHistoryPoller.js";
import { InMemoryPowerHistoryStore } from "./powerHistoryStore.js";
import type { PowerHistoryStore } from "./powerHistoryStore.js";

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
const circuit = (id: number, production: number, over: Partial<PowerCircuit> = {}): PowerCircuit => ({
  circuitGroupId: id,
  powerProduction: production,
  powerConsumed: production - 10,
  powerCapacity: 100,
  maxPowerConsumed: 120,
  fuseTriggered: false,
  batteryPercent: 0,
  batteryDifferential: 0,
  batteryCapacity: 0,
  ...over,
});

/** Ports the test steers: change `state` between advances of the fake clock. */
function fakePorts() {
  const state = {
    status: status(),
    circuits: [circuit(0, 50)],
    failWith: undefined as unknown,
    failStatusOnly: false,
    delayMs: 0,
    polls: 0,
    concurrent: 0,
    maxConcurrent: 0,
  };
  const enter = async () => {
    state.concurrent++;
    state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
    try {
      if (state.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      }
    } finally {
      state.concurrent--;
    }
  };
  const ports: PowerHistoryPorts = {
    async getServerStatus() {
      state.polls++;
      await enter();
      if (state.failWith !== undefined && state.failStatusOnly === false) throw state.failWith;
      return state.status;
    },
    async getPowerCircuits() {
      if (state.failWith !== undefined) throw state.failWith;
      return state.circuits;
    },
  };
  return { ports, state };
}

function captureLogs() {
  const lines: { level: number; msg: string; [k: string]: unknown }[] = [];
  const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(JSON.parse(line)) });
  return { logger, lines };
}

const times = (store: PowerHistoryStore, nowMs: number, id = 0) =>
  store.window(nowMs).series.find((s) => s.circuitGroupId === id)?.points.map((p) => p.t) ?? [];

describe("PowerHistoryPoller (fake time)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(over: { store?: PowerHistoryStore } = {}) {
    const { ports, state } = fakePorts();
    const { logger, lines } = captureLogs();
    const store = over.store ?? new InMemoryPowerHistoryStore();
    const poller = new PowerHistoryPoller(ports, store, { logger });
    return { ports, state, lines, store, poller };
  }

  it("does nothing until it is started", async () => {
    const { state, store } = setup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.polls).toBe(0);
    expect(store.window(T0 + 60_000).series).toEqual([]);
  });

  it("polls straight away, then every interval, stamping each sample with its nominal time", async () => {
    const { poller, store, state } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.polls).toBe(1);
    await vi.advanceTimersByTimeAsync(4 * INTERVAL_MS);
    expect(state.polls).toBe(5);
    expect(times(store, T0 + 4 * INTERVAL_MS)).toEqual([0, 1, 2, 3, 4].map((n) => T0 + n * INTERVAL_MS));
    await poller.stop();
  });

  it("start() twice does not double the cadence", async () => {
    const { poller, state } = setup();
    poller.start();
    poller.start();
    await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);
    expect(state.polls).toBe(3);
    await poller.stop();
  });

  it("maps the game server's readings and the pause flag into the sample", async () => {
    const { poller, store, state } = setup();
    state.status = status({ isPaused: true });
    state.circuits = [circuit(3, 80, { powerConsumed: 60, powerCapacity: 90, batteryPercent: 12.5, fuseTriggered: true })];
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const history = store.window(T0);
    expect(history.series).toEqual([
      {
        circuitGroupId: 3,
        points: [{ t: T0, productionMW: 80, consumptionMW: 60, capacityMW: 90, batteryPercent: 12.5, fuseTriggered: true }],
      },
    ]);
    expect(history.pausedRanges).toEqual([{ fromT: T0, toT: T0 }]);
    await poller.stop();
  });

  describe("failures", () => {
    it("a failed poll leaves a gap, polling carries on, and only the first failure and the recovery are logged", async () => {
      const { poller, store, state, lines } = setup();
      poller.start();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS); // ticks 0 and 1 succeed
      state.failWith = new Error("FRM down");
      await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS); // ticks 2, 3, 4 fail
      state.failWith = undefined;
      await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS); // ticks 5 and 6 succeed
      expect(times(store, T0 + 6 * INTERVAL_MS)).toEqual([0, 1, 5, 6].map((n) => T0 + n * INTERVAL_MS));
      const warns = lines.filter((l) => l.level === 40);
      expect(warns).toHaveLength(1);
      expect(warns[0].msg).toMatch(/leaving a gap/);
      expect(lines.filter((l) => l.msg.includes("recovered"))).toEqual([expect.objectContaining({ failedPolls: 3 })]);
      await poller.stop();
    });

    it("if the game server is down from the start, nothing is stored and one warning is logged, however long it lasts", async () => {
      const { poller, store, state, lines } = setup();
      state.failWith = new Error("connect ECONNREFUSED");
      poller.start();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(store.window(T0 + 10 * 60_000).series).toEqual([]);
      expect(lines.filter((l) => l.level >= 40)).toHaveLength(1);
      await poller.stop();
    });

    it("the failure log carries the reason but nothing else from the error object", async () => {
      const { poller, state, lines } = setup();
      const err = Object.assign(new Error("boom"), { token: "secret-token-value", headers: { authorization: "Bearer x" } });
      state.failWith = err;
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      const text = JSON.stringify(lines);
      expect(text).toContain("boom");
      expect(text).not.toContain("secret-token-value");
      expect(text).not.toContain("Bearer");
      await poller.stop();
    });

    it("a port that throws synchronously, or rejects with a non-Error, is a gap and not a crash", async () => {
      const { store } = setup();
      const { logger } = captureLogs();
      let n = 0;
      const ports: PowerHistoryPorts = {
        getServerStatus: () => {
          n++;
          if (n === 1) throw new Error("sync throw");
          if (n === 2) return Promise.reject("just a string");
          return Promise.resolve(status());
        },
        getPowerCircuits: async () => [circuit(0, 1)],
      };
      const poller = new PowerHistoryPoller(ports, store, { logger });
      poller.start();
      await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);
      expect(times(store, T0 + 2 * INTERVAL_MS)).toEqual([T0 + 2 * INTERVAL_MS]);
      await poller.stop();
    });

    it("a store that throws is logged and the loop keeps going", async () => {
      const { logger, lines } = captureLogs();
      const real = new InMemoryPowerHistoryStore();
      let calls = 0;
      const flaky: PowerHistoryStore = {
        append: (sample) => {
          calls++;
          if (calls === 2) throw new Error("store exploded");
          return real.append(sample);
        },
        reset: () => real.reset(),
        window: (now) => real.window(now),
      };
      const { ports } = fakePorts();
      const poller = new PowerHistoryPoller(ports, flaky, { logger });
      poller.start();
      await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS);
      expect(calls).toBe(4);
      expect(times(real, T0 + 3 * INTERVAL_MS)).toEqual([0, 2, 3].map((n) => T0 + n * INTERVAL_MS));
      expect(lines.some((l) => l.level === 50 && /crashed unexpectedly/.test(l.msg))).toBe(true);
      await poller.stop();
    });
  });

  describe("timing", () => {
    it("never runs two polls at once: a slow poll delays the next one", async () => {
      const { poller, state } = setup();
      state.delayMs = 12_000; // longer than two intervals
      poller.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(state.maxConcurrent).toBe(1);
      expect(state.polls).toBeGreaterThan(3); // it did keep polling
      // A poll is in flight on a fake timer: stop() waits for it, so let time pass meanwhile.
      const stopping = poller.stop();
      await vi.advanceTimersByTimeAsync(12_000);
      await stopping;
    });

    it("after a slow poll it skips the missed ticks instead of firing them back to back", async () => {
      const { poller, store, state } = setup();
      state.delayMs = 12_000;
      poller.start();
      await vi.advanceTimersByTimeAsync(12_000); // first poll (t=0) finishes at 12 s
      state.delayMs = 0;
      await vi.advanceTimersByTimeAsync(10_000);
      const points = times(store, T0 + 22_000);
      // t=0 (slow poll), then resynchronised at the moment it finished: 12 s, 17 s, 22 s.
      expect(points).toEqual([T0, T0 + 12_000, T0 + 17_000, T0 + 22_000]);
      await poller.stop();
    });

    it("if the wall clock steps back an hour, it restarts its cadence instead of sleeping for an hour", async () => {
      const { poller, store, state } = setup();
      poller.start();
      await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);
      const pollsBefore = state.polls;
      vi.setSystemTime(T0 + 2 * INTERVAL_MS - 3_600_000); // an hour back
      await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS);
      expect(state.polls).toBeGreaterThanOrEqual(pollsBefore + 3);
      const now = Date.now();
      const points = times(store, now);
      expect(points.length).toBeGreaterThan(0);
      expect(points.every((t) => t <= now)).toBe(true);
      // Strictly ascending even across the step (the store restarted its history).
      for (let i = 1; i < points.length; i++) expect(points[i]).toBeGreaterThan(points[i - 1]);
      await poller.stop();
    });

    it("if the wall clock steps back a little, the history converges: ascending points, none from the future", async () => {
      const { poller, store, state } = setup();
      poller.start();
      await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS); // samples at 0, 5, 10, 15 s
      vi.setSystemTime(Date.now() - 2 * INTERVAL_MS); // ten seconds back
      const pollsBefore = state.polls;
      await vi.advanceTimersByTimeAsync(8 * INTERVAL_MS);
      expect(state.polls).toBeGreaterThanOrEqual(pollsBefore + 7); // it kept its cadence
      const now = Date.now();
      const points = times(store, now);
      expect(points.length).toBeGreaterThanOrEqual(3);
      expect(points.every((t) => t <= now)).toBe(true);
      for (let i = 1; i < points.length; i++) expect(points[i]).toBeGreaterThan(points[i - 1]);
      await poller.stop();
    });
  });

  describe("reset rule (ADR-0022)", () => {
    it("clears the history when the game session changes", async () => {
      const { poller, store, state, lines } = setup();
      poller.start();
      await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS); // three samples in session A
      state.status = status({ sessionName: "Session B" });
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(times(store, T0 + 3 * INTERVAL_MS)).toEqual([T0 + 3 * INTERVAL_MS]);
      expect(lines.some((l) => /clearing power history/.test(l.msg))).toBe(true);
      await poller.stop();
    });

    it("clears the history when the game clock goes backwards (a reload of an older save)", async () => {
      const { poller, store, state } = setup();
      poller.start();
      await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);
      state.status = status({ totalGameDurationSeconds: 400 }); // was 1000
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(times(store, T0 + 3 * INTERVAL_MS)).toEqual([T0 + 3 * INTERVAL_MS]);
      await poller.stop();
    });

    it("keeps the history while the game clock stands still (paused) or moves forward", async () => {
      const { poller, store, state } = setup();
      poller.start();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      state.status = status({ totalGameDurationSeconds: 1000, isPaused: true }); // same clock, paused
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      state.status = status({ totalGameDurationSeconds: 1010 });
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(times(store, T0 + 3 * INTERVAL_MS)).toHaveLength(4);
      await poller.stop();
    });

    it("does not reset on the very first poll", async () => {
      const { poller, store } = setup();
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(times(store, T0)).toEqual([T0]);
      await poller.stop();
    });

    it("a failed poll between two polls of the same session does not reset the history", async () => {
      const { poller, store, state } = setup();
      poller.start();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      state.failWith = new Error("down");
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      state.failWith = undefined;
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(times(store, T0 + 3 * INTERVAL_MS)).toEqual([0, 1, 3].map((n) => T0 + n * INTERVAL_MS));
      await poller.stop();
    });
  });

  describe("health, for the stale flag", () => {
    it("reports when it started and when it last succeeded", async () => {
      const { poller, state } = setup();
      expect(poller.startedAt()).toBeUndefined();
      expect(poller.lastSuccessAt()).toBeUndefined();
      poller.start();
      expect(poller.startedAt()).toBe(T0);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(poller.lastSuccessAt()).toBe(T0 + INTERVAL_MS);
      state.failWith = new Error("down");
      await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS);
      expect(poller.lastSuccessAt()).toBe(T0 + INTERVAL_MS); // failures don't move it
      await poller.stop();
    });
  });

  describe("stop()", () => {
    it("schedules nothing more", async () => {
      const { poller, state } = setup();
      poller.start();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await poller.stop();
      const polls = state.polls;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(state.polls).toBe(polls);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("waits for a poll in flight, and that poll's result is not stored", async () => {
      const { poller, store, state } = setup();
      state.delayMs = 3000;
      poller.start();
      await vi.advanceTimersByTimeAsync(1000); // the first poll is mid-flight
      let stopped = false;
      const stopping = poller.stop().then(() => {
        stopped = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(stopped).toBe(false); // still waiting for the poll
      await vi.advanceTimersByTimeAsync(3000);
      await stopping;
      expect(stopped).toBe(true);
      expect(store.window(T0 + 10_000).series).toEqual([]);
    });

    it("stopping a poller that never started, or stopping twice, is fine", async () => {
      const { poller } = setup();
      await poller.stop();
      poller.start();
      await poller.stop();
      await poller.stop();
    });
  });
});
