/**
 * The window's lifecycle (ADR-0040 decision 4): closing hides it to the tray, Quit leaves the server running, and
 * "Stop server and quit" does the clean stop first. Pure, so it is tested without Electron.
 */
import type { StopOutcome } from "./supervisor";

/** Passed by the Start with Windows login item: the app starts in the tray, with no window shown. */
export const HIDDEN_ARG = "--hidden";

export const CLOSE_NOTE_TITLE = "Still running in the tray";
export const CLOSE_NOTE_BODY =
  "The server manager keeps running here. Right-click the tray icon for Open, Start, Stop, Restart or Quit.";

/** What closing the window does: hide it unless the app is quitting, with the note the first time only. */
export function closeAction(opts: { quitting: boolean; noteShown: boolean }): { hide: boolean; note: boolean } {
  if (opts.quitting) return { hide: false, note: false };
  return { hide: true, note: !opts.noteShown };
}

export function startsHidden(argv: readonly string[]): boolean {
  return argv.includes(HIDDEN_ARG);
}

/**
 * The clean stop, then quit once the server is gone. When it can't save (no token, or SaveGame failed) the app stays
 * open: the window then offers "Stop anyway", and the caller shows it.
 */
export async function stopServerAndQuit(deps: { stop: () => Promise<StopOutcome>; quit: () => void }): Promise<StopOutcome> {
  const outcome = await deps.stop();
  if (outcome === "stopped") deps.quit();
  return outcome;
}
