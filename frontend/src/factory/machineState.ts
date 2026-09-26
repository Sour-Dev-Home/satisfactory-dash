/**
 * The backend's machine `state` (ADR-0027) as a label and a colour token. The label carries the
 * meaning; the colour only repeats it. `state` is a plain string in the contract so a newer
 * backend can add one: anything not listed here is "no state", never a guess.
 */
export interface MachineStateView {
  label: string;
  /** A text colour token class (index.css `@theme`). */
  tone: string;
}

const STATES = {
  producing: { label: "Producing", tone: "text-ok" },
  idle: { label: "Idle", tone: "text-muted" },
  // Backed up is normal in steady-state play (the panel's own note): a warning, never "bad".
  backedUp: { label: "Backed up", tone: "text-warn" },
  // Output below 95% of the rate for the set clock (ADR-0027 amendment 2; it replaced "starved").
  underfed: { label: "Underfed", tone: "text-warn" },
  paused: { label: "Paused", tone: "text-info" },
  unpowered: { label: "Unpowered", tone: "text-bad" },
} satisfies Record<string, MachineStateView>;

export type MachineState = keyof typeof STATES;

/** The view for a known state; null for a missing or unknown one (including "constructor" and friends). */
export function machineState(state: string | undefined): MachineStateView | null {
  return state !== undefined && Object.hasOwn(STATES, state) ? STATES[state as MachineState] : null;
}
