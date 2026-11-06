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

/** A reducer over `count` steps. Next on the last step and Back on the first change nothing: the host ends the tour. */
export function tourReducer(count: number) {
  return (state: TourState, action: TourAction): TourState => {
    switch (action.type) {
      case "next":
        return state.index < count - 1 ? { ...state, index: state.index + 1, phase: "waiting" } : state;
      case "back":
        return state.index > 0 ? { ...state, index: state.index - 1, phase: "waiting" } : state;
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
