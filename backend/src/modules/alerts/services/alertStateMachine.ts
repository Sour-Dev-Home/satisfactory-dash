/**
 * ADR-0027 decision 4: the alert state machine, pure (no clock, no I/O, no database). One machine per
 * (rule, subject), `ok -> pending -> firing -> ok`:
 *
 * - `ok`: the condition is false (or has not held long enough to matter).
 * - `pending`: the condition became true at `since` and has not yet held for `forMs`.
 * - `firing`: it held for `forMs`; the alert was raised (`fired`) and is re-raised at most once per `repeatMs`
 *   (`renotify`). It resolves (`resolved`) only after the condition has been FALSE for `clearMs` without a break.
 *
 * Every transition is decided from the state and `now` alone, so the same inputs always give the same outputs and a
 * persisted state can be reloaded after a restart without re-firing (`lastNotifiedAt` and `since` survive).
 */

export type Phase = "ok" | "pending" | "firing";

export interface AlertState {
  phase: Phase;
  /** ms epoch the condition first became true in the current run (pending or firing); null while ok. */
  since: number | null;
  /** ms epoch the condition first became false while firing; null while it is true (or not firing). */
  clearSince: number | null;
  /** ms epoch of the last `fired` or `renotify`; null while not firing. */
  lastNotifiedAt: number | null;
  /** The last decided condition, used when a reading is unknown (see `step`). */
  lastCondition: boolean;
}

export interface AlertTiming {
  /** How long the condition must hold before the alert fires. 0 = edge-triggered (fires on the first true reading). */
  forMs: number;
  /** How long it must stay false before a firing alert resolves. 0 = resolves on the first false reading. */
  clearMs: number;
  /** The shortest time between two notifications for one firing alert. */
  repeatMs: number;
}

export type AlertTransition = "fired" | "renotify" | "resolved";

export const INITIAL_ALERT_STATE: AlertState = Object.freeze({
  phase: "ok",
  since: null,
  clearSince: null,
  lastNotifiedAt: null,
  lastCondition: false,
});

export interface StepResult {
  state: AlertState;
  /** What to record and (from PR 6) notify, if anything happened. At most one per step. */
  transition?: AlertTransition;
}

/**
 * One evaluation. `condition` is whether the alert condition is true NOW; `"unknown"` means the data needed to
 * decide is missing (an undecidable machine state, say): the last decided condition is held, never a guess in
 * either direction, and nothing is decided from thin air. `now` must not go backwards; if it does, the machine
 * treats it as no time having passed (durations are clamped at 0) rather than firing early.
 */
export function step(state: AlertState, condition: boolean | "unknown", now: number, timing: AlertTiming): StepResult {
  const held = condition === "unknown" ? state.lastCondition : condition;
  const elapsed = (from: number | null): number => (from === null ? 0 : Math.max(0, now - from));

  switch (state.phase) {
    case "ok": {
      if (!held) {
        return { state: { ...INITIAL_ALERT_STATE, lastCondition: false } };
      }
      if (timing.forMs <= 0) {
        return {
          state: { phase: "firing", since: now, clearSince: null, lastNotifiedAt: now, lastCondition: true },
          transition: "fired",
        };
      }
      return { state: { phase: "pending", since: now, clearSince: null, lastNotifiedAt: null, lastCondition: true } };
    }
    case "pending": {
      if (!held) {
        return { state: { ...INITIAL_ALERT_STATE, lastCondition: false } }; // it never held long enough: silence
      }
      if (elapsed(state.since) >= timing.forMs) {
        return {
          state: { phase: "firing", since: state.since, clearSince: null, lastNotifiedAt: now, lastCondition: true },
          transition: "fired",
        };
      }
      return { state: { ...state, lastCondition: true } };
    }
    case "firing": {
      if (held) {
        const due = state.lastNotifiedAt === null || elapsed(state.lastNotifiedAt) >= timing.repeatMs;
        if (due) {
          return { state: { ...state, clearSince: null, lastNotifiedAt: now, lastCondition: true }, transition: "renotify" };
        }
        return { state: { ...state, clearSince: null, lastCondition: true } };
      }
      const clearSince = state.clearSince ?? now;
      if (elapsed(clearSince) >= timing.clearMs) {
        return { state: { ...INITIAL_ALERT_STATE, lastCondition: false }, transition: "resolved" };
      }
      return { state: { ...state, clearSince, lastCondition: false } };
    }
  }
}

/**
 * The state to continue from after a stretch where the rule was NOT evaluated (the game paused or unreachable:
 * ADR-0027 suppression). A pending run is dropped, because the condition was not observed during the gap and must
 * be seen again; a firing alert keeps firing (silence is not a resolve), but a half-way clear is dropped, so a
 * gap never counts towards `clearMs`. Nothing is notified by resuming.
 */
export function resumeAfterSuppression(state: AlertState): AlertState {
  switch (state.phase) {
    case "ok":
      return state;
    case "pending":
      return { ...INITIAL_ALERT_STATE };
    case "firing":
      return { ...state, clearSince: null };
  }
}

/**
 * A threshold with a hysteresis band, for conditions on a measured value (ADR-0027: "fire below 90% of the
 * target, clear above 95%"). Inside the band the previous answer stands, so a value hovering near the line does not
 * flap. `fireBelow` must be <= `clearAbove`.
 */
export function belowWithHysteresis(value: number, previouslyTrue: boolean, fireBelow: number, clearAbove: number): boolean {
  if (!Number.isFinite(value)) return previouslyTrue;
  if (value < fireBelow) return true;
  if (value > clearAbove) return false;
  return previouslyTrue;
}
