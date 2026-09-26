import { describe, expect, it, vi } from "vitest";
import type { Factory, SnapshotRequest } from "@satisfactory-dash/shared";
import { agentSnapshotRequestFull, agentSnapshotRequestUnreachable, powerOk, statusRunning } from "@satisfactory-dash/shared/fixtures";
import { AgentIngest, AGENT_CLOCK_TOLERANCE_MS } from "./agentIngest.js";
import { LatestSnapshotStore } from "./agentSnapshotStore.js";
import { sessionKey } from "./historyRecorder.js";
import { InMemoryPowerHistoryStore } from "./powerHistoryStore.js";

import { snapshot } from "../../../platform/snapshot.js";

const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
/** What a route would put in the envelope for this reading. */
const observedStale = (data: unknown): boolean => snapshot("s", data).stale;
const T0 = Date.parse("2026-09-26T12:00:00.000Z");

const building = (id: string, state: string | undefined, extra: Partial<Factory["buildings"][number]> = {}): Factory["buildings"][number] => ({
  id,
  name: "Constructor",
  className: "Build_ConstructorMk1_C",
  recipe: "Iron Plate",
  isProducing: true,
  isPaused: false,
  isBackedUp: false,
  production: [{ name: "Iron Plate", className: "Desc_IronPlate_C", currentPerMinute: 20, maxPerMinute: 20, percent: 100 }],
  ingredients: [],
  ...(state !== undefined ? { state } : {}),
  ...extra,
});

const factoryOf = (buildings: Factory["buildings"]): Factory => ({ buildings, backedUpCount: 0 });

function setup(startMs = T0) {
  let nowMs = startMs;
  const now = () => nowMs;
  const store = new LatestSnapshotStore(() => CADENCE, now);
  const observations = {
    publishStatus: vi.fn(),
    publishPower: vi.fn(),
    publishFactory: vi.fn(),
    recordPollFailure: vi.fn(),
    recordPollSuccess: vi.fn(),
    recordAgentSeen: vi.fn(),
  };
  const history = { recordPower: vi.fn(), recordItems: vi.fn(), recordTransitions: vi.fn() };
  const powerStore = new InMemoryPowerHistoryStore({ intervalSeconds: 5 });
  const ingest = new AgentIngest({ store, cadence: () => CADENCE, observations, history, powerStore });
  return {
    store,
    observations,
    history,
    powerStore,
    ingest,
    advance: (ms: number) => {
      nowMs += ms;
    },
    now,
    /** A full running snapshot observed at the current fake time. */
    running: (overrides: Partial<SnapshotRequest> = {}): SnapshotRequest => ({
      ...agentSnapshotRequestFull,
      observedAt: new Date(nowMs).toISOString(),
      paused: false,
      status: { ...statusRunning.data, gamePaused: false },
      factory: factoryOf([building("a", "producing"), building("b", "underfed", { ingredients: [{ name: "Ore", className: "Desc_Ore_C", currentPerMinute: 5, maxPerMinute: 30, percent: 16 }, { name: "Coal", className: "Desc_Coal_C", currentPerMinute: 20, maxPerMinute: 30, percent: 66 }] })]),
      ...overrides,
    }),
  };
}

