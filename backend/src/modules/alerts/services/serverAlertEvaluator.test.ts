import { describe, expect, it } from "vitest";
import type { MachineObservation, ObservationSnapshot, PowerCircuitObservation } from "../../telemetry/index.js";
import type { AlertState } from "./alertStateMachine.js";
import { ServerAlertEvaluator, stateKey, type AlertEventOut } from "./serverAlertEvaluator.js";
import type { Rule } from "./rules.js";

const SEC = 1000;
const MIN = 60 * SEC;
const T0 = 1_800_000_000_000;

const rule = <K extends Rule["kind"]>(kind: K, overrides: Partial<Rule> = {}, params: Record<string, unknown> = {}): Rule =>
  ({
    id: `rule-${kind}`,
    serverPublicId: "alpha",
    kind,
    params,
    forSeconds: 0,
    clearSeconds: 60,
    repeatSeconds: 3600,
    severity: "warning",
    ...overrides,
  }) as Rule;

const powerOutage = rule("power_outage", { severity: "critical" });
const fuseTrip = rule("fuse_trip");
const stopped = rule("stopped_machines", { forSeconds: 300, clearSeconds: 120 }, { stoppedBelowPercent: 5 });
const unreachable = rule("server_unreachable", { severity: "critical" }, { failedPolls: 3, minSeconds: 120 });

const circuit = (id: number, status: PowerCircuitObservation["status"] = "ok", fuseTripped = status === "outage"): PowerCircuitObservation => ({
  circuit: id,
  status,
  fuseTripped,
});
const machine = (id: string, state: string | undefined, outputPercent: number | undefined, recipe: string | null = "Iron Plate"): MachineObservation => ({
  id,
  className: "Build_ConstructorMk1_C",
  recipe,
  state,
  outputPercent,
});
const stoppedMachine = (id: string, recipe: string | null = "Iron Plate") => machine(id, "underfed", 0, recipe);
const okMachine = (id: string) => machine(id, "producing", 100);

interface World {
  paused?: boolean;
  circuits?: PowerCircuitObservation[];
  machines?: MachineObservation[];
  afterResume?: boolean;
  failures?: number;
  firstFailureAt?: number;
  /** Age of each reading in ms, default 0 (fresh). */
  powerAge?: number;
  factoryAge?: number;
  statusAge?: number;
  noSuccessYet?: boolean;
}

/** A snapshot at `now` as the pollers would have left it (power every 5 s, factory every 30 s). */
function snapshot(now: number, world: World): ObservationSnapshot {
  const failing = (world.failures ?? 0) > 0;
  return {
    session: "Session A",
    status: { observedAt: now - (world.statusAge ?? 0), intervalMs: 5 * SEC, paused: world.paused ?? false },
    power: { observedAt: now - (world.powerAge ?? 0), intervalMs: 5 * SEC, circuits: world.circuits ?? [circuit(1)] },
    factory: { observedAt: now - (world.factoryAge ?? 0), intervalMs: 30 * SEC, afterResume: world.afterResume ?? false, machines: world.machines ?? [] },
    polls: {
      consecutiveFailures: world.failures ?? 0,
      firstFailureAt: failing ? (world.firstFailureAt ?? now) : undefined,
      lastSuccessAt: world.noSuccessYet ? undefined : now,
    },
  };
}

/** Applies each evaluation like the worker does: store writes, then commit. Keeps the persisted states in a map. */
class Sim {
  states = new Map<string, AlertState>();
  evaluator = new ServerAlertEvaluator();
  constructor(public rules: Rule[]) {}
  at(minutes: number, world: World, options: { commit?: boolean; muted?: boolean } = {}): AlertEventOut[] {
    const now = T0 + minutes * MIN;
    const evaluation = this.evaluator.evaluate({
      now,
      observations: snapshot(now, world),
      rules: this.rules,
      states: this.states,
      muted: options.muted ?? false,
    });
    if (options.commit !== false) {
      for (const write of evaluation.writes) this.states.set(stateKey(write.ruleId, write.subject), write.state);
      evaluation.commit();
    }
    return evaluation.events;
  }
  restart(): void {
    this.evaluator = new ServerAlertEvaluator(); // the persisted states stay, the in-memory parts are gone
  }
  phase(rule: Rule, subject: string) {
    return this.states.get(stateKey(rule.id, subject))?.phase ?? "ok";
  }
}

