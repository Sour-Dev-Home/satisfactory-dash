import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { FactoryBuilding } from "../../gameserver/index.js";
import { diffStates, FactoryHistoryPoller, MAX_TRANSITIONS_PER_POLL, sumItemRates } from "./factoryHistoryPoller.js";
import type { HistoryRecorder } from "./historyRecorder.js";

const rate = (className: string, current: number, max = 100) => ({
  name: className,
  className,
  currentPerMinute: current,
  maxPerMinute: max,
  percent: (current / max) * 100,
});

function building(id: string, overrides: Partial<FactoryBuilding> = {}): FactoryBuilding {
  return {
    id,
    name: id,
    className: "Build_Constructor_C",
    recipe: "Concrete",
    isProducing: true,
    isPaused: false,
    production: [rate("Desc_Cement_C", 100)],
    consumption: [rate("Desc_Stone_C", 100)],
    outputInventory: [],
    circuitGroupId: 0,
    powerConsumed: 4,
    maxPowerConsumed: 4,
    fuseTriggered: false,
    ...overrides,
  };
}

const stalled = (id: string) => building(id, { production: [rate("Desc_Cement_C", 0)] });

describe("sumItemRates", () => {
  it("sums each item across buildings", () => {
    const rows = sumItemRates(
      [building("a", { production: [rate("X", 10, 20), rate("Y", 1, 2)] }), building("b", { production: [rate("X", 5, 20)] })],
      1000,
    );
    expect(rows).toEqual([
      { item: "X", atMs: 1000, currentPerMinute: 15, maxPerMinute: 40 },
      { item: "Y", atMs: 1000, currentPerMinute: 1, maxPerMinute: 2 },
    ]);
  });

  it("returns nothing for no buildings", () => {
    expect(sumItemRates([], 1)).toEqual([]);
  });
});

describe("diffStates", () => {
  const ids = (n: number, make: (id: string) => FactoryBuilding) => Array.from({ length: n }, (_, i) => make(`b${i}`));

  it("only sets the baseline on the first snapshot", () => {
    const known = new Map<string, string>();
    expect(diffStates(known, ids(4, building), 1)).toEqual([]);
    expect(known.size).toBe(4);
  });

  it("emits a transition when a state changes, with the previous state", () => {
    const known = new Map<string, string>();
    diffStates(known, ids(4, building), 1);
    const next = [building("b0"), building("b1"), building("b2"), stalled("b3")];
    expect(diffStates(known, next, 2)).toEqual([
      { atMs: 2, buildingId: "b3", className: "Build_Constructor_C", fromState: "producing", toState: "starved" },
    ]);
    expect(diffStates(known, next, 3)).toEqual([]); // unchanged: no repeat
  });

  it("re-baselines without transitions when most ids are new", () => {
    const known = new Map<string, string>();
    diffStates(known, ids(4, building), 1);
    const other = Array.from({ length: 4 }, (_, i) => stalled(`n${i}`));
    expect(diffStates(known, other, 2)).toEqual([]);
    expect([...known.keys()].sort()).toEqual(["n0", "n1", "n2", "n3"]);
  });

  it("holds the last state of a building whose state cannot be decided", () => {
    const known = new Map<string, string>();
    diffStates(known, ids(4, building), 1);
    const unknown = building("b0", { fuseTriggered: undefined });
    expect(diffStates(known, [unknown, building("b1"), building("b2"), building("b3")], 2)).toEqual([]);
    expect(known.get("b0")).toBe("producing");
  });

  it("forgets removed buildings and reports a rebuilt one as new", () => {
    const known = new Map<string, string>();
    diffStates(known, ids(4, building), 1);
    diffStates(known, ids(3, building), 2);
    expect(known.has("b3")).toBe(false);
    const back = diffStates(known, ids(4, building), 3);
    expect(back).toEqual([
      { atMs: 3, buildingId: "b3", className: "Build_Constructor_C", fromState: null, toState: "producing" },
    ]);
  });

  it("caps the transitions of one poll", () => {
    const known = new Map<string, string>();
    const many = 2 * MAX_TRANSITIONS_PER_POLL;
    diffStates(known, ids(many, building), 1);
    expect(diffStates(known, ids(many, stalled), 2)).toHaveLength(MAX_TRANSITIONS_PER_POLL);
  });
});

describe("FactoryHistoryPoller.poll", () => {
  const logger = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) as unknown as Logger & { warn: ReturnType<typeof vi.fn> };
  const recorder = () => ({ recordPower: vi.fn(), recordItems: vi.fn(), recordTransitions: vi.fn() }) satisfies HistoryRecorder;

  it("records items and transitions, and stamps them with the poll time", async () => {
    const history = recorder();
    const responses = [ids(3), [building("b0"), building("b1"), stalled("b2")]];
    function ids(n: number) {
      return Array.from({ length: n }, (_, i) => building(`b${i}`));
    }
    const poller = new FactoryHistoryPoller(
      { getFactoryBuildings: async () => responses.shift() ?? [] },
      { logger: logger(), history, now: () => 5000 },
    );
    await poller.poll();
    await poller.poll();
    expect(history.recordItems).toHaveBeenCalledTimes(2);
    expect(history.recordTransitions).toHaveBeenLastCalledWith([
      { atMs: 5000, buildingId: "b2", className: "Build_Constructor_C", fromState: "producing", toState: "starved" },
    ]);
  });

  it("logs the first failure only, records nothing, and does not throw", async () => {
    const history = recorder();
    const log = logger();
    const poller = new FactoryHistoryPoller(
      { getFactoryBuildings: async () => Promise.reject(new Error("offline")) },
      { logger: log, history },
    );
    await expect(poller.poll()).resolves.toBeUndefined();
    await poller.poll();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(history.recordItems).not.toHaveBeenCalled();
  });

  it("abandons a poll that stalls past its deadline", async () => {
    const history = recorder();
    const log = logger();
    const poller = new FactoryHistoryPoller(
      { getFactoryBuildings: () => new Promise<FactoryBuilding[]>(() => {}) },
      { logger: log, history, pollTimeoutMs: 20 },
    );
    await poller.poll();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
