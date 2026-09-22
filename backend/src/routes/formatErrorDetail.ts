/**
 * `String(err)` loses information for a Node `AggregateError` — e.g. the vanilla API
 * client's connection failure (from `https.request`'s dual-stack happy-eyeballs
 * connect attempt) surfaces as an AggregateError whose `.message` is often empty, so
 * `String(err)` degrades to the bare, undiagnostic string "AggregateError" instead of
 * including the wrapped `.errors`. Used by every route's error response so `detail`
 * stays useful regardless of which error shape the adapter/service threw.
 */
export function formatErrorDetail(err: unknown): string {
  if (err instanceof AggregateError) {
    const base = err.message ? `AggregateError: ${err.message}` : "AggregateError";
    const causes = err.errors.map((cause) => String(cause));
    return causes.length > 0 ? `${base} (${causes.join("; ")})` : base;
  }
  return String(err);
}