const transitions = (events: AlertEventOut[]) => events.map((event) => `${event.subject}:${event.transition}`);

describe("power_outage (per circuit, edge-triggered)", () => {
  it("fires on the first outage reading, names the circuit, and resolves after the clear duration", () => {
    const sim = new Sim([powerOutage]);
    expect(sim.at(0, { circuits: [circuit(1), circuit(2)] })).toEqual([]);
    const fired = sim.at(0.5, { circuits: [circuit(1, "outage"), circuit(2)] });
    expect(fired).toEqual([
      { ruleId: powerOutage.id, kind: "power_outage", severity: "critical", subject: "circuit:1", transition: "fired", summary: { circuit: 1 } },
    ]);
    expect(sim.at(1, { circuits: [circuit(1, "outage"), circuit(2)] })).toEqual([]); // still firing, not renotified
    expect(sim.at(1.5, { circuits: [circuit(1), circuit(2)] })).toEqual([]); // clearing
    expect(transitions(sim.at(2.6, { circuits: [circuit(1), circuit(2)] }))).toEqual(["circuit:1:resolved"]);
  });

  it("each circuit has its own alert", () => {
    const sim = new Sim([powerOutage]);
    expect(transitions(sim.at(0, { circuits: [circuit(1, "outage"), circuit(2, "outage")] }))).toEqual(["circuit:1:fired", "circuit:2:fired"]);
  });

  it("a stale power reading is unknown: a firing alert is held, never resolved by silence", () => {
    const sim = new Sim([powerOutage]);
    sim.at(0, { circuits: [circuit(1, "outage")] });
    expect(sim.at(10, { circuits: [circuit(1)], powerAge: 30 * SEC, statusAge: 0 })).toEqual([]);
    expect(sim.phase(powerOutage, "circuit:1")).toBe("firing");
  });

  it("a circuit missing from a FRESH reading is gone (a new game session) and clears", () => {
    const sim = new Sim([powerOutage]);
    sim.at(0, { circuits: [circuit(7, "outage")] });
    sim.at(1, { circuits: [circuit(1)] });
    expect(transitions(sim.at(2.1, { circuits: [circuit(1)] }))).toEqual(["circuit:7:resolved"]);
  });

  it("re-notifies at most once per repeat interval", () => {
    const sim = new Sim([powerOutage]);
    sim.at(0, { circuits: [circuit(1, "outage")] });
    const all: string[] = [];
    for (let m = 1; m <= 125; m++) all.push(...transitions(sim.at(m, { circuits: [circuit(1, "outage")] })));
    expect(all).toEqual(["circuit:1:renotify", "circuit:1:renotify"]);
  });
});

describe("fuse_trip", () => {
  it("fires on a tripped fuse (not on the status), per circuit", () => {
    const sim = new Sim([fuseTrip]);
    expect(sim.at(0, { circuits: [circuit(1, "at_risk", false)] })).toEqual([]);
    expect(transitions(sim.at(1, { circuits: [circuit(1, "outage", true)] }))).toEqual(["circuit:1:fired"]);
  });
});

