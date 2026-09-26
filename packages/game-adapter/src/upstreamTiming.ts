import type { UpstreamCall, UpstreamCallListener } from "./connection.js";

/**
 * ADR-0032 step 1: runs one request to the game server and tells `listener` how long it took, success or failure (a
 * failure that took 5 s to time out is exactly the time the caller waited). The request's own result or error is passed
 * through untouched, and a listener that throws is ignored: timing can never change what a request does.
 */
export async function timedCall<T>(upstream: UpstreamCall["upstream"], listener: UpstreamCallListener | undefined, run: () => Promise<T>): Promise<T> {
  if (listener === undefined) return run();
  const startMs = performance.now();
  try {
    return await run();
  } finally {
    try {
      listener({ upstream, startMs, endMs: performance.now() });
    } catch {
      // Ignored on purpose.
    }
  }
}
