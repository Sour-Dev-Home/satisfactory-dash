import { describe, expect, it } from "vitest";
import {
  belowWithHysteresis,
  INITIAL_ALERT_STATE,
  resumeAfterSuppression,
  step,
  type AlertState,
  type AlertTiming,
  type AlertTransition,
} from "./alertStateMachine.js";

const MIN = 60_000;
const T0 = 1_000_000_000_000;
const timing: AlertTiming = { forMs: 5 * MIN, clearMs: 2 * MIN, repeatMs: 60 * MIN };

/** Runs a script of [minutes since T0, condition] through the machine; returns the transitions with their minutes. */
function run(script: [number, boolean | "unknown"][], t: AlertTiming = timing, from: AlertState = INITIAL_ALERT_STATE) {
  let state = from;
  const out: [number, AlertTransition][] = [];
  for (const [minute, condition] of script) {
    const result = step(state, condition, T0 + minute * MIN, t);
    state = result.state;
    if (result.transition) out.push([minute, result.transition]);
  }
  return { state, out };
}

describe("step: fire, hold, resolve", () => {
  it("stays ok while the condition is false", () => {
    const { state, out } = run([[0, false], [1, false], [2, false]]);
    expect(out).toEqual([]);
    expect(state.phase).toBe("ok");
  });

  it("fires only after the condition has held for `for`, and not a moment earlier", () => {
    expect(run([[0, true], [4.999, true]]).out).toEqual([]);
    expect(run([[0, true], [5, true]]).out).toEqual([[5, "fired"]]);
  });

  it("a condition that breaks before `for` never notifies (pending -> ok) and restarts the clock", () => {
    const { out, state } = run([[0, true], [3, true], [4, false], [5, true], [8, true], [9.5, true]]);
    expect(out).toEqual([]); // the second run started at minute 5, so it would fire at 10
    expect(state.phase).toBe("pending");
    expect(run([[0, true], [3, true], [4, false], [5, true], [10, true]]).out).toEqual([[10, "fired"]]);
  });

  it("`for` 0 is edge-triggered: fires on the first true reading", () => {
    expect(run([[0, true]], { ...timing, forMs: 0 }).out).toEqual([[0, "fired"]]);
  });

  it("re-notifies at most once per repeat interval while it keeps firing", () => {
    const script: [number, boolean][] = [[0, true], [5, true]];
    for (let m = 6; m <= 130; m++) script.push([m, true]);
    expect(run(script).out).toEqual([[5, "fired"], [65, "renotify"], [125, "renotify"]]);
  });

  it("resolves only after the condition has been false for the whole clear duration", () => {
    expect(run([[0, true], [5, true], [6, false], [7.999, false]]).out).toEqual([[5, "fired"]]);
    expect(run([[0, true], [5, true], [6, false], [8, false]]).out).toEqual([[5, "fired"], [8, "resolved"]]);
  });

  it("a false reading that is interrupted by a true one does not count towards the clear duration", () => {
    const { out, state } = run([[0, true], [5, true], [6, false], [7, true], [8, false], [9.5, false]]);
    expect(out).toEqual([[5, "fired"]]); // the clear run restarted at minute 8
    expect(state.phase).toBe("firing");
    expect(run([[0, true], [5, true], [6, false], [7, true], [8, false], [10, false]]).out).toEqual([[5, "fired"], [10, "resolved"]]);
  });

  it("`clear` 0 resolves on the first false reading; after a resolve it can fire again", () => {
    const t = { ...timing, clearMs: 0 };
    expect(run([[0, true], [5, true], [6, false], [7, true], [12, true]], t).out).toEqual([[5, "fired"], [6, "resolved"], [12, "fired"]]);
  });

  it("does not renotify on the tick that starts the clear", () => {
    expect(run([[0, true], [5, true], [70, false]]).out).toEqual([[5, "fired"]]);
  });
});

