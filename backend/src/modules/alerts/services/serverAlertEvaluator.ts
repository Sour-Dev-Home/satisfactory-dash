import type { MachineObservation, ObservationSnapshot } from "../../telemetry/index.js";
import {
  INITIAL_ALERT_STATE,
  belowWithHysteresis,
  resumeAfterSuppression,
  step,
  type AlertState,
  type AlertTiming,
  type AlertTransition,
} from "./alertStateMachine.js";
import {
  PRODUCTION_CLEAR_ABOVE_SHARE,
  PRODUCTION_FIRE_BELOW_SHARE,
  type ProductionBelowTargetParams,
  type Rule,
  type RuleKind,
  type ServerUnreachableParams,
  type Severity,
  type StoppedMachinesParams,
} from "./rules.js";

/** What an alert event says happened. `updated` is only for a grouped alert that is already firing (see below). */
export type EventTransition = AlertTransition | "updated";

export interface StateWrite {
  ruleId: string;
  subject: string;
  state: AlertState;
}

export interface AlertEventOut {
  ruleId: string;
  kind: RuleKind;
  severity: Severity;
  subject: string;
  transition: EventTransition;
  /** What to say: counts, top items, a circuit id. Game data only. */
  summary: Record<string, unknown>;
}

export interface Evaluation {
  /** The persisted states that changed. */
  writes: StateWrite[];
  events: AlertEventOut[];
  /** Applies the in-memory side (machine timers, who was told about) once the writes are safely stored. */
  commit(): void;
}

export interface EvaluationInput {
  now: number;
  observations: ObservationSnapshot;
  /** The enabled, valid rules of ONE server. */
  rules: readonly Rule[];
  /** The persisted state per `stateKey(ruleId, subject)`. */
  states: ReadonlyMap<string, AlertState>;
  /** Alerts for this server are muted until a chosen time: nothing is evaluated. */
  muted: boolean;
}

export const stateKey = (ruleId: string, subject: string): string => `${ruleId}\u0000${subject}`;

/** A reading older than this many poll intervals is stale: its subjects are UNKNOWN (they hold their last condition). */
const STALE_AFTER_INTERVALS = 2;
/** New machines joining an already firing group are announced at most this often (`updated`). */
const UPDATE_MIN_INTERVAL_MS = 10 * 60_000;
const UNREACHABLE_DEFAULTS: ServerUnreachableParams = { failedPolls: 3, minSeconds: 120 };
const SUMMARY_TOP_RECIPES = 5;

/** One factory-wide reading of an item's rate, kept per rule in memory (never in the database). */
interface RateSample {
  at: number;
  rate: number;
}
/**
 * The rolling window of one `production_below_target` rule. It belongs to one item, one window size and one game
 * session; if any of them changes it starts over, and so does a restart (it lives only in memory).
 */
interface RateWindow {
  item: string;
  windowMs: number;
  session: string | undefined;
  samples: RateSample[];
}

const isFresh = (reading: { observedAt: number; intervalMs: number } | undefined, now: number): boolean =>
  reading !== undefined && now - reading.observedAt <= STALE_AFTER_INTERVALS * reading.intervalMs;

const timingOf = (rule: Rule): AlertTiming => ({
  forMs: rule.forSeconds * 1000,
  clearMs: rule.clearSeconds * 1000,
  repeatMs: rule.repeatSeconds * 1000,
});

const sameState = (a: AlertState, b: AlertState): boolean =>
  a.phase === b.phase &&
  a.since === b.since &&
  a.clearSince === b.clearSince &&
  a.lastNotifiedAt === b.lastNotifiedAt &&
  a.lastCondition === b.lastCondition;

function isUnreachable(obs: ObservationSnapshot, now: number, params: ServerUnreachableParams): boolean {
  const { consecutiveFailures, firstFailureAt } = obs.polls;
  return (
    consecutiveFailures >= params.failedPolls &&
    firstFailureAt !== undefined &&
    now - firstFailureAt >= params.minSeconds * 1000
  );
}

