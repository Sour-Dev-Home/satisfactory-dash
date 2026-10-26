/**
 * The order of a graceful stop, apart from the process (`server.ts` wires it). Each step waits for the one before:
 *
 * 1. the workers that hold no lock stop (pollers, metrics flush), while requests drain;
 * 2. the HTTP server has closed, so no request here can still commit a write;
 * 3. the leader lock is released (ADR-0054 D3.10): the task that takes it next reloads its server list and sees every
 *    write this one made. Until then this process stays the one leader;
 * 4. the database pool closes, last, after everything that writes through it.
 *
 * A step that throws or rejects never stops the next. The whole is bounded by `timeoutMs`, after which it resolves anyway
 * (a session-scoped lock is released when the process exits).
 */
export function orderedShutdown(steps: {
  stopWorkers: () => Promise<unknown>;
  httpClosed: Promise<unknown>;
  releaseLeaderLock: () => Promise<unknown>;
  closeDatabase: () => Promise<unknown>;
  timeoutMs: number;
}): Promise<void> {
  const settle = (step: () => Promise<unknown>) => Promise.allSettled([Promise.resolve().then(step)]);
  const ordered = settle(steps.stopWorkers)
    .then(() => Promise.allSettled([steps.httpClosed]))
    .then(() => settle(steps.releaseLeaderLock))
    .then(() => settle(steps.closeDatabase))
    .then(() => undefined);
  return Promise.race([ordered, new Promise<void>((resolve) => setTimeout(resolve, steps.timeoutMs).unref())]);
}
