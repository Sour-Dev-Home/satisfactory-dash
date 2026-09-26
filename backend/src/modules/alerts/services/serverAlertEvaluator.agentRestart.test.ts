import { describe, expect, it } from "vitest";
import type { ObservationSnapshot } from "../../telemetry/index.js";
import type { AlertState } from "./alertStateMachine.js";
import { ServerAlertEvaluator, stateKey, type AlertEventOut } from "./serverAlertEvaluator.js";
import type { Rule } from "./rules.js";

const SEC = 1000;
const T0 = 1_800_000_000_000;
const rule = { id: "r1", serverPublicId: "alpha", kind: "agent_offline", params: { offlineSeconds: 120 }, forSeconds: 0, clearSeconds: 60, repeatSeconds: 3600, severity: "critical" } as Rule;

const snapshot = (now: number, agent: { startedAt: number; lastHeardAt?: number }): ObservationSnapshot => ({
  session: "S",
  status: { observedAt: now, intervalMs: 5 * SEC, paused: false },
  power: undefined,
  factory: undefined,
  polls: { consecutiveFailures: 0, firstFailureAt: undefined, lastSuccessAt: now },
  agent: { startedAt: agent.startedAt, lastHeardAt: agent.lastHeardAt },
});

describe("agent_offline across a backend restart", () => {
  it("does not announce 'reporting again' while the agent is still silent after the restart", () => {
    const states = new Map<string, AlertState>();
    let evaluator = new ServerAlertEvaluator();
    const run = (seconds: number, agent: { startedAt: number; lastHeardAt?: number }): AlertEventOut[] => {
      const now = T0 + seconds * SEC;
      const evaluation = evaluator.evaluate({ now, observations: snapshot(now, agent), rules: [rule], states, muted: false });
      for (const write of evaluation.writes) states.set(stateKey(write.ruleId, write.subject), write.state);
      evaluation.commit();
      return evaluation.events;
    };
    // The agent went silent long ago and the alert is firing.
    expect(run(0, { startedAt: T0 - 600 * SEC, lastHeardAt: T0 - 300 * SEC }).map((e) => e.transition)).toEqual(["fired"]);
    // The backend restarts at T0+10s: a new board and evaluator; the persisted state is kept; the agent never reports.
    evaluator = new ServerAlertEvaluator();
    const seen: string[] = [];
    for (let s = 10; s <= 300; s += 5) seen.push(...run(s, { startedAt: T0 + 10 * SEC }).map((e) => `${s}:${e.transition}`));
    expect(seen).toEqual([]);
  });
});