function machineSummary(ids: ReadonlySet<string>, machines: readonly MachineObservation[]): Record<string, unknown> {
  const byRecipe = new Map<string | null, number>();
  for (const machine of machines) {
    if (ids.has(machine.id)) byRecipe.set(machine.recipe, (byRecipe.get(machine.recipe) ?? 0) + 1);
  }
  const top = [...byRecipe]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, SUMMARY_TOP_RECIPES)
    .map(([recipe, count]) => ({ recipe, count }));
  // Why each machine is stopped: "output full" (backedUp) or "input short: <the ingredient it consumes least>"
  // (underfed). Counted per reason, so one group message can say both.
  const byReason = new Map<string, number>();
  for (const machine of machines) {
    if (!ids.has(machine.id)) continue;
    const reason =
      machine.state === "backedUp"
        ? "output full"
        : machine.missingInput !== undefined
          ? `input short: ${machine.missingInput}`
          : "input short";
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const reasons = [...byReason]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SUMMARY_TOP_RECIPES)
    .map(([reason, count]) => ({ reason, count }));
  return { machines: ids.size, byRecipe: top, byReason: reasons };
}

/**
 * ADR-0027 decision 4, for ONE server: turns the pollers' last readings plus the persisted states into new states and
 * alert events. It holds the in-memory parts (per-machine timers of the grouped alert, who was last told about, whether
 * the previous tick was suppressed); everything else is an argument, so a tick is a function of its inputs.
 *
 * - Suppression: while the game is paused, the server is unreachable, or alerts are muted, the power and machine rules
 *   are NOT evaluated (and `server_unreachable` is the one alert that speaks). When it ends, pending runs are dropped
 *   and half-way clears forgotten (`resumeAfterSuppression`): a gap never counts as time.
 * - Unknown readings: a stale reading, or the first factory snapshot after a pause (FRM may still be frozen), gives
 *   "unknown", and every subject holds its last condition.
 * - Grouped `stopped_machines`: one alert per rule (subject "group"). Each machine has its own timer in memory, so a
 *   restart only delays a NEW alert by up to `for`; the group's phase lives in the persisted state, and after a restart
 *   a firing group adopts the machines that are stopped right now instead of resolving and firing again.
 *
 * `evaluate` changes nothing: the caller stores `writes` and `events` in one transaction and only then calls `commit()`,
 * so a failed write leaves the evaluator exactly as it was and the next tick reproduces the same transitions.
 */
export class ServerAlertEvaluator {
  private machineTimers = new Map<string, Map<string, AlertState>>();
  private notified = new Map<string, Set<string>>();
  private rateWindows = new Map<string, RateWindow>();
  private wasSuppressed = false;

