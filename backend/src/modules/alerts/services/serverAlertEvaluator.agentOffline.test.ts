import { describe, expect, it } from "vitest";
import type { ObservationSnapshot } from "../../telemetry/index.js";
import type { AlertState } from "./alertStateMachine.js";
import { ServerAlertEvaluator, stateKey, type AlertEventOut } from "./serverAlertEvaluator.js";
import { AGENT_OFFLINE_MIN_SECONDS, AGENT_PRESET_RULES, DEFAULTS_BY_KIND, PRESET_RULES, parseRuleParams, type Rule } from "./rules.js";

// ADR-0031 PR 5b: "agent offline", no snapshot from the edge agent for two minutes.

const SEC = 1000;
const MIN = 60 * SEC;
const T0 = 1_800_000_000_000;

const agentOffline = (params: Record<string, unknown> = { offlineSeconds: 120 }, overrides: Partial<Rule> = {}): Rule =>
  ({ id: "rule-agent-offline", serverPublicId: "alpha", kind: "agent_offline", params, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical", ...overrides }) as Rule;
const unreachableRule = { id: "rule-unreachable", serverPublicId: "alpha", kind: "server_unreachable", params: { failedPolls: 3, minSeconds: 120 }, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical" } as Rule;
const powerRule = { id: "rule-power", serverPublicId: "alpha", kind: "power_outage", params: {}, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical" } as Rule;

interface World {
  /** Set for an agent server: when the board began and when the agent was last heard (undefined = not yet). */
  agent?: { startedAt: number; lastHeardAt?: number };
  paused?: boolean;
  failures?: number;
}

function snapshot(now: number, world: World): ObservationSnapshot {
  return {
    session: "Session A",
    status: { observedAt: now, intervalMs: 5 * SEC, paused: world.paused ?? false },
    power: { observedAt: now, intervalMs: 5 * SEC, circuits: [{ circuit: 1, status: "ok", fuseTripped: false }] },
    factory: undefined,
    polls: { consecutiveFailures: world.failures ?? 0, firstFailureAt: world.failures ? now - 10 * MIN : undefined, lastSuccessAt: now },
    ...(world.agent ? { agent: { startedAt: world.agent.startedAt, lastHeardAt: world.agent.lastHeardAt } } : {}),
  };
}

class Sim {
  states = new Map<string, AlertState>();
  evaluator = new ServerAlertEvaluator();
  constructor(public rules: Rule[]) {}
  at(seconds: number, world: World, options: { muted?: boolean } = {}): AlertEventOut[] {
    const now = T0 + seconds * SEC;
    const evaluation = this.evaluator.evaluate({ now, observations: snapshot(now, world), rules: this.rules, states: this.states, muted: options.muted ?? false });
    for (const write of evaluation.writes) this.states.set(stateKey(write.ruleId, write.subject), write.state);
    evaluation.commit();
    return evaluation.events;
  }
  phase(rule: Rule, subject = "agent") {
    return this.states.get(stateKey(rule.id, subject))?.phase ?? "ok";
  }
}
const transitions = (events: AlertEventOut[]) => events.map((event) => `${event.kind}:${event.subject}:${event.transition}`);

describe("agent_offline", () => {
  it("fires when the agent has been silent for offlineSeconds, not before", () => {
    const rule = agentOffline();
    const sim = new Sim([rule]);
    const heard = T0;
    expect(sim.at(0, { agent: { startedAt: T0 - MIN, lastHeardAt: heard } })).toEqual([]);
    expect(sim.at(119, { agent: { startedAt: T0 - MIN, lastHeardAt: heard } })).toEqual([]);
    const fired = sim.at(120, { agent: { startedAt: T0 - MIN, lastHeardAt: heard } });
    expect(fired).toEqual([
      { ruleId: rule.id, kind: "agent_offline", severity: "critical", subject: "agent", transition: "fired", summary: { silentForSeconds: 120, neverHeard: false } },
    ]);
  });

  it("resolves after the clear duration once the agent is heard again", () => {
    const rule = agentOffline();
    const sim = new Sim([rule]);
    sim.at(0, { agent: { startedAt: T0, lastHeardAt: T0 } });
    sim.at(130, { agent: { startedAt: T0, lastHeardAt: T0 } }); // fired
    expect(sim.phase(rule)).toBe("firing");
    const back = { startedAt: T0, lastHeardAt: T0 + 140 * SEC };
    expect(sim.at(140, { agent: back })).toEqual([]); // condition false, now clearing
    expect(transitions(sim.at(201, { agent: back }))).toEqual(["agent_offline:agent:resolved"]);
  });

  it("re-notifies at most once per repeat interval while the agent stays gone", () => {
    const sim = new Sim([agentOffline()]);
    const world = { agent: { startedAt: T0, lastHeardAt: T0 } };
    const all: string[] = [];
    for (let s = 0; s <= 2 * 3600 + 200; s += 30) all.push(...transitions(sim.at(s, world)));
    expect(all).toEqual(["agent_offline:agent:fired", "agent_offline:agent:renotify", "agent_offline:agent:renotify"]);
  });

  describe("silence is measured from the later of the last snapshot and the board's start", () => {
    it("after a restart with nothing heard yet, the clock starts at the restart: an agent that is gone is noticed offlineSeconds later", () => {
      const sim = new Sim([agentOffline()]);
      const world = { agent: { startedAt: T0, lastHeardAt: undefined } };
      expect(sim.at(0, world)).toEqual([]);
      expect(sim.at(119, world)).toEqual([]);
      const fired = sim.at(120, world);
      expect(fired[0]).toMatchObject({ transition: "fired", summary: { silentForSeconds: 120, neverHeard: true } });
    });

    it("a heard time from before the board began does not count as recent silence", () => {
      const sim = new Sim([agentOffline()]);
      // heard 10 minutes before the board started (impossible in practice, but the later time wins)
      const world = { agent: { startedAt: T0, lastHeardAt: T0 - 10 * MIN } };
      expect(sim.at(60, world)).toEqual([]);
      expect(transitions(sim.at(120, world))).toEqual(["agent_offline:agent:fired"]);
    });

    it("a server enrolled a moment ago is not offline before it had the time to report", () => {
      const sim = new Sim([agentOffline()]);
      expect(sim.at(30, { agent: { startedAt: T0 + 20 * SEC, lastHeardAt: undefined } })).toEqual([]);
    });
  });

  it("honours the rule's own offlineSeconds", () => {
    const sim = new Sim([agentOffline({ offlineSeconds: 300 })]);
    const world = { agent: { startedAt: T0, lastHeardAt: T0 } };
    expect(sim.at(200, world)).toEqual([]);
    expect(transitions(sim.at(300, world))).toEqual(["agent_offline:agent:fired"]);
  });

  it("has no subject for a server without an agent (a local server's board): nothing is evaluated or written", () => {
    const sim = new Sim([agentOffline()]);
    for (const s of [0, 120, 600, 3600]) expect(sim.at(s, {})).toEqual([]);
    expect(sim.states.size).toBe(0);
  });

  it("speaks through a paused game and an unreachable game server: neither suppresses it", () => {
    const rule = agentOffline();
    const sim = new Sim([rule, powerRule, unreachableRule]);
    const world = { agent: { startedAt: T0, lastHeardAt: T0 }, paused: true, failures: 5 };
    sim.at(0, world);
    expect(transitions(sim.at(130, world))).toContain("agent_offline:agent:fired");
  });

  it("is silent while alerts are muted, like every other rule", () => {
    const sim = new Sim([agentOffline()]);
    expect(sim.at(300, { agent: { startedAt: T0, lastHeardAt: T0 } }, { muted: true })).toEqual([]);
  });

  it("a resume after suppression does not reset a firing agent_offline (it is a 'the link is down' alert)", () => {
    const rule = agentOffline();
    const sim = new Sim([rule, unreachableRule]);
    const gone = { startedAt: T0, lastHeardAt: T0 };
    sim.at(0, { agent: gone });
    sim.at(130, { agent: gone, failures: 5 }); // fires while the game is also unreachable (suppressed)
    expect(sim.phase(rule)).toBe("firing");
    sim.at(140, { agent: gone }); // the suppression ends
    expect(sim.phase(rule)).toBe("firing");
  });
});

describe("the agent_offline rule kind", () => {
  it("parses its params, with the two-minute default, and refuses anything else", () => {
    expect(parseRuleParams("agent_offline", {})).toEqual({ kind: "agent_offline", params: { offlineSeconds: 120 } });
    expect(parseRuleParams("agent_offline", undefined)).toEqual({ kind: "agent_offline", params: { offlineSeconds: 120 } });
    expect(parseRuleParams("agent_offline", { offlineSeconds: 300 })).toEqual({ kind: "agent_offline", params: { offlineSeconds: 300 } });
    expect(parseRuleParams("agent_offline", { offlineSeconds: AGENT_OFFLINE_MIN_SECONDS })).toBeDefined();
    for (const bad of [{ offlineSeconds: AGENT_OFFLINE_MIN_SECONDS - 1 }, { offlineSeconds: 86_401 }, { offlineSeconds: 90.5 }, { offlineSeconds: "120" }, { other: 1 }]) {
      expect(parseRuleParams("agent_offline", bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("is a preset only for a server reached through an agent: not among the presets every server gets", () => {
    expect(PRESET_RULES.map((preset) => preset.kind)).not.toContain("agent_offline");
    expect(AGENT_PRESET_RULES).toEqual([
      { kind: "agent_offline", params: { offlineSeconds: 120 }, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical" },
    ]);
    expect(DEFAULTS_BY_KIND.agent_offline).toBe(AGENT_PRESET_RULES[0]);
  });
});