describe("server_unreachable", () => {
  it("fires after 3 failed polls AND 2 minutes, not before either", () => {
    const sim = new Sim([unreachable]);
    expect(sim.at(0, { failures: 1, firstFailureAt: T0 })).toEqual([]);
    expect(sim.at(1, { failures: 12, firstFailureAt: T0 })).toEqual([]); // many polls, under 2 minutes
    expect(sim.at(1.5, { failures: 2, firstFailureAt: T0 - 5 * MIN })).toEqual([]); // long, but only 2 polls
    const fired = sim.at(2, { failures: 24, firstFailureAt: T0 });
    expect(fired).toMatchObject([{ kind: "server_unreachable", subject: "server", transition: "fired", severity: "critical" }]);
    expect(fired[0]!.summary).toEqual({ failedPolls: 24, downForSeconds: 120 });
  });

  it("resolves after it answers again for the clear duration", () => {
    const sim = new Sim([unreachable]);
    sim.at(0, { failures: 1, firstFailureAt: T0 });
    sim.at(2, { failures: 30, firstFailureAt: T0 });
    expect(sim.at(2.5, {})).toEqual([]);
    expect(transitions(sim.at(3.6, {}))).toEqual(["server:resolved"]);
  });

  it("is not raised by a paused game (auto-pause is not unreachable)", () => {
    const sim = new Sim([unreachable]);
    expect(sim.at(0, { paused: true })).toEqual([]);
    expect(sim.at(60, { paused: true })).toEqual([]);
    expect(sim.phase(unreachable, "server")).toBe("ok");
  });

  it("does nothing without any data (a fresh start): unknown holds ok", () => {
    const sim = new Sim([unreachable]);
    expect(sim.at(0, { noSuccessYet: true, statusAge: 10 * MIN })).toEqual([]);
  });
});

describe("suppression", () => {
  it("while the game is paused nothing but server_unreachable is evaluated; a pending run is dropped on resume", () => {
    const sim = new Sim([stopped]);
    sim.at(0, { machines: [stoppedMachine("m1")], factoryAge: 0 });
    expect(sim.at(3, { machines: [stoppedMachine("m1")] })).toEqual([]);
    sim.at(4, { paused: true, machines: [stoppedMachine("m1")] });
    sim.at(30, { paused: true, machines: [stoppedMachine("m1")] });
    // Resumed: the first snapshot after a pause is unknown; then the run must start again from zero.
    expect(sim.at(31, { machines: [stoppedMachine("m1")], afterResume: true })).toEqual([]);
    expect(sim.at(32, { machines: [stoppedMachine("m1")] })).toEqual([]);
    expect(sim.at(36, { machines: [stoppedMachine("m1")] })).toEqual([]); // 4 minutes into the new run
    expect(transitions(sim.at(37, { machines: [stoppedMachine("m1")] }))).toEqual(["group:fired"]);
  });

  it("a firing alert stays firing through a pause (silence is not a resolve) and a gap does not count as clearing", () => {
    const sim = new Sim([powerOutage]);
    sim.at(0, { circuits: [circuit(1, "outage")] });
    sim.at(1, { paused: true, circuits: [circuit(1)] });
    sim.at(60, { paused: true, circuits: [circuit(1)] });
    expect(sim.phase(powerOutage, "circuit:1")).toBe("firing");
    expect(sim.at(61, { circuits: [circuit(1)] })).toEqual([]); // the clear run starts now, not an hour ago
    expect(transitions(sim.at(62.1, { circuits: [circuit(1)] }))).toEqual(["circuit:1:resolved"]);
  });

  it("an unreachable server suppresses the power and machine rules and speaks once", () => {
    const sim = new Sim([powerOutage, stopped, unreachable]);
    const events = sim.at(5, { failures: 40, firstFailureAt: T0, circuits: [circuit(1, "outage")], machines: [stoppedMachine("m1")] });
    expect(transitions(events)).toEqual(["server:fired"]);
  });

  it("a muted server evaluates nothing at all", () => {
    const sim = new Sim([powerOutage, unreachable]);
    expect(sim.at(0, { circuits: [circuit(1, "outage")], failures: 40, firstFailureAt: T0 - 10 * MIN }, { muted: true })).toEqual([]);
    expect(sim.states.size).toBe(0);
  });
});