  evaluate(input: EvaluationInput): Evaluation {
    const { now, observations: obs, rules } = input;
    const writes = new Map<string, StateWrite>();
    const events: AlertEventOut[] = [];
    const commits: (() => void)[] = [];

    const unreachableRule = rules.find((rule) => rule.kind === "server_unreachable");
    const unreachableParams = unreachableRule?.kind === "server_unreachable" ? unreachableRule.params : UNREACHABLE_DEFAULTS;
    const unreachable = isUnreachable(obs, now, unreachableParams);
    const paused = isFresh(obs.status, now) && obs.status?.paused === true;
    const suppressed = input.muted || paused || unreachable;
    const resumed = this.wasSuppressed && !suppressed;

    // The states the rules continue from. After a suppressed stretch the non-`server_unreachable` ones are cleaned up.
    const effective = new Map(input.states);
    if (resumed) {
      const byId = new Map(rules.map((rule) => [rule.id, rule]));
      for (const [key, state] of input.states) {
        const rule = byId.get(key.slice(0, key.indexOf("\u0000")));
        if (rule === undefined || rule.kind === "server_unreachable") continue;
        const next = resumeAfterSuppression(state);
        if (!sameState(state, next)) {
          effective.set(key, next);
          const subject = key.slice(key.indexOf("\u0000") + 1);
          writes.set(key, { ruleId: rule.id, subject, state: next });
        }
      }
    }
    const previous = (rule: Rule, subject: string): AlertState => effective.get(stateKey(rule.id, subject)) ?? INITIAL_ALERT_STATE;

    const stepSubject = (rule: Rule, subject: string, condition: boolean | "unknown", summary: () => Record<string, unknown>, timing = timingOf(rule)) => {
      const before = previous(rule, subject);
      const result = step(before, condition, now, timing);
      const key = stateKey(rule.id, subject);
      if (!sameState(before, result.state) && !(effective.get(key) === undefined && sameState(result.state, INITIAL_ALERT_STATE))) {
        writes.set(key, { ruleId: rule.id, subject, state: result.state });
      }
      if (result.transition) {
        events.push({ ruleId: rule.id, kind: rule.kind, severity: rule.severity, subject, transition: result.transition, summary: summary() });
      }
      return result;
    };

    for (const rule of rules) {
      if (input.muted) continue; // muted: nothing at all
      switch (rule.kind) {
        case "server_unreachable": {
          const condition: boolean | "unknown" = unreachable
            ? true
            : obs.polls.consecutiveFailures === 0 && obs.polls.lastSuccessAt !== undefined && isFresh(obs.status, now)
              ? false
              : "unknown";
          stepSubject(rule, "server", condition, () => ({
            failedPolls: obs.polls.consecutiveFailures,
            downForSeconds: obs.polls.firstFailureAt === undefined ? 0 : Math.max(0, Math.round((now - obs.polls.firstFailureAt) / 1000)),
          }));
          break;
        }
        case "power_outage":
        case "fuse_trip": {
          if (suppressed) break;
          const fresh = isFresh(obs.power, now);
          const circuits = new Map((fresh ? (obs.power?.circuits ?? []) : []).map((circuit) => [circuit.circuit, circuit]));
          const subjects = new Set<string>([...circuits.keys()].map((id) => `circuit:${id}`));
          const prefix = `${rule.id}\u0000circuit:`;
          for (const key of effective.keys()) {
            if (key.startsWith(prefix)) subjects.add(key.slice(rule.id.length + 1));
          }
          for (const subject of subjects) {
            const id = Number(subject.slice("circuit:".length));
            const circuit = circuits.get(id);
            // A fresh, complete reading without this circuit means it is gone (a new game session): not stopped, cleared.
            const condition: boolean | "unknown" = !fresh
              ? "unknown"
              : circuit === undefined
                ? false
                : rule.kind === "power_outage"
                  ? circuit.status === "outage"
                  : circuit.fuseTripped;
            stepSubject(rule, subject, condition, () => ({ circuit: id }));
          }
          break;
        }
        case "stopped_machines": {
          if (suppressed) break;
          this.evaluateStoppedMachines(rule, rule.params, obs, now, previous, stepSubject, events, writes, commits, resumed);
          break;
        }
        case "production_below_target": {
          if (suppressed) break;
          this.evaluateProduction(rule, rule.params, obs, now, previous, stepSubject, commits);
          break;
        }
      }
    }

    // A rule that was deleted or disabled leaves nothing behind in memory.
    const liveIds = new Set(rules.map((rule) => rule.id));
    commits.push(() => {
      for (const id of this.machineTimers.keys()) if (!liveIds.has(id)) this.machineTimers.delete(id);
      for (const id of this.notified.keys()) if (!liveIds.has(id)) this.notified.delete(id);
      // A rate window across a suppressed stretch (paused, unreachable, muted) would bridge a gap: drop them all.
      for (const id of this.rateWindows.keys()) if (suppressed || !liveIds.has(id)) this.rateWindows.delete(id);
      this.wasSuppressed = suppressed;
    });
    return { writes: [...writes.values()], events, commit: () => commits.forEach((apply) => apply()) };
  }

