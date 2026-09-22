/**
 * `String(err)` loses information for two error shapes this codebase actually
 * produces:
 * - A Node `AggregateError` — the vanilla API client's connection failure (from
 *   `https.request`'s dual-stack happy-eyeballs connect attempt) surfaces as one
 *   whose `.message` is often empty, so `String(err)` degrades to the bare,
 *   undiagnostic string "AggregateError" instead of including the wrapped `.errors`.
 * - An `Error.cause` chain — `FrmApiClient` uses global `fetch`, which throws
 *   `TypeError: fetch failed` with the real underlying reason (e.g. `ECONNREFUSED`)
 *   only on `.cause`, not in `.message`. Without unwrapping this, the two FRM-backed
 *   routes (`/api/factory`, `/api/power` — the primary transport per docs-vault) lose
 *   exactly the diagnostic detail this helper exists to preserve.
 * Used by every route's error response so `detail` stays useful regardless of which
 * error shape the adapter/service threw.
 *
 * This is the last line of defense in every route's catch block, so it must never
 * itself throw — the outer wrapper below guarantees that even against adversarial
 * inputs (a null-prototype object, a `cause` getter that throws, a `toString()` that
 * throws), falling back to a fixed string rather than propagating.
 */
export function formatErrorDetail(err: unknown): string {
  try {
    return formatErrorDetailUnsafe(err, new Set());
  } catch {
    return "[unformattable error]";
  }
}

/**
 * @param seen Tracks the *current recursion path* (objects whose formatting is
 *   still in progress), not every object ever visited — each call removes itself
 *   from `seen` before returning (see the `finally` below), so the same object
 *   appearing twice as unrelated siblings (e.g. `new AggregateError([e, e])`) isn't
 *   mistaken for a cycle. Only a genuine ancestor-to-descendant cycle returns
 *   "[circular]".
 */
function formatErrorDetailUnsafe(err: unknown, seen: Set<unknown>): string {
  if (err === null || typeof err !== "object") {
    return String(err);
  }
  if (seen.has(err)) {
    return "[circular]";
  }
  seen.add(err);
  try {
    if (err instanceof AggregateError) {
      const base = err.message ? `AggregateError: ${err.message}` : "AggregateError";
      const causes = err.errors.map((cause) => formatErrorDetailUnsafe(cause, seen));
      const withCauses = causes.length > 0 ? `${base} (${causes.join("; ")})` : base;
      // AggregateError has its own .cause independent of .errors -- an earlier
      // version returned early inside this branch and never checked for it.
      if (err.cause != null) {
        return `${withCauses} (caused by: ${formatErrorDetailUnsafe(err.cause, seen)})`;
      }
      return withCauses;
    }
    // `!= null` (not `!== undefined`) so an explicit `{ cause: null }` -- a valid
    // value to set -- doesn't recurse into formatting the literal string "null".
    if (err instanceof Error && err.cause != null) {
      return `${String(err)} (caused by: ${formatErrorDetailUnsafe(err.cause, seen)})`;
    }
    if (err instanceof Error) {
      return String(err);
    }
    // A non-Error object used directly as a `.cause` (e.g. `{ code: "ECONNRESET" }`)
    // -- String() on these degrades to the useless "[object Object]". Try
    // JSON.stringify for something actually diagnostic; if that itself throws (a
    // BigInt, a getter that throws, its own cycle unrelated to `seen`), fall back to
    // String() rather than let it propagate -- the outer wrapper would catch it
    // anyway, but this keeps the fallback local and predictable.
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  } finally {
    seen.delete(err);
  }
}