describe("a running snapshot", () => {
  it("feeds the observation board exactly as the pollers do", () => {
    const t = setup();
    t.ingest.ingest(t.running(), T0);
    expect(t.observations.recordPollSuccess).toHaveBeenCalledWith(T0);
    expect(t.observations.publishStatus).toHaveBeenCalledWith({ observedAt: T0, intervalMs: 5000, paused: false, session: statusRunning.data.sessionName });
    expect(t.observations.publishPower).toHaveBeenCalledWith({
      observedAt: T0,
      intervalMs: 5000,
      circuits: powerOk.data.circuits.map((c) => ({ circuit: c.circuitGroupId, status: c.status, fuseTripped: c.fuseTriggered })),
    });
    const factory = t.observations.publishFactory.mock.calls[0]![0] as {
      observedAt: number;
      intervalMs: number;
      afterResume: boolean;
      itemRates: Map<string, number>;
      machines: { id: string; state?: string; outputPercent?: number; missingInput?: string }[];
    };
    expect(factory.observedAt).toBe(T0);
    expect(factory.intervalMs).toBe(30_000);
    expect(factory.afterResume).toBe(false);
    expect(factory.itemRates.get("Desc_IronPlate_C")).toBe(40);
    expect(factory.machines.map((m) => [m.id, m.state, m.outputPercent])).toEqual([["a", "producing", 100], ["b", "underfed", 100]]);
    // The underfed machine's least-consumed ingredient is the one it lacks.
    expect(factory.machines.find((m) => m.id === "b")?.missingInput).toBe("Desc_Ore_C");
    expect(factory.machines.find((m) => m.id === "a")?.missingInput).toBeUndefined();
  });

  it("records durable history: power rows keyed by the session, item totals, and nothing yet for transitions (the first snapshot only baselines)", () => {
    const t = setup();
    t.ingest.ingest(t.running(), T0);
    const power = t.history.recordPower.mock.calls[0]![0] as { session: number; circuit: number; atMs: number }[];
    expect(power).toHaveLength(powerOk.data.circuits.length);
    expect(power[0]).toMatchObject({ session: sessionKey(statusRunning.data.sessionName), atMs: T0 });
    expect(t.history.recordItems).toHaveBeenCalledWith([{ item: "Desc_IronPlate_C", atMs: T0, currentPerMinute: 40, maxPerMinute: 40 }]);
    expect(t.history.recordTransitions).toHaveBeenCalledWith([]);
  });

  it("records a transition when a machine's state changes between two factory snapshots", () => {
    const t = setup();
    t.ingest.ingest(t.running(), T0);
    t.advance(30_000);
    t.ingest.ingest(t.running({ factory: factoryOf([building("a", "backedUp"), building("b", "underfed")]) }), T0 + 30_000);
    expect(t.history.recordTransitions).toHaveBeenLastCalledWith([
      { atMs: T0 + 30_000, buildingId: "a", className: "Build_ConstructorMk1_C", fromState: "producing", toState: "backedUp" },
    ]);
  });

  it("puts the power reading in the chart's memory, one sample per interval slot", () => {
    const t = setup();
    t.ingest.ingest(t.running(), T0);
    t.ingest.ingest(t.running(), T0 + 1000); // the same 5 s slot: not newer, ignored
    t.advance(5000);
    t.ingest.ingest(t.running(), T0 + 5000);
    const window = t.powerStore.window(T0 + 6000);
    expect(window.series[0]?.points.map((p) => p.t)).toEqual([T0, T0 + 5000]);
  });

  it("serves the reading back through the store with its own time", () => {
    const t = setup();
    t.ingest.ingest(t.running(), T0);
    expect(t.store.read("status")).toMatchObject({ sessionName: statusRunning.data.sessionName });
    expect(t.store.session()).toBe(statusRunning.data.sessionName);
  });
});

describe("a paused game", () => {
  it("publishes status (paused) but records no history and no factory reading, then flags the first factory reading after the resume", () => {
    const t = setup();
    t.ingest.ingest(t.running({ paused: true, status: { ...statusRunning.data, gamePaused: true } }), T0);
    expect(t.observations.publishStatus).toHaveBeenCalledWith(expect.objectContaining({ paused: true }));
    expect(t.observations.publishFactory).not.toHaveBeenCalled();
    expect(t.history.recordPower).not.toHaveBeenCalled();
    expect(t.history.recordItems).not.toHaveBeenCalled();
    expect(t.history.recordTransitions).not.toHaveBeenCalled();

    t.advance(30_000);
    t.ingest.ingest(t.running(), T0 + 30_000);
    expect(t.observations.publishFactory.mock.calls[0]![0]).toMatchObject({ afterResume: true });
    t.advance(30_000);
    t.ingest.ingest(t.running(), T0 + 60_000);
    expect(t.observations.publishFactory.mock.calls[1]![0]).toMatchObject({ afterResume: false });
  });

  it("an unknown pause state with no status to say is never treated as running", () => {
    const t = setup();
    const { status: _status, ...noStatus } = t.running({ paused: null });
    t.ingest.ingest(noStatus as SnapshotRequest, T0);
    expect(t.observations.publishFactory).not.toHaveBeenCalled();
    expect(t.history.recordPower).not.toHaveBeenCalled();
    expect(t.history.recordItems).not.toHaveBeenCalled();
    // The readings themselves are still observed: the alert engine reads them with their own times.
    expect(t.observations.publishPower).toHaveBeenCalled();
  });

  it("takes the pause state from the status part when the snapshot's own flag is null", () => {
    const t = setup();
    t.ingest.ingest(t.running({ paused: null }), T0);
    expect(t.history.recordItems).toHaveBeenCalled();
  });
});

