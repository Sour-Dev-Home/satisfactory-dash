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
export function formatErrorDetail(err: unknown): string {
  if (err instanceof AggregateError) {
    const base = err.message ? `AggregateError: ${err.message}` : "AggregateError";
    const causes = err.errors.map((cause) => formatErrorDetail(cause));
    return causes.length > 0 ? `${base} (${causes.join("; ")})` : base;
  }
  if (err instanceof Error && err.cause !== undefined) {
    return `${String(err)} (caused by: ${formatErrorDetail(err.cause)})`;
  }
  return String(err);
}