describe("stopped_machines (grouped)", () => {
  const run = (sim: Sim, from: number, to: number, world: World, step = 0.5) => {
    const out: string[] = [];
    for (let m = from; m <= to; m += step) out.push(...transitions(sim.at(m, world)));
    return out;
  };

  it("fires ONE group alert after the machines were stopped for `for`, summarising the recipes", () => {
    const sim = new Sim([stopped]);
    const world = { machines: [stoppedMachine("a"), stoppedMachine("b"), stoppedMachine("c", "Wire"), okMachine("d")] };
    expect(run(sim, 0, 4.5, world)).toEqual([]);
    const events = sim.at(5, world);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subject: "group", transition: "fired", kind: "stopped_machines", severity: "warning" });
    expect(events[0]!.summary).toEqual({
      machines: 3,
      byRecipe: [{ recipe: "Iron Plate", count: 2 }, { recipe: "Wire", count: 1 }],
      byReason: [{ reason: "input short", count: 3 }], // no ingredient data in this fixture
    });
  });

  it("only underfed or backedUp machines below the percent count: slow, intermittently full, idle, paused, unpowered and producing ones do not", () => {
    const sim = new Sim([stopped]);
    const world = {
      machines: [
        machine("slow", "underfed", 40),
        machine("half-full", "backedUp", 50), // intermittently full: not stopped
        machine("idle", "idle", 0),
        machine("dead", "unpowered", 0),
        machine("held", "paused", 0),
        machine("edge", "underfed", 5), // exactly the threshold: not below it
        machine("edge-full", "backedUp", 5),
        okMachine("fine"),
      ],
    };
    expect(run(sim, 0, 30, world)).toEqual([]);
  });

  it("a backedUp machine at about 0% is stopped too (the most common real case): it fires after `for`", () => {
    const sim = new Sim([stopped]);
    const world = { machines: [machine("full", "backedUp", 0)] };
    expect(run(sim, 0, 4.5, world)).toEqual([]);
    const events = sim.at(5, world);
    expect(transitions(events)).toEqual(["group:fired"]);
    expect(events[0]!.summary).toMatchObject({ machines: 1, byReason: [{ reason: "output full", count: 1 }] });
  });

  it("a backedUp machine at 50% does not qualify, even after a long time", () => {
    const sim = new Sim([stopped]);
    expect(run(sim, 0, 60, { machines: [machine("half", "backedUp", 50)] }, 1)).toEqual([]);
  });

  it("one group message carries both reasons, counted, with the ingredient an underfed machine is short of", () => {
    const sim = new Sim([stopped]);
    const world = {
      machines: [
        { ...machine("a", "underfed", 0), missingInput: "Desc_Screw_C" },
        { ...machine("b", "underfed", 0), missingInput: "Desc_Screw_C" },
        { ...machine("c", "underfed", 0), missingInput: "Desc_Wire_C" },
        machine("d", "underfed", 0), // no ingredient data
        machine("e", "backedUp", 0),
        machine("f", "backedUp", 1),
      ],
    };
    run(sim, 0, 4.5, world);
    const events = sim.at(5, world);
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toMatchObject({
      machines: 6,
      byReason: [
        { reason: "input short: Desc_Screw_C", count: 2 },
        { reason: "output full", count: 2 },
        { reason: "input short", count: 1 },
        { reason: "input short: Desc_Wire_C", count: 1 },
      ],
    });
  });

  it("a machine that goes from underfed to backedUp at 0% keeps qualifying without restarting its timer", () => {
    const sim = new Sim([stopped]);
    run(sim, 0, 3, { machines: [machine("a", "underfed", 0)] });
    expect(transitions(sim.at(5, { machines: [machine("a", "backedUp", 0)] }))).toEqual(["group:fired"]);
  });

  it("a machine that recovers before `for` never counts", () => {
    const sim = new Sim([stopped]);
    run(sim, 0, 4, { machines: [stoppedMachine("a")] });
    run(sim, 4.5, 6, { machines: [okMachine("a")] });
    expect(run(sim, 6.5, 10, { machines: [stoppedMachine("a")] })).toEqual([]); // the run restarted at 6.5
    expect(transitions(sim.at(11.5, { machines: [stoppedMachine("a")] }))).toEqual(["group:fired"]);
  });

  it("an underfed or backedUp machine with no output percent is unknown: it holds its run, it does not end it", () => {
    for (const state of ["underfed", "backedUp"]) {
      const sim = new Sim([stopped]);
      run(sim, 0, 3, { machines: [machine("a", state, 0)] });
      run(sim, 3.5, 4.5, { machines: [machine("a", state, undefined)] });
      expect(transitions(sim.at(5, { machines: [machine("a", state, 0)] }))).toEqual(["group:fired"]);
    }
  });

  it("an undecidable machine (no state) holds its last condition instead of breaking the run", () => {
    const sim = new Sim([stopped]);
    run(sim, 0, 3, { machines: [stoppedMachine("a")] });
    run(sim, 3.5, 4.5, { machines: [machine("a", undefined, undefined)] });
    expect(transitions(sim.at(5, { machines: [machine("a", undefined, undefined)] }))).toEqual(["group:fired"]);
  });

  it("resolves once no machine has qualified for the clear duration, and re-notifies hourly with the current summary", () => {
    const sim = new Sim([stopped]);
    sim.at(0, { machines: [stoppedMachine("a")] });
    sim.at(5, { machines: [stoppedMachine("a")] });
    expect(sim.phase(stopped, "group")).toBe("firing");
    const later = run(sim, 6, 66, { machines: [stoppedMachine("a")] }, 1);
    expect(later).toEqual(["group:renotify"]);
    sim.at(67, { machines: [okMachine("a")] });
    expect(sim.at(68, { machines: [okMachine("a")] })).toEqual([]);
    expect(transitions(sim.at(69.1, { machines: [okMachine("a")] }))).toEqual(["group:resolved"]);
  });

  it("announces NEW machines joining a firing group as `updated`, at most once per 10 minutes", () => {
    const sim = new Sim([stopped]);
    const one = { machines: [stoppedMachine("a"), okMachine("b")] };
    sim.at(0, one);
    sim.at(5, one); // fired
    const two = { machines: [stoppedMachine("a"), stoppedMachine("b")] };
    // b starts being stopped at minute 6: qualifies at 11; the last notification was at 5, so 10 minutes have not passed yet
    for (let m = 6; m <= 11; m += 1) expect(sim.at(m, two)).toEqual([]);
    expect(sim.at(12, two)).toEqual([]); // 7 minutes since the notification
    const events = sim.at(15.5, two);
    expect(transitions(events)).toEqual(["group:updated"]);
    expect(events[0]!.summary).toMatchObject({ machines: 2, newMachines: 1 });
    // Not announced again for the same machines.
    expect(run(sim, 16, 40, two, 1)).toEqual([]);
  });

  it("the first factory snapshot after a pause is unknown: it neither starts a run nor ends one", () => {
    const sim = new Sim([stopped]);
    sim.at(0, { machines: [stoppedMachine("a")] });
    sim.at(5, { machines: [stoppedMachine("a")] }); // fired
    sim.at(6, { paused: true, machines: [stoppedMachine("a")] });
    // Frozen (or just recovered) values on resume must not resolve anything.
    expect(sim.at(7, { machines: [okMachine("a")], afterResume: true })).toEqual([]);
    expect(sim.phase(stopped, "group")).toBe("firing");
  });

  it("a stale factory reading is unknown: the group holds", () => {
    const sim = new Sim([stopped]);
    sim.at(0, { machines: [stoppedMachine("a")] });
    sim.at(5, { machines: [stoppedMachine("a")] });
    expect(run(sim, 6, 20, { machines: [okMachine("a")], factoryAge: 5 * MIN })).toEqual([]);
    expect(sim.phase(stopped, "group")).toBe("firing");
  });

  it("after a restart a firing group adopts the machines stopped right now: no resolve, no second `fired`, no `updated`", () => {
    const sim = new Sim([stopped]);
    const world = { machines: [stoppedMachine("a"), stoppedMachine("b")] };
    sim.at(0, world);
    sim.at(5, world); // fired, told about a and b
    sim.restart(); // the machine timers and the told-set are gone; the persisted group state stays
    const out: string[] = [];
    for (let m = 6; m <= 30; m += 1) out.push(...transitions(sim.at(m, world)));
    expect(out).toEqual([]);
    expect(sim.phase(stopped, "group")).toBe("firing");
    // It still resolves normally afterwards.
    sim.at(31, { machines: [okMachine("a"), okMachine("b")] });
    expect(transitions(sim.at(33.1, { machines: [okMachine("a"), okMachine("b")] }))).toEqual(["group:resolved"]);
  });

  it("a restart while pending only delays the alert by up to `for` (timers are in memory)", () => {
    const sim = new Sim([stopped]);
    sim.at(0, { machines: [stoppedMachine("a")] });
    sim.at(4, { machines: [stoppedMachine("a")] });
    sim.restart();
    expect(sim.at(5, { machines: [stoppedMachine("a")] })).toEqual([]);
    expect(transitions(sim.at(10, { machines: [stoppedMachine("a")] }))).toEqual(["group:fired"]);
  });

  it("a machine that disappears (destroyed) no longer qualifies", () => {
    const sim = new Sim([stopped]);
    sim.at(0, { machines: [stoppedMachine("a")] });
    sim.at(5, { machines: [stoppedMachine("a")] });
    sim.at(6, { machines: [] });
    expect(transitions(sim.at(8.1, { machines: [] }))).toEqual(["group:resolved"]);
  });
});