describe("the agent's liveness (ADR-0031: 'agent offline' measures from it)", () => {
  it("every snapshot proves the agent is alive: a running one, and one that says the game is unreachable", () => {
    const t = setup();
    t.ingest.ingest(t.running(), T0);
    t.ingest.ingest({ ...agentSnapshotRequestUnreachable, observedAt: new Date(T0 + 5000).toISOString() }, T0 + 5000);
    expect(t.observations.recordAgentSeen.mock.calls).toEqual([[T0], [T0 + 5000]]);
  });

  it("is the arrival time, not the agent's own clock", () => {
    const t = setup();
    t.ingest.ingest(t.running({ observedAt: "1999-01-01T00:00:00.000Z" }), T0);
    expect(t.observations.recordAgentSeen).toHaveBeenCalledWith(T0);
  });
});

describe("an unreachable game", () => {
  it("counts as a failed poll and publishes nothing else", () => {
    const t = setup();
    t.ingest.ingest({ ...agentSnapshotRequestUnreachable, observedAt: new Date(T0).toISOString() }, T0);
    expect(t.observations.recordPollFailure).toHaveBeenCalledWith(T0);
    expect(t.observations.recordPollSuccess).not.toHaveBeenCalled();
    expect(t.observations.publishStatus).not.toHaveBeenCalled();
    expect(t.history.recordPower).not.toHaveBeenCalled();
  });

  it("makes every live read say so until a reachable snapshot arrives, and keeps no stale part alive", () => {
    const t = setup();
    t.ingest.ingest(t.running(), T0);
    t.advance(5000);
    t.ingest.ingest({ ...agentSnapshotRequestUnreachable, observedAt: new Date(t.now()).toISOString() }, t.now());
    expect(() => t.store.read("status")).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
    t.advance(5000);
    t.ingest.ingest(t.running(), t.now());
    expect(() => t.store.read("status")).not.toThrow();
  });
});

describe("the agent's clock", () => {
  it("is used when within a minute of the arrival time", () => {
    const t = setup();
    const skewed = T0 - AGENT_CLOCK_TOLERANCE_MS + 1;
    t.ingest.ingest(t.running({ observedAt: new Date(skewed).toISOString() }), T0);
    expect(t.observations.publishStatus).toHaveBeenCalledWith(expect.objectContaining({ observedAt: skewed }));
  });

  it("never puts a reading in the future: a clock running ahead cannot make an old reading look fresh for up to a minute", () => {
    const t = setup();
    const ahead = T0 + 50_000;
    t.ingest.ingest(t.running({ observedAt: new Date(ahead).toISOString() }), T0);
    expect(t.observations.publishStatus).toHaveBeenCalledWith(expect.objectContaining({ observedAt: T0 }));
    expect(t.history.recordItems).toHaveBeenCalledWith([expect.objectContaining({ atMs: T0 })]);
    t.advance(15_001);
    expect(observedStale(t.store.read("status"))).toBe(true);
  });

  it("is ignored when further off, so a wrong clock cannot back-date history or make old data look fresh", () => {
    for (const wrong of [T0 - AGENT_CLOCK_TOLERANCE_MS - 1, T0 + AGENT_CLOCK_TOLERANCE_MS + 1, Date.parse("1999-01-01T00:00:00Z")]) {
      const t = setup();
      t.ingest.ingest(t.running({ observedAt: new Date(wrong).toISOString() }), T0);
      expect(t.observations.publishStatus).toHaveBeenCalledWith(expect.objectContaining({ observedAt: T0 }));
      expect(t.history.recordItems).toHaveBeenCalledWith([expect.objectContaining({ atMs: T0 })]);
    }
  });
});

