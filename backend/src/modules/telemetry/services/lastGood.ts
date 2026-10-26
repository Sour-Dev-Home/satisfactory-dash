import { ApiFailure } from "../../../platform/errorResponse.js";
import { observed } from "../../../platform/snapshot.js";

/**
 * ADR-0052 section 1.3: request-through parity with the agent store. A server read on every request keeps nothing, so
 * when its game goes down the dashboard would blank. This wraps one read: a success is remembered (one value, in memory
 * only, never persisted: request-through is the local and rollback mode); an `upstream_unreachable` failure returns the
 * remembered value marked stale, with when the run of failures began; with nothing remembered it rethrows (503).
 * Every other failure (auth rejected, invalid response, upstream_error) still throws: those are configuration or
 * contract faults, and old data would hide them and delay the fix.
 */
export function withLastGood<T extends object>(read: () => Promise<T>, now: () => number = Date.now): () => Promise<T> {
  let remembered: { value: T; observedAtMs: number } | undefined;
  let unreachableSinceMs: number | undefined;
  // Calls can overlap. Only the outcome of a call started after the last applied one changes the state, so a slow
  // older call never overwrites a newer value or marks it stale.
  let started = 0;
  let applied = 0;
  return async () => {
    const seq = ++started;
    try {
      const value = await read();
      if (seq > applied) {
        applied = seq;
        remembered = { value, observedAtMs: now() };
        unreachableSinceMs = undefined;
      }
      return value;
    } catch (error) {
      const current = seq > applied;
      if (current) applied = seq;
      if (!(error instanceof ApiFailure) || error.code !== "upstream_unreachable") {
        if (current) unreachableSinceMs = undefined; // the game answered (with a fault), so the run of "unreachable" is over
        throw error;
      }
      if (remembered === undefined) throw error;
      if (!current && unreachableSinceMs === undefined) return remembered.value; // a newer call already succeeded
      unreachableSinceMs ??= now();
      return observed(remembered.value, {
        observedAt: new Date(remembered.observedAtMs).toISOString(),
        stale: true,
        unreachableSince: new Date(unreachableSinceMs).toISOString(),
      });
    }
  };
}