describe("step: unknown readings hold the last decided condition", () => {
  it("an unknown reading keeps a pending run counting, and never starts one", () => {
    expect(run([[0, true], [3, "unknown"], [5, "unknown"]]).out).toEqual([[5, "fired"]]);
    expect(run([[0, "unknown"], [10, "unknown"]]).out).toEqual([]);
  });

  it("an unknown reading does not clear a firing alert, however long it lasts", () => {
    expect(run([[0, true], [5, true], [6, "unknown"], [60, "unknown"]]).out).toEqual([[5, "fired"]]);
  });

  it("an unknown reading after a false one keeps counting the clear", () => {
    expect(run([[0, true], [5, true], [6, false], [8, "unknown"]]).out).toEqual([[5, "fired"], [8, "resolved"]]);
  });
});

describe("step: robustness", () => {
  it("time going backwards counts as no time passing (never an early fire, resolve or renotify)", () => {
    expect(run([[10, true], [5, true], [6, true]]).out).toEqual([]);
    expect(run([[0, true], [5, true], [-30, true]]).out).toEqual([[5, "fired"]]);
    expect(run([[0, true], [5, true], [6, false], [-30, false]]).out).toEqual([[5, "fired"]]);
  });

  it("is a pure function: the input state is never mutated and the same inputs give the same result", () => {
    const state: AlertState = { phase: "firing", since: T0, clearSince: null, lastNotifiedAt: T0, lastCondition: true };
    const frozen = JSON.stringify(state);
    const a = step(state, false, T0 + 3 * MIN, timing);
    const b = step(state, false, T0 + 3 * MIN, timing);
    expect(JSON.stringify(state)).toBe(frozen);
    expect(a).toEqual(b);
    expect(Object.isFrozen(INITIAL_ALERT_STATE)).toBe(true);
  });

  it("a persisted state reloaded after a restart does not re-fire: it carries on exactly as before", () => {
    const first = run([[0, true], [5, true], [10, true]]);
    const reloaded = JSON.parse(JSON.stringify(first.state)) as AlertState;
    // Continuing from the reloaded state gives the same as never having restarted.
    const straight = run([[0, true], [5, true], [10, true], [11, true], [65, true]]);
    const resumed = run([[11, true], [65, true]], timing, reloaded);
    expect(resumed.out).toEqual(straight.out.filter(([m]) => m >= 11));
    expect(resumed.out.some(([, t]) => t === "fired")).toBe(false);
  });
});

describe("resumeAfterSuppression (the game was paused or unreachable)", () => {
  it("drops a pending run (the condition was not observed during the gap), and notifies nothing", () => {
    const pending = run([[0, true], [3, true]]).state;
    expect(resumeAfterSuppression(pending)).toEqual(INITIAL_ALERT_STATE);
  });

  it("keeps a firing alert firing (silence is not a resolve) but forgets a half-way clear", () => {
    const clearing = run([[0, true], [5, true], [6, false]]).state;
    expect(clearing.clearSince).not.toBeNull();
    const resumed = resumeAfterSuppression(clearing);
    expect(resumed).toMatchObject({ phase: "firing", clearSince: null, lastNotifiedAt: T0 + 5 * MIN });
    // The gap does not count towards clearMs: it needs the full clear duration again.
    expect(run([[100, false], [101.999, false]], timing, resumed).out).toEqual([]);
    expect(run([[100, false], [102, false]], timing, resumed).out).toEqual([[102, "resolved"]]);
  });

  it("leaves an ok machine alone", () => {
    expect(resumeAfterSuppression(INITIAL_ALERT_STATE)).toBe(INITIAL_ALERT_STATE);
  });
});

describe("belowWithHysteresis", () => {
  it("fires below the fire line, clears above the clear line, and holds in the band", () => {
    expect(belowWithHysteresis(85, false, 90, 95)).toBe(true);
    expect(belowWithHysteresis(97, true, 90, 95)).toBe(false);
    expect(belowWithHysteresis(92, true, 90, 95)).toBe(true); // in the band: as before
    expect(belowWithHysteresis(92, false, 90, 95)).toBe(false);
    expect(belowWithHysteresis(90, false, 90, 95)).toBe(false); // not strictly below
    expect(belowWithHysteresis(95, true, 90, 95)).toBe(true); // not strictly above
  });

  it("a value that is not a number holds the previous answer", () => {
    expect(belowWithHysteresis(Number.NaN, true, 90, 95)).toBe(true);
    expect(belowWithHysteresis(Infinity, false, 90, 95)).toBe(false);
  });
});