  /**
   * Amendment 3, "production below target", for one item. The condition is the average of the factory-wide rate over
   * a rolling window, with a hysteresis band: below 90% of the target is true, above 95% is false, in between the last
   * answer stands. Until the window is FULL (after a restart, a pause, a session change, a stale reading) the answer
   * is "unknown", so a firing alert holds and a new one waits: a half-filled window would judge on too little.
   */
  private evaluateProduction(
    rule: Rule & { kind: "production_below_target" },
    params: ProductionBelowTargetParams,
    obs: ObservationSnapshot,
    now: number,
    previous: (rule: Rule, subject: string) => AlertState,
    stepSubject: (rule: Rule, subject: string, condition: boolean | "unknown", summary: () => Record<string, unknown>, timing?: AlertTiming) => { state: AlertState; transition?: AlertTransition },
    commits: (() => void)[],
  ): void {
    const factory = obs.factory;
    const usable = isFresh(factory, now) && factory !== undefined && !factory.afterResume;
    const windowMs = params.windowMinutes * 60_000;
    const existing = this.rateWindows.get(rule.id);
    const sameWindow = existing !== undefined && existing.item === params.item && existing.windowMs === windowMs && existing.session === obs.session;
    // The working copy: `evaluate` changes nothing until `commit`.
    let samples: RateSample[] = usable && existing !== undefined && sameWindow ? [...existing.samples] : [];
    let full = false;
    let average = 0;
    if (usable) {
      const last = samples[samples.length - 1];
      // The evaluator ticks more often than the factory poller: one sample per reading.
      if (last === undefined || factory.observedAt > last.at) {
        // An item nobody makes is absent from the map: that is a rate of 0 (a zero rate fires), not unknown.
        samples.push({ at: factory.observedAt, rate: factory.itemRates.get(params.item) ?? 0 });
      }
      samples = samples.filter((sample) => sample.at >= factory.observedAt - windowMs);
      // Full: the oldest sample is at most one poll interval short of the window, so a late poll does not stall it.
      full = samples.length > 0 && samples[0]!.at <= factory.observedAt - windowMs + factory.intervalMs;
      if (full) average = samples.reduce((sum, sample) => sum + sample.rate, 0) / samples.length;
    }

    const before = previous(rule, "item");
    const condition: boolean | "unknown" = full
      ? belowWithHysteresis(
          average,
          before.lastCondition,
          params.targetPerMinute * PRODUCTION_FIRE_BELOW_SHARE,
          params.targetPerMinute * PRODUCTION_CLEAR_ABOVE_SHARE,
        )
      : "unknown";
    stepSubject(rule, "item", condition, () => ({
      item: params.item,
      targetPerMinute: params.targetPerMinute,
      // Only from a full window: a reminder sent while the window refills must not report a made-up average.
      ...(full ? { averagePerMinute: Math.round(average * 10) / 10 } : {}),
      windowMinutes: params.windowMinutes,
    }));
    const stored: RateWindow = { item: params.item, windowMs, session: obs.session, samples };
    commits.push(() => {
      this.rateWindows.set(rule.id, stored);
    });
  }

