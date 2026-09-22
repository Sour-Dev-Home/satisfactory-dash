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
 * itself throw and must always return an actual `string` — and a single failure
 * anywhere in a `.cause`/`.errors` tree must not wipe out detail that was already
 * successfully formatted elsewhere in that same tree (a bad sibling in an
 * `AggregateError`, or a `.cause` getter that throws, shouldn't cost you the
 * top-level message). Each recursive call is individually guarded for exactly that
 * reason — see `formatChildSafely` — with the outer `formatErrorDetail` as a last
 * resort for failures at the very top that no inner guard could contain.
 */
export function formatErrorDetail(err: unknown): string {
  try {
    return formatErrorDetailUnsafe(err, new Set());
  } catch {
    return "[unformattable error]";
  }
}

/** Formats a nested value (a `.cause`, or one entry of an `AggregateError`'s
 *  `.errors`) without letting a failure there propagate to the caller — the caller
 *  keeps whatever it already built (e.g. the top-level message) either way. */
function formatChildSafely(value: unknown, seen: Set<unknown>): string {
  try {
    return formatErrorDetailUnsafe(value, seen);
  } catch {
    return "[error formatting nested value]";
  }
}

/** Reads `.cause` without letting a throwing getter propagate. Returns `undefined`
 *  both for a genuinely absent cause and for one that couldn't be read — this
 *  function only decides whether to show a cause clause at all, not why one might
 *  be missing. */
function readCauseSafely(err: Error): unknown {
  try {
    return err.cause;
  } catch {
    return undefined;
  }
}

/** Reads `.message` without letting a throwing getter propagate, so a hostile
 *  AggregateError can't take its own still-formattable `.errors`/`.cause` down
 *  with it by throwing before those are ever reached. */
function readMessageSafely(err: Error): string {
  try {
    return err.message;
  } catch {
    return "";
  }
}

/**
 * @param seen Tracks the *current recursion path* (objects whose formatting is
 *   still in progress), not every object ever visited — each call removes itself
 *   from `seen` before returning (see the `finally` below), so the same object
 *   appearing twice as unrelated siblings (e.g. `new AggregateError([e, e])`) isn't
 *   mistaken for a cycle. Only a genuine ancestor-to-descendant cycle returns
 *   "[circular]". A stack overflow partway down a very deep chain is caught by
 *   whichever `formatChildSafely` call is nearest to it, so it only degrades that
 *   one nested piece to a placeholder rather than losing everything above it.
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
      // Read via readMessageSafely, not err.message directly -- a throwing .message
      // getter used to abort this whole branch before .errors/.cause were even
      // reached, losing siblings that were perfectly formattable on their own.
      const message = readMessageSafely(err);
      const base = message ? `AggregateError: ${message}` : "AggregateError";
      // .errors is a writable property -- if it's ever been replaced with something
      // non-array (e.g. `err.errors = null`), .map() on it throws, and since that
      // throw isn't behind a formatChildSafely boundary of its own, it would
      // otherwise propagate past this function entirely, losing `base` too.
      // Treating a non-array as "no wrapped errors" keeps at least the base message.
      const errors = Array.isArray(err.errors) ? err.errors : [];
      const causes = errors.map((cause) => formatChildSafely(cause, seen));
      const withCauses = causes.length > 0 ? `${base} (${causes.join("; ")})` : base;
      // AggregateError has its own .cause independent of .errors -- an earlier
      // version returned early inside this branch and never checked for it.
      const cause = readCauseSafely(err);
      if (cause != null) {
        return `${withCauses} (caused by: ${formatChildSafely(cause, seen)})`;
      }
      return withCauses;
    }
    if (err instanceof Error) {
      const base = String(err);
      // `!= null` (not `!== undefined`) so an explicit `{ cause: null }` -- a valid
      // value to set -- doesn't recurse into formatting the literal string "null".
      const cause = readCauseSafely(err);
      if (cause != null) {
        return `${base} (caused by: ${formatChildSafely(cause, seen)})`;
      }
      return base;
    }
    // A non-Error object used directly as a `.cause` (e.g. `{ code: "ECONNRESET" }`)
    // -- String() on these degrades to the useless "[object Object]". Try
    // JSON.stringify for something actually diagnostic; if that itself throws (a
    // BigInt, a getter that throws, its own cycle unrelated to `seen`) OR returns
    // `undefined` (e.g. a `toJSON()` that returns `undefined` -- valid JS, and
    // JSON.stringify's real return type is `string | undefined` despite what its
    // TS signature claims), fall back to String() rather than silently return a
    // non-string from a function whose whole contract is "always a string". The
    // replacer expands any Error nested *inside* this object (e.g.
    // `{ inner: new Error(...) }`) -- plain JSON.stringify serializes an Error to
    // "{}" since .message/.stack aren't enumerable, silently dropping exactly the
    // detail this whole function exists to keep. Including `cause` here means
    // JSON.stringify re-applies this same replacer to it if it's itself an Error,
    // so a nested Error's own cause chain expands too, not just its top message.
    try {
      const json = JSON.stringify(err, (_key, value) =>
        value instanceof Error ? { name: value.name, message: value.message, cause: value.cause } : value,
      );
      if (typeof json === "string") {
        return json;
      }
    } catch {
      // fall through to String() below
    }
    return String(err);
  } finally {
    seen.delete(err);
  }
}
