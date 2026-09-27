/**
 * A tab loaded before a deploy asks for lazy chunks the deploy removed (#325). The hosting's SPA
 * fallback answers them with index.html, so the import fails; only a page reload, which fetches
 * the new index.html and its new chunk names, helps. So: reload once, and if a reload just
 * happened and it still fails, the section asks instead (ErrorBoundary), so it never loops.
 */

const RELOAD_KEY = "satis-manager.stale-chunk-reload-at";
/** A second failure within this long of the last reload means reloading didn't help. */
export const RELOAD_GUARD_MS = 60_000;

/**
 * Whether an error is a failed dynamic import: the chunk's request failed or wasn't JavaScript.
 * Browsers word it differently (Chromium, Firefox, Safari), and Vite's preload of a chunk's CSS
 * has its own message.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    error.message,
  );
}

/**
 * Reloads the page unless it was reloaded for this within RELOAD_GUARD_MS; returns whether it did.
 * With no session storage (private mode, blocked site data) it can't remember the reload, so it
 * never reloads and the section asks instead. Nor does it reload offline.
 */
export function reloadOnce(now: number = Date.now(), reload: () => void = () => window.location.reload()): boolean {
  // Offline fails the import the same way, and a reload would swap the app for the browser's
  // offline page. The section asks instead, and the guard stays unset for when it's back online.
  if (!navigator.onLine) return false;
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY));
    if (last > 0 && now - last >= 0 && now - last < RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * Vite dispatches `vite:preloadError` when a lazy import fails. The error is left to reach the
 * section's ErrorBoundary (no preventDefault: that would resolve the import to undefined), which
 * shows "a new version is available" while the reload happens, or if the guard stopped it.
 * Vite fires it for any failed lazy import, including a bug in the module's own code, which a
 * reload wouldn't fix: only a chunk that failed to load (its `payload`) reloads.
 */
export function reloadOnStaleChunk(target: Window = window, reload?: () => void): () => void {
  const onPreloadError = (event: Event) => {
    if (isChunkLoadError((event as Event & { payload?: unknown }).payload)) reloadOnce(Date.now(), reload);
  };
  target.addEventListener("vite:preloadError", onPreloadError);
  return () => target.removeEventListener("vite:preloadError", onPreloadError);
}
