import { describe, expect, it } from "vitest";
import { INITIAL_TOUR_STATE, initialTourState, isLastStep, tourReducer, type TourAction, type TourState } from "./controller";

const reduce = tourReducer(3);
const run = (...actions: TourAction[]): TourState => actions.reduce(reduce, INITIAL_TOUR_STATE);

describe("the tour's controller", () => {
  it("starts on the first step, waiting, with nothing shown", () => {
    expect(INITIAL_TOUR_STATE).toEqual({ index: 0, phase: "waiting", shown: null });
  });

  it("shows a step once its target is found, and keeps it shown while the next one waits", () => {
    expect(run({ type: "found" })).toEqual({ index: 0, phase: "showing", shown: 0 });
    expect(run({ type: "found" }, { type: "next" })).toEqual({ index: 1, phase: "waiting", shown: 0 });
    expect(run({ type: "found" }, { type: "next" }, { type: "found" })).toEqual({ index: 1, phase: "showing", shown: 1 });
  });

  it("falls back to a centred step after the timeout, and only while waiting", () => {
    expect(run({ type: "timeout" })).toEqual({ index: 0, phase: "fallback", shown: 0 });
    const shown = run({ type: "found" });
    expect(reduce(shown, { type: "timeout" })).toBe(shown);
  });

  it("a target found after the fallback still gets its highlight", () => {
    expect(run({ type: "timeout" }, { type: "found" })).toEqual({ index: 0, phase: "showing", shown: 0 });
  });

  it("goes to the fallback when a shown target goes away, and ignores a loss while waiting", () => {
    expect(run({ type: "found" }, { type: "lost" })).toEqual({ index: 0, phase: "fallback", shown: 0 });
    expect(run({ type: "lost" })).toEqual(INITIAL_TOUR_STATE);
  });

  it("Back and Next stop at the ends (the host ends the tour on the last Next)", () => {
    expect(run({ type: "back" })).toBe(INITIAL_TOUR_STATE);
    const last = run({ type: "next" }, { type: "next" }, { type: "found" });
    expect(last.index).toBe(2);
    expect(isLastStep(last, 3)).toBe(true);
    expect(reduce(last, { type: "next" })).toBe(last);
    expect(reduce(last, { type: "back" })).toEqual({ index: 1, phase: "waiting", shown: 2 });
  });

  it("a repeated found on the shown step changes nothing", () => {
    const shown = run({ type: "found" });
    expect(reduce(shown, { type: "found" })).toBe(shown);
  });

  it("shows a step with no target centred at once, on arriving by Next, by Back or as the first", () => {
    const centred = (i: number) => i !== 1;
    const reduceC = tourReducer(3, centred);
    const first = initialTourState(centred);
    expect(first).toEqual({ index: 0, phase: "fallback", shown: 0 });
    const second = reduceC(first, { type: "next" });
    expect(second).toEqual({ index: 1, phase: "waiting", shown: 0 });
    expect(reduceC(second, { type: "back" })).toEqual({ index: 0, phase: "fallback", shown: 0 });
    expect(reduceC(reduceC(second, { type: "found" }), { type: "next" })).toEqual({ index: 2, phase: "fallback", shown: 2 });
    // Nothing is awaited there: a late found or timeout changes nothing.
    expect(reduceC(first, { type: "timeout" })).toBe(first);
    expect(initialTourState()).toEqual(INITIAL_TOUR_STATE);
  });
});