// ---- the property test: random condition sequences against the machine's promises -------------------------------

/** A small deterministic PRNG (mulberry32), so a failure is reproducible from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("property: random sequences never break the promises", () => {
  const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

  it.each([
    ["for 5, clear 2, repeat 60", timing],
    ["edge (for 0), clear 0, repeat 10", { forMs: 0, clearMs: 0, repeatMs: 10 * MIN }],
    ["for 1, clear 10, repeat 1", { forMs: MIN, clearMs: 10 * MIN, repeatMs: MIN }],
  ] as const)("%s", (_name, t) => {
    for (const seed of SEEDS) {
      const random = rng(seed);
      let state = INITIAL_ALERT_STATE;
      let now = T0;
      let trueSince: number | null = null; // start of the current unbroken run of true readings
      let falseSince: number | null = null; // start of the current unbroken run of false readings
      let lastCondition = false;
      let firing = false;
      let lastNotified: number | null = null;
      for (let i = 0; i < 300; i++) {
        now += Math.floor(random() * 4 * MIN); // 0 to 4 minutes, sometimes 0 (repeated timestamps)
        const roll = random();
        const condition: boolean | "unknown" = roll < 0.15 ? "unknown" : roll < 0.6;
        const held: boolean = condition === "unknown" ? lastCondition : condition;
        if (held) {
          if (!lastCondition || trueSince === null) trueSince = now;
          falseSince = null;
        } else {
          if (lastCondition || falseSince === null) falseSince = now;
          trueSince = null;
        }
        lastCondition = held;
        const result = step(state, condition, now, t);
        state = result.state;
        const tag = `seed ${seed} step ${i} t=${(now - T0) / MIN}m`;
        if (result.transition === "fired") {
          expect(firing, `${tag}: fired while already firing`).toBe(false);
          expect(held, `${tag}: fired on a false reading`).toBe(true);
          expect(now - (trueSince as number), `${tag}: fired before it held for ${t.forMs} ms`).toBeGreaterThanOrEqual(t.forMs);
          firing = true;
          lastNotified = now;
        } else if (result.transition === "renotify") {
          expect(firing, `${tag}: renotify while not firing`).toBe(true);
          expect(held, `${tag}: renotify on a false reading`).toBe(true);
          expect(now - (lastNotified as number), `${tag}: renotify inside the repeat interval`).toBeGreaterThanOrEqual(t.repeatMs);
          lastNotified = now;
        } else if (result.transition === "resolved") {
          expect(firing, `${tag}: resolved while not firing`).toBe(true);
          expect(held, `${tag}: resolved on a true reading`).toBe(false);
          expect(now - (falseSince as number), `${tag}: resolved before ${t.clearMs} ms of false`).toBeGreaterThanOrEqual(t.clearMs);
          firing = false;
          lastNotified = null;
        }
        // No silent state changes: `firing` in the test model always equals the machine's phase.
        expect(state.phase === "firing", `${tag}: phase disagrees (${state.phase})`).toBe(firing);
        if (firing) expect(state.lastNotifiedAt, `${tag}`).toBe(lastNotified);
      }
    }
  });

  it("a state saved to JSON and reloaded at any step gives the same transitions as one that never restarted", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const random = rng(seed);
      const steps: [number, boolean | "unknown"][] = [];
      let now = T0;
      for (let i = 0; i < 120; i++) {
        now += Math.floor(random() * 3 * MIN);
        const roll = random();
        steps.push([now, roll < 0.1 ? "unknown" : roll < 0.6]);
      }
      const play = (restartEvery: number | null) => {
        let state = INITIAL_ALERT_STATE;
        const out: string[] = [];
        steps.forEach(([at, condition], i) => {
          if (restartEvery !== null && i % restartEvery === 0) state = JSON.parse(JSON.stringify(state)) as AlertState;
          const result = step(state, condition, at, timing);
          state = result.state;
          if (result.transition) out.push(`${i}:${result.transition}`);
        });
        return out;
      };
      expect(play(3), `seed ${seed}`).toEqual(play(null));
      expect(play(1), `seed ${seed}`).toEqual(play(null));
    }
  });
});
