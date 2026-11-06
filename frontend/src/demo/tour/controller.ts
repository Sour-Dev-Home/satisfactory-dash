/**
 * The tour's state (ADR-0065 Decision 3): which step it is on and whether that step's target is still awaited
 * (`waiting`), found and highlighted (`showing`), or given up on after TOUR_TARGET_WAIT_MS and shown centred with no
 * highlight (`fallback`). `shown` is the step the popover shows: while the next step waits, the last one stays on screen
 * (so focus stays on its Next button), and the first step shows nothing until it is found or given up on.
 */
export type TourPhase = "waiting" | "showing" | "fallback";

export interface TourState {
  index: number;
  phase: TourPhase;
  shown: number | null;
}

export type TourAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "found" }
  | { type: "timeout" }
  /** The target went away while showing (a page changed under the tour). */
  | { type: "lost" };

export const INITIAL_TOUR_STATE: TourState = { index: 0, phase: "waiting", shown: null };

/** Where a step starts: waiting for its target, or, when it has none (`centred`), shown centred at once. */
function arrive(state: TourState, index: number, centred: (index: number) => boolean): TourState {
  return centred(index) ? { index, phase: "fallback", shown: index } : { ...state, index, phase: "waiting" };
}

/** The first state over steps where `centred(i)` says step i has no target. */
export const initialTourState = (centred: (index: number) => boolean = () => false): TourState => arrive(INITIAL_TOUR_STATE, 0, centred);

/**
 * A reducer over `count` steps; `centred(i)` says step i has no target (it shows centred at once, nothing awaited). Next
 * on the last step and Back on the first change nothing: the host ends the tour.
 */
export function tourReducer(count: number, centred: (index: number) => boolean = () => false) {
  return (state: TourState, action: TourAction): TourState => {
    switch (action.type) {
      case "next":
        return state.index < count - 1 ? arrive(state, state.index + 1, centred) : state;
      case "back":
        return state.index > 0 ? arrive(state, state.index - 1, centred) : state;
      case "found":
        return state.phase === "showing" && state.shown === state.index ? state : { ...state, phase: "showing", shown: state.index };
      case "timeout":
        return state.phase === "waiting" ? { ...state, phase: "fallback", shown: state.index } : state;
      case "lost":
        return state.phase === "showing" ? { ...state, phase: "fallback" } : state;
    }
  };
}

export const isLastStep = (state: TourState, count: number): boolean => state.index === count - 1;
