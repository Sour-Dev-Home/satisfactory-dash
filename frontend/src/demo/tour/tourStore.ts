import { useSyncExternalStore } from "react";

/**
 * Whether the demo's tour runs (ADR-0065 Decision 3). A tiny store in the eager bundle, so the banner's "Take the tour"
 * button can start a tour whose host (TourHost) is a lazy chunk. `run` counts starts: a start while a tour runs begins
 * it again from the first step. `hostReady` says a host is mounted (the signed-in app), so the button is shown only where
 * it can do something.
 */
export interface TourSnapshot {
  readonly active: boolean;
  readonly run: number;
  readonly hostReady: boolean;
}

let snapshot: TourSnapshot = { active: false, run: 0, hostReady: false };
/** Where focus was when the tour started, to go back to on leaving (Decision 9). */
let returnFocus: HTMLElement | null = null;
let hosts = 0;
const listeners = new Set<() => void>();

function set(next: Partial<TourSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getTourSnapshot = (): TourSnapshot => snapshot;

/** Starts the tour from its first step. `from` is where focus goes back to when it ends; by default, what has it now. */
export function startTour(from?: HTMLElement | null): void {
  const active = document.activeElement;
  returnFocus = from ?? (active instanceof HTMLElement && active !== document.body ? active : null);
  set({ active: true, run: snapshot.run + 1 });
}

/** Ends the tour (Skip, Finish, Escape) and hands back the element focus should return to, if it is still there. */
export function stopTour(): HTMLElement | null {
  const to = returnFocus?.isConnected ? returnFocus : null;
  returnFocus = null;
  if (snapshot.active) set({ active: false });
  return to;
}

/** TourHost registers while mounted; returns the unregister. */
export function registerTourHost(): () => void {
  hosts += 1;
  if (!snapshot.hostReady) set({ hostReady: true });
  return () => {
    hosts -= 1;
    // Checked a task later: StrictMode unmounts and remounts the host at once, and that must not end a tour just started.
    // A host really gone (signed out) ends the tour, so the next sign-in does not resume it.
    setTimeout(() => {
      if (hosts === 0 && (snapshot.hostReady || snapshot.active)) set({ hostReady: false, active: false });
    }, 0);
  };
}

export function useTour(): TourSnapshot {
  return useSyncExternalStore(subscribeTour, getTourSnapshot, getTourSnapshot);
}

/** Tests only. */
export function resetTourStoreForTests(): void {
  hosts = 0;
  returnFocus = null;
  snapshot = { active: false, run: 0, hostReady: false };
  for (const listener of listeners) listener();
}