describe("commit semantics", () => {
  it("an evaluation that is not committed changes nothing: the next tick reproduces the same event", () => {
    const sim = new Sim([powerOutage]);
    const first = sim.at(0, { circuits: [circuit(1, "outage")] }, { commit: false });
    const second = sim.at(0.1, { circuits: [circuit(1, "outage")] }, { commit: false });
    expect(transitions(first)).toEqual(["circuit:1:fired"]);
    expect(transitions(second)).toEqual(["circuit:1:fired"]);
    expect(sim.states.size).toBe(0);
    expect(transitions(sim.at(0.2, { circuits: [circuit(1, "outage")] }))).toEqual(["circuit:1:fired"]);
    expect(sim.at(0.3, { circuits: [circuit(1, "outage")] })).toEqual([]);
  });

  it("an uncommitted machine tick does not advance the in-memory timers", () => {
    const sim = new Sim([stopped]);
    const world = { machines: [stoppedMachine("a")] };
    sim.at(0, world);
    sim.at(5, world, { commit: false }); // would fire; the write "failed"
    expect(transitions(sim.at(5.5, world))).toEqual(["group:fired"]);
  });

  it("writes only what changed: an unchanged tick writes nothing", () => {
    const sim = new Sim([powerOutage]);
    const evaluation = () =>
      sim.evaluator.evaluate({ now: T0, observations: snapshot(T0, { circuits: [circuit(1)] }), rules: sim.rules, states: sim.states, muted: false });
    expect(evaluation().writes).toEqual([]);
  });
});

