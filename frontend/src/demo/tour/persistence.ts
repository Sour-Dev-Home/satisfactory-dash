/**
 * Whether this browser has seen the demo's tour (ADR-0065 Decision 7). `demo.tour` = "seen" in localStorage, written
 * when the tour starts, so a reload half-way does not start it again. Storage can be missing or throw (private mode,
 * blocked site data): every read and write is in a try/catch, as planner/graph/plannerPrefs.ts does, and a module-level
 * flag still stops a second automatic start within one page load. Across visits it may then show again (accepted).
 */
export const TOUR_STORAGE_KEY = "demo.tour";
export const TOUR_SEEN = "seen";

/** The one path where the tour starts by itself: the Overview, never a deep link (owner's answer 1). */
export const TOUR_AUTO_START_PATH = "/app";

let startedThisLoad = false;

function read(): string | null {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** True once the tour has started in this page load, or this browser has it stored as seen. */
export function hasSeenTour(): boolean {
  return startedThisLoad || read() === TOUR_SEEN;
}

/** Called as the tour starts (by itself or from the banner). */
export function markTourSeen(): void {
  startedThisLoad = true;
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, TOUR_SEEN);
  } catch {
    // Private mode or blocked site data: the module flag holds for this page load only.
  }
}

/** Whether the tour should start by itself at this path: exactly the Overview, and never seen. */
export function shouldAutoStart(pathname: string): boolean {
  return pathname === TOUR_AUTO_START_PATH && !hasSeenTour();
}

/** Tests only: forget this page load's start, as a fresh load would. */
export function resetTourLoadForTests(): void {
  startedThisLoad = false;
}