  private evaluateStoppedMachines(
    rule: Rule & { kind: "stopped_machines" },
    params: StoppedMachinesParams,
    obs: ObservationSnapshot,
    now: number,
    previous: (rule: Rule, subject: string) => AlertState,
    stepSubject: (rule: Rule, subject: string, condition: boolean | "unknown", summary: () => Record<string, unknown>, timing?: AlertTiming) => { state: AlertState; transition?: AlertTransition },
    events: AlertEventOut[],
    writes: Map<string, StateWrite>,
    commits: (() => void)[],
    resumed: boolean,
  ): void {
    const group = previous(rule, "group");
    // The working copy of this rule's machine timers. After a suppressed stretch a pending run is dropped.
    let timers = new Map(this.machineTimers.get(rule.id) ?? []);
    if (resumed) {
      timers = new Map([...timers].map(([id, state]) => [id, resumeAfterSuppression(state)] as const).filter(([, state]) => state.phase !== "ok"));
    }
    const factory = obs.factory;
    const usable = isFresh(factory, now) && factory !== undefined && !factory.afterResume;
    const machineTiming: AlertTiming = { forMs: rule.forSeconds * 1000, clearMs: 0, repeatMs: Number.POSITIVE_INFINITY };

    if (usable) {
      // After a restart a firing group adopts the machines that are stopped right now: they have been stopped since
      // before we looked, so they qualify at once instead of the group resolving and firing again in `for`.
      // Only when this evaluator has never tracked the rule's machines (`machineTimers` has no entry): an empty set
      // during a clear run is not a restart, and a new machine must then wait its own `for`.
      const adopting = !this.machineTimers.has(rule.id) && timers.size === 0 && group.phase === "firing";
      const seen = new Set<string>();
      for (const machine of factory.machines) {
        seen.add(machine.id);
        let condition: boolean | "unknown";
        if (machine.state === undefined) condition = "unknown";
        // Stopped = producing (almost) nothing, for either reason: short of input (underfed) or unable to get rid of its
        // output (backedUp, the most common real case). A backedUp machine at a higher percent is intermittently full,
        // not stopped. Any other state (idle, paused, unpowered, producing) is not this alert's business.
        else if (machine.state !== "underfed" && machine.state !== "backedUp") condition = false;
        else condition = machine.outputPercent === undefined ? "unknown" : machine.outputPercent < params.stoppedBelowPercent;
        let timer = timers.get(machine.id) ?? INITIAL_ALERT_STATE;
        if (adopting && condition === true) {
          timer = { phase: "firing", since: now - machineTiming.forMs, clearSince: null, lastNotifiedAt: now, lastCondition: true };
        }
        timer = step(timer, condition, now, machineTiming).state;
        if (timer.phase === "ok") timers.delete(machine.id);
        else timers.set(machine.id, timer);
      }
      for (const id of timers.keys()) if (!seen.has(id)) timers.delete(id); // the machine is gone
    }

    const qualifying = new Set([...timers].filter(([, state]) => state.phase === "firing").map(([id]) => id));
    const condition: boolean | "unknown" = usable ? qualifying.size > 0 : "unknown";
    // The group has no `for` of its own (each machine already waited it); it clears after `clear` with no machine.
    const result = stepSubject(rule, "group", condition, () => machineSummary(qualifying, factory?.machines ?? []), {
      forMs: 0,
      clearMs: rule.clearSeconds * 1000,
      repeatMs: rule.repeatSeconds * 1000,
    });

    // Who the last notification covered. After a restart this is empty: adopt the current set (no `updated`).
    let told = this.notified.get(rule.id) ?? new Set<string>();
    if (told.size === 0 && result.state.phase === "firing") told = new Set(qualifying);
    let transition: EventTransition | undefined = result.transition;
    let stateAfter = result.state;
    if (transition === undefined && result.state.phase === "firing" && condition === true) {
      const joined = [...qualifying].filter((id) => !told.has(id));
      const dueAt = (result.state.lastNotifiedAt ?? Number.NEGATIVE_INFINITY) + UPDATE_MIN_INTERVAL_MS;
      if (joined.length > 0 && now >= dueAt) {
        transition = "updated";
        stateAfter = { ...result.state, lastNotifiedAt: now };
        const key = stateKey(rule.id, "group");
        writes.set(key, { ruleId: rule.id, subject: "group", state: stateAfter });
        events.push({
          ruleId: rule.id,
          kind: rule.kind,
          severity: rule.severity,
          subject: "group",
          transition: "updated",
          summary: { ...machineSummary(qualifying, factory?.machines ?? []), newMachines: joined.length },
        });
      }
    }
    commits.push(() => {
      // While the factory reading is unusable and nothing was tracked yet (right after a restart), stay "untracked" so
      // the first usable reading can still adopt.
      if (usable || this.machineTimers.has(rule.id)) this.machineTimers.set(rule.id, timers);
      if (transition === "resolved") this.notified.set(rule.id, new Set());
      else if (transition !== undefined || told.size > 0) this.notified.set(rule.id, transition !== undefined ? new Set(qualifying) : told);
    });
  }
}
