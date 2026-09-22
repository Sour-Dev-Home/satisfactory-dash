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
 */
/**
 * @param seen Internal only — tracks objects already visited in this call's
 *   recursion so a cyclic `.cause`/`.errors` chain returns "[circular]" instead of
 *   overflowing the stack. This function is the last line of defense in every
 *   route's catch block, so it must never itself throw.
 */
export function formatErrorDetail(err: unknown, seen: Set<unknown> = new Set()): string {
  if (err !== null && typeof err === "object") {
    if (seen.has(err)) {
      return "[circular]";
    }
    seen.add(err);
  }

  if (err instanceof AggregateError) {
    const base = err.message ? `AggregateError: ${err.message}` : "AggregateError";
    const causes = err.errors.map((cause) => formatErrorDetail(cause, seen));
    const withCauses = causes.length > 0 ? `${base} (${causes.join("; ")})` : base;
    // AggregateError has its own .cause independent of .errors -- the previous
    // version returned early inside this branch and never checked for it.
    if (err.cause != null) {
      return `${withCauses} (caused by: ${formatErrorDetail(err.cause, seen)})`;
    }
    return withCauses;
  }
  // `!= null` (not `!== undefined`) so an explicit `{ cause: null }` -- a valid
  // value to set -- doesn't recurse into formatting the literal string "null".
  if (err instanceof Error && err.cause != null) {
    return `${String(err)} (caused by: ${formatErrorDetail(err.cause, seen)})`;
  }
  return String(err);
}
