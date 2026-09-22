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

/** Reads `.errors` without letting a throwing getter propagate. Returns `[]` both
 *  when `.errors` isn't an array and when reading it fails outright — either way
 *  there's nothing to safely iterate. */
function readErrorsSafely(err: AggregateError): unknown[] {
  try {
    return Array.isArray(err.errors) ? err.errors : [];
  } catch {
    return [];
  }
}

/** `String(err)` for a plain Error, without letting a throwing `.message`/`.name`
 *  getter propagate — used as the base message so a hostile Error still gets its
 *  `.cause` formatted rather than losing everything. */
function safeErrorString(err: Error): string {
  try {
    return String(err);
  } catch {
    return "[error reading message]";
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
      // non-array (e.g. `err.errors = null`), or is itself a throwing getter,
      // reading/mapping it can throw, and since that throw isn't behind a
      // formatChildSafely boundary of its own, it would otherwise propagate past
      // this function entirely, losing `base` too. readErrorsSafely contains both.
      const errors = readErrorsSafely(err);
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
      // safeErrorString, not String(err) directly -- a throwing .message/.name
      // getter used to lose an otherwise-formattable .cause along with it.
      const base = safeErrorString(err);
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
    // BigInt, its own cycle unrelated to `seen`) OR returns `undefined` (e.g. a
    // `toJSON()` that returns `undefined` -- valid JS, and JSON.stringify's real
    // return type is `string | undefined` despite what its TS signature claims),
    // fall back to String() rather than silently return a non-string from a
    // function whose whole contract is "always a string".
    //
    // The replacer below expands any Error/AggregateError nested *inside* this
    // object (e.g. `{ inner: new Error(...) }`) -- plain JSON.stringify serializes
    // an Error to "{}" since .message/.stack/.errors aren't enumerable, silently
    // dropping exactly the detail this whole function exists to keep.
    //
    // It caps the number of Errors it will expand rather than tracking "seen"
    // objects: a first attempt used a WeakSet that only ever grew, which correctly
    // stopped a self-referential cause from overflowing the stack but then
    // wrongly labeled unrelated SIBLINGS sharing the same Error reference (e.g.
    // `{ a: e, b: e }`) as "[circular]" too -- the exact sibling-vs-cycle mistake
    // already fixed once for the main `seen` set above, reintroduced here because
    // JSON.stringify's replacer API has no "done with this subtree" hook to delete
    // an entry on exit the way `formatChildSafely`'s `finally` block does. A count
    // cap sidesteps the distinction entirely: it still halts unbounded recursion
    // (a genuine cycle re-expands the same Error over and over, so it hits the cap
    // almost immediately), while a handful of unrelated sibling repeats -- nowhere
    // near the cap -- are never mislabeled.
    const MAX_JSON_ERROR_EXPANSIONS = 20;
    try {
      let expansions = 0;
      const json = JSON.stringify(err, (_key: string, value: unknown) => {
        if (!(value instanceof Error)) {
          return value;
        }
        if (expansions >= MAX_JSON_ERROR_EXPANSIONS) {
          return "[error tree too deep]";
        }
        expansions++;
        try {
          if (value instanceof AggregateError) {
            return { name: value.name, message: value.message, cause: value.cause, errors: readErrorsSafely(value) };
          }
          return { name: value.name, message: value.message, cause: value.cause };
        } catch {
          return "[error formatting nested value]";
        }
      });
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
