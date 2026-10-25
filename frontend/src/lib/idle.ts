/** How long after the call an idle task waits before it asks for idle time: the first page's own reads go first. */
export const IDLE_START_DELAY_MS = 2_000;
/** The longest the browser may hold an idle task back once asked (a busy page still gets it, eventually). */
export const IDLE_TIMEOUT_MS = 5_000;

type Connection = { saveData?: boolean; effectiveType?: string };

/**
 * True when the user asked to save data (the Save-Data setting) or the connection is 2G or slower. Speculative
 * downloads are skipped then; what the user asks for still loads. Unknown (most browsers but Chromium): false.
 */
export function savesData(nav: Navigator = navigator): boolean {
  const connection = (nav as Navigator & { connection?: Connection }).connection;
  if (!connection) return false;
  return connection.saveData === true || /(^|-)2g$/.test(connection.effectiveType ?? "");
}

/**
 * Runs `task` once, when the browser is idle after a short start delay, and never when `savesData()`. Without
 * requestIdleCallback (Safari) it runs at the end of the delay. Returns a cancel, for an effect's cleanup.
 */
export function whenIdle(task: () => void): () => void {
  if (savesData()) return () => {};
  let idle: number | undefined;
  const start = setTimeout(() => {
    if (typeof requestIdleCallback === "function") idle = requestIdleCallback(() => task(), { timeout: IDLE_TIMEOUT_MS });
    else task();
  }, IDLE_START_DELAY_MS);
  return () => {
    clearTimeout(start);
    if (idle !== undefined) cancelIdleCallback(idle);
  };
}