describe("a new game session", () => {
  it("clears the power chart's memory (a series never spans a session or the clock going backwards)", () => {
    const t = setup();
    t.ingest.ingest(t.running(), T0);
    t.advance(5000);
    t.ingest.ingest(t.running({ status: { ...statusRunning.data, gamePaused: false, sessionName: "Another save" } }), T0 + 5000);
    const times = t.powerStore.window(T0 + 6000).series[0]?.points.map((p) => p.t);
    expect(times).toEqual([T0 + 5000]);
  });
});

describe("an agent that sends faster than its cadence", () => {
  it("is served live but adds no more history than one reading per cadence (a leaked secret cannot inflate the database)", () => {
    const t = setup();
    for (let i = 0; i < 50; i++) t.ingest.ingest(t.running({ observedAt: new Date(T0 + i * 200).toISOString() }), T0 + i * 200);
    expect(t.history.recordItems).toHaveBeenCalledTimes(1);
    // Power: at most one reading per half interval (2.5 s) over these 10 s, not 50.
    expect(t.history.recordPower.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(t.history.recordPower.mock.calls.length).toBeLessThanOrEqual(4);
    expect(t.observations.publishFactory).toHaveBeenCalledTimes(1);
    // The next reading a whole cadence later is recorded again.
    t.advance(30_000);
    t.ingest.ingest(t.running(), T0 + 30_000);
    expect(t.history.recordItems).toHaveBeenCalledTimes(2);
  });

  it("does not let a late or retried snapshot put an older reading over a newer one", () => {
    const t = setup();
    const at = (ms: number) => new Date(T0 + ms).toISOString();
    const named = (sessionName: string) => ({ ...statusRunning.data, gamePaused: false, sessionName });
    t.ingest.ingest(t.running({ observedAt: at(10_000) }), T0 + 10_000);
    t.ingest.ingest(t.running({ observedAt: at(12_000), status: named("Old news") }), T0 + 12_000);
    t.ingest.ingest(t.running({ observedAt: at(11_000), status: named("Older") }), T0 + 13_000);
    // Observed at 11 s, after one observed at 12 s: it must not replace it.
    expect(t.store.session()).toBe("Old news");
  });
});

describe("the latest-snapshot store", () => {
  it("says the agent has not reported before the first snapshot", () => {
    const t = setup();
    expect(() => t.store.read("power")).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
  });

  it("is stale only after three of that part's own cadence intervals", () => {
    const t = setup();
    t.ingest.ingest(t.running(), T0);
    t.advance(15_000); // exactly 3 x 5 s: not yet stale for status and power
    expect(observedStale(t.store.read("status"))).toBe(false);
    expect(observedStale(t.store.read("factory"))).toBe(false);
    t.advance(1);
    expect(observedStale(t.store.read("status"))).toBe(true);
    expect(observedStale(t.store.read("power"))).toBe(true);
    expect(observedStale(t.store.read("factory"))).toBe(false); // 30 s cadence: stale after 90 s
    t.advance(75_000);
    expect(observedStale(t.store.read("factory"))).toBe(true);
  });

  it("keeps a part the latest snapshot did not carry, and answers 'no player list' for players that never came", () => {
    const t = setup();
    t.ingest.ingest(t.running({ factory: undefined, players: undefined }), T0);
    expect(() => t.store.read("factory")).toThrowError(expect.objectContaining({ code: "upstream_unreachable" }));
    expect(t.store.read("players", { available: false, players: [] })).toEqual({ available: false, players: [] });
  });
});