describe("robustness", () => {
  it("no rules, no circuits and no machines: nothing happens and nothing throws", () => {
    const sim = new Sim([]);
    expect(sim.at(0, {})).toEqual([]);
    const withRules = new Sim([powerOutage, fuseTrip, stopped, unreachable]);
    expect(withRules.at(0, { circuits: [], machines: [] })).toEqual([]);
  });

  it("removing a rule drops its in-memory state", () => {
    const sim = new Sim([stopped]);
    sim.at(0, { machines: [stoppedMachine("a")] });
    sim.rules = [];
    expect(sim.at(1, { machines: [stoppedMachine("a")] })).toEqual([]);
    sim.rules = [stopped];
    expect(sim.at(2, { machines: [stoppedMachine("a")] })).toEqual([]); // a fresh run: no memory of minute 0
  });
});

describe("fresh-eyes: boundaries and gaps", () => {
  it("a reading exactly two poll intervals old is fresh, one millisecond older is stale (unknown)", () => {
    const fresh = new Sim([powerOutage]);
    expect(transitions(fresh.at(0, { circuits: [circuit(1, "outage")], powerAge: 10 * SEC }))).toEqual(["circuit:1:fired"]);
    const stale = new Sim([powerOutage]);
    expect(stale.at(0, { circuits: [circuit(1, "outage")], powerAge: 10 * SEC + 1 })).toEqual([]);
  });

  it("a stale status reading that says paused does not suppress anything", () => {
    const sim = new Sim([powerOutage]);
    expect(transitions(sim.at(0, { paused: true, statusAge: 30 * SEC, circuits: [circuit(1, "outage")] }))).toEqual(["circuit:1:fired"]);
  });

  it("power_outage fires on status outage only, not on at_risk", () => {
    const sim = new Sim([powerOutage]);
    expect(sim.at(0, { circuits: [circuit(1, "at_risk", false)] })).toEqual([]);
  });

  it("server_unreachable: exactly 3 failed polls (and 2 minutes) is enough; 2 is not", () => {
    const three = new Sim([unreachable]);
    expect(transitions(three.at(2, { failures: 3, firstFailureAt: T0 }))).toEqual(["server:fired"]);
    const two = new Sim([unreachable]);
    expect(two.at(2, { failures: 2, firstFailureAt: T0 })).toEqual([]);
  });

  it("server_unreachable: a single failed poll is not an answer, so a firing alert never clears on it", () => {
    const sim = new Sim([unreachable]);
    sim.at(2, { failures: 30, firstFailureAt: T0 });
    for (let m = 3; m <= 20; m += 1) sim.at(m, { failures: 1, firstFailureAt: T0 + m * MIN });
    expect(sim.phase(unreachable, "server")).toBe("firing");
  });

  it("server_unreachable keeps clearing through a pause: the gap is not dropped for that rule", () => {
    const sim = new Sim([unreachable]);
    sim.at(2, { failures: 30, firstFailureAt: T0 });
    sim.at(3, { paused: true }); // answers again (paused), clear run starts
    sim.at(3.5, {}); // resumed: not suppressed any more
    expect(transitions(sim.at(4.1, {}))).toEqual(["server:resolved"]);
  });

  it("`updated` is announced exactly 10 minutes after the last notification, not a moment before", () => {
    const sim = new Sim([stopped]);
    sim.at(0, { machines: [stoppedMachine("a"), okMachine("b")] });
    sim.at(5, { machines: [stoppedMachine("a"), okMachine("b")] }); // fired at 5
    const two = { machines: [stoppedMachine("a"), stoppedMachine("b")] };
    for (let m = 6; m < 15; m += 1) expect(sim.at(m, two)).toEqual([]);
    expect(transitions(sim.at(15, two))).toEqual(["group:updated"]);
  });

  it("a new machine during a clear run waits its own `for`; it does not count as a restart adoption", () => {
    const sim = new Sim([stopped]);
    sim.at(0, { machines: [stoppedMachine("a"), okMachine("b")] });
    sim.at(5, { machines: [stoppedMachine("a"), okMachine("b")] }); // fired
    sim.at(6, { machines: [okMachine("a"), okMachine("b")] }); // clear run starts, no machine tracked any more
    sim.at(7, { machines: [okMachine("a"), stoppedMachine("b")] }); // b only just stopped
    expect(transitions(sim.at(8, { machines: [okMachine("a"), stoppedMachine("b")] }))).toEqual(["group:resolved"]);
    expect(transitions(sim.at(12, { machines: [okMachine("a"), stoppedMachine("b")] }))).toEqual(["group:fired"]);
  });

  it("a restart while the factory reading is not usable yet still adopts on the first usable reading", () => {
    const sim = new Sim([stopped]);
    const world = { machines: [stoppedMachine("a")] };
    sim.at(0, world);
    sim.at(5, world); // fired
    sim.restart();
    expect(sim.at(6, { ...world, factoryAge: 5 * MIN })).toEqual([]); // stale after the restart
    const out: string[] = [];
    for (let m = 7; m <= 30; m += 1) out.push(...transitions(sim.at(m, world)));
    expect(out).toEqual([]);
    expect(sim.phase(stopped, "group")).toBe("firing");
  });
});
