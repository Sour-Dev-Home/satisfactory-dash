import { describe, it, expect } from "vitest";
import { formatErrorDetail } from "./formatErrorDetail.js";

describe("formatErrorDetail", () => {
  it("stringifies a plain Error the same way String(err) does", () => {
    expect(formatErrorDetail(new Error("boom"))).toBe("Error: boom");
  });

  it("includes the wrapped causes for an AggregateError with a message", () => {
    const err = new AggregateError([new Error("a"), new Error("b")], "multiple failures");
    expect(formatErrorDetail(err)).toBe("AggregateError: multiple failures (Error: a; Error: b)");
  });

  it("falls back to a bare 'AggregateError' base when the message is empty, but still includes causes", () => {
    const err = new AggregateError([new Error("connect ECONNREFUSED")], "");
    expect(formatErrorDetail(err)).toBe("AggregateError (Error: connect ECONNREFUSED)");
  });

  it("handles an AggregateError with zero wrapped errors", () => {
    const err = new AggregateError([], "empty");
    expect(formatErrorDetail(err)).toBe("AggregateError: empty");
  });

  it("passes non-Error values through String() unchanged", () => {
    expect(formatErrorDetail("plain string")).toBe("plain string");
    expect(formatErrorDetail(42)).toBe("42");
  });

  // Not currently reachable from any code path in this codebase (no `Promise.any`
  // usage, and Node's own happy-eyeballs dual-stack connect only ever throws a flat,
  // one-level AggregateError) — but the helper's own doc comment frames it as a
  // general-purpose formatter "regardless of which error shape the adapter/service
  // threw", and a future `Promise.any([...])` over calls that each independently
  // throw AggregateError (e.g. two https.request-based adapter calls racing) would
  // produce exactly this shape. `formatErrorDetail` maps over `.errors` with itself
  // (recursively) rather than `String(cause)`, so a nested AggregateError unwraps at
  // every depth instead of collapsing back to a bare "AggregateError" one level down.
  it("recursively unwraps a nested AggregateError instead of collapsing it back to a bare string", () => {
    const inner = new AggregateError([new Error("ECONNREFUSED 127.0.0.1"), new Error("ECONNREFUSED ::1")], "");
    const outer = new AggregateError([inner, new Error("other failure")], "");
    const detail = formatErrorDetail(outer);
    expect(detail).not.toContain("(AggregateError;");
    expect(detail).toContain("ECONNREFUSED 127.0.0.1");
    expect(detail).toContain("ECONNREFUSED ::1");
  });

  // Found by an independent CI review pass: global fetch (used by FrmApiClient, the
  // primary transport per docs-vault) throws `TypeError: fetch failed` with the real
  // reason only on `.cause`, not in `.message`. Before this, formatErrorDetail's
  // AggregateError-only handling meant /api/factory and /api/power silently lost
  // diagnostic detail that /api/status (the AggregateError path) already had.
  it("includes a chained Error.cause, e.g. Node's fetch-failure shape", () => {
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:8080");
    const err = new TypeError("fetch failed", { cause });
    expect(formatErrorDetail(err)).toBe(
      "TypeError: fetch failed (caused by: Error: connect ECONNREFUSED 127.0.0.1:8080)",
    );
  });

  it("recurses through a multi-level Error.cause chain", () => {
    const root = new Error("ECONNREFUSED");
    const middle = new Error("fetch failed", { cause: root });
    const top = new TypeError("request failed", { cause: middle });
    expect(formatErrorDetail(top)).toBe(
      "TypeError: request failed (caused by: Error: fetch failed (caused by: Error: ECONNREFUSED))",
    );
  });

  it("does not append a cause clause when .cause is absent", () => {
    expect(formatErrorDetail(new Error("plain"))).toBe("Error: plain");
  });

  it("does not append a cause clause when .cause is explicitly undefined", () => {
    expect(formatErrorDetail(new Error("plain", { cause: undefined }))).toBe("Error: plain");
  });

  // Found by a review pass: `{ cause: null }` is a valid, explicit value (distinct
  // from omitting cause entirely) and the old `!== undefined` guard let it through,
  // recursing into formatErrorDetail(null) and appending the literal "(caused by:
  // null)" -- undiagnostic noise, not the absence-of-cause case it should be.
  it("does not append a cause clause when .cause is explicitly null", () => {
    expect(formatErrorDetail(new Error("plain", { cause: null }))).toBe("Error: plain");
  });

  // Found by a review pass: the AggregateError branch returned before ever checking
  // err.cause, since AggregateError.cause is independent of its .errors array. An
  // AggregateError can have both an empty .errors and its own .cause (e.g.
  // constructed as `new AggregateError([], "msg", { cause })`).
  it("includes an AggregateError's own .cause even when .errors is empty", () => {
    const cause = new Error("root cause");
    const err = new AggregateError([], "wrapper", { cause });
    expect(formatErrorDetail(err)).toBe("AggregateError: wrapper (caused by: Error: root cause)");
  });

  it("includes an AggregateError's own .cause alongside its wrapped .errors", () => {
    const cause = new Error("root cause");
    const err = new AggregateError([new Error("a")], "wrapper", { cause });
    expect(formatErrorDetail(err)).toBe("AggregateError: wrapper (Error: a) (caused by: Error: root cause)");
  });

  // Found by a review pass: the recursive .cause/.errors traversal had no cycle
  // guard, so a cyclic chain (constructed here, but reachable if any future code
  // path ever built one) would overflow the stack -- crashing the route uncaught
  // instead of degrading gracefully, which defeats the entire point of this helper
  // being "the last line of defense" in every route's catch block.
  it("returns '[circular]' instead of overflowing the stack on a cyclic cause chain", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b", { cause: a });
    a.cause = b;
    expect(() => formatErrorDetail(a)).not.toThrow();
    expect(formatErrorDetail(a)).toContain("[circular]");
  });

  it("returns '[circular]' for a cyclic AggregateError chain", () => {
    const inner: AggregateError & { cause?: unknown } = new AggregateError([], "inner");
    const outer = new AggregateError([inner], "outer");
    inner.cause = outer;
    expect(() => formatErrorDetail(outer)).not.toThrow();
    expect(formatErrorDetail(outer)).toContain("[circular]");
  });

  it("still resolves a long, non-cyclic chain correctly (cycle guard doesn't misfire on depth alone)", () => {
    let err: Error = new Error("root");
    for (let i = 0; i < 50; i++) {
      err = new Error(`level ${i}`, { cause: err });
    }
    const detail = formatErrorDetail(err);
    expect(detail).not.toContain("[circular]");
    expect(detail).toContain("Error: root");
  });

  // Found by a second review pass: the same object appearing twice as unrelated
  // SIBLINGS (not a real cycle) was mislabeled "[circular]" -- the earlier `seen`
  // set persisted across the whole traversal instead of just the current recursion
  // path. Plausible in practice: a dual-stack connect failure's two attempts could
  // share an underlying error object.
  it("does not mislabel a repeated sibling (not a real cycle) as circular", () => {
    const shared = new Error("ECONNREFUSED");
    const err = new AggregateError([shared, shared], "both attempts failed");
    expect(formatErrorDetail(err)).toBe(
      "AggregateError: both attempts failed (Error: ECONNREFUSED; Error: ECONNREFUSED)",
    );
  });

  it("still detects a genuine cycle after fixing the sibling false-positive", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b", { cause: a });
    a.cause = b;
    expect(formatErrorDetail(a)).toContain("[circular]");
  });

  // Found by a second review pass: the doc comment promises this function "must
  // never itself throw", but three adversarial inputs broke that promise -- String()
  // itself can throw (a null-prototype object has no inherited toString), reading
  // .cause can throw (a getter that throws), and a value's own toString() can throw.
  // The first and third are now handled even better than "doesn't crash": since
  // both inputs are non-Error objects, the JSON.stringify fallback added in a later
  // pass (see below) produces real output ("{}" -- JSON.stringify neither needs
  // toString() nor calls it) instead of needing the generic catch-all at all.
  it("does not throw on a null-prototype object, where String() itself would throw", () => {
    const err: unknown = Object.create(null);
    expect(() => formatErrorDetail(err)).not.toThrow();
    expect(formatErrorDetail(err)).toBe("{}");
  });

  // Found by a fourth review pass: a single global try/catch meant ANY failure
  // anywhere in the tree replaced the whole result with "[unformattable error]" --
  // including a throwing .cause getter, which lost an otherwise-fine top-level
  // message for no reason (readCauseSafely now contains that specific failure).
  it("keeps the top-level message when reading .cause throws, instead of losing it entirely", () => {
    const err = new Error("boom");
    Object.defineProperty(err, "cause", {
      get() {
        throw new Error("cause getter exploded");
      },
    });
    expect(() => formatErrorDetail(err)).not.toThrow();
    expect(formatErrorDetail(err)).toBe("Error: boom");
  });

  it("does not throw when a thrown value's toString() would throw (JSON.stringify never calls it)", () => {
    const err = {
      toString() {
        throw new Error("toString exploded");
      },
    };
    expect(() => formatErrorDetail(err)).not.toThrow();
    expect(formatErrorDetail(err)).toBe("{}");
  });

  // A value JSON.stringify itself can't handle (e.g. a BigInt property) falls back
  // to String() within the same branch -- which still succeeds for an ordinary
  // object, so this never needs the outer catch-all at all.
  it("falls back to String() when JSON.stringify itself throws on a non-Error value", () => {
    const err = { value: 10n };
    expect(() => formatErrorDetail(err)).not.toThrow();
    expect(formatErrorDetail(err)).toBe("[object Object]");
  });

  // Found by a third review pass: a non-Error value used directly as a `.cause`
  // (e.g. a plain object some other library throws) went through String(), which
  // degrades an object to the useless "[object Object]" -- the same kind of lost
  // detail this whole helper exists to prevent. JSON.stringify gives something
  // actually diagnostic instead.
  it("JSON-stringifies a non-Error cause instead of degrading to '[object Object]'", () => {
    const err = new Error("top", { cause: { code: "ECONNRESET", errno: -104 } });
    expect(formatErrorDetail(err)).toBe('Error: top (caused by: {"code":"ECONNRESET","errno":-104})');
  });

  it("falls back to String() if a non-Error cause isn't JSON-serializable", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const err = new Error("top", { cause: cyclic });
    expect(() => formatErrorDetail(err)).not.toThrow();
    expect(formatErrorDetail(err)).toContain("caused by:");
  });

  // Found by a fourth review pass: JSON.stringify returns `undefined` (not a
  // string, and without throwing) when a value's toJSON() returns undefined --
  // legal JS, and JSON.stringify's real return type is `string | undefined`
  // despite its TS signature. Left unguarded, this made formatErrorDetail itself
  // return a non-string (breaking its "always a string" contract), and made a
  // cause clause read the literal text "(caused by: undefined)".
  it("falls back to String() rather than returning undefined when toJSON() returns undefined", () => {
    const err = { toJSON: () => undefined };
    const result = formatErrorDetail(err);
    expect(typeof result).toBe("string");
    expect(result).not.toBe("undefined");
  });

  it("does not render a literal 'undefined' cause clause when the cause's toJSON() returns undefined", () => {
    const cause = { toJSON: () => undefined };
    const err = new Error("top", { cause });
    expect(formatErrorDetail(err)).not.toContain("caused by: undefined)");
  });

  // Found by a fourth review pass: the old single global try/catch meant one bad
  // sibling in an AggregateError's .errors wiped out every other (good) sibling's
  // detail too. Each child is now formatted independently via formatChildSafely.
  it("keeps a good sibling's detail when another sibling in the same AggregateError fails to format", () => {
    const badSibling = {
      toJSON() {
        throw new Error("toJSON exploded");
      },
      toString() {
        throw new Error("toString exploded");
      },
    };
    const err = new AggregateError([new Error("ECONNREFUSED"), badSibling], "");
    const result = formatErrorDetail(err);
    expect(result).toContain("ECONNREFUSED");
    expect(result).toContain("[error formatting nested value]");
  });

  // Found by a fourth review pass: a very deep, non-cyclic cause chain overflows
  // the stack, and the old single global catch turned that into total message
  // loss. Each level's formatChildSafely now contains the overflow to just the
  // nested piece where it happens, so shallower levels (including the top) survive.
  it("keeps the top-level message when a very deep cause chain overflows the stack", () => {
    let err: Error = new Error("root");
    for (let i = 0; i < 20000; i++) {
      err = new Error(`level ${i}`, { cause: err });
    }
    const result = formatErrorDetail(err);
    expect(typeof result).toBe("string");
    expect(result.startsWith("Error: level 19999")).toBe(true);
  });

  // Found by a fifth review pass: .errors is a writable property, so
  // `err.errors = null` is legal. The un-guarded .map() call then threw outside any
  // formatChildSafely boundary of its own, propagating past this function and
  // losing the base AggregateError message too -- exactly the class of bug the
  // previous pass's fix was supposed to have closed everywhere.
  it("keeps the base message when an AggregateError's .errors has been replaced by a non-array", () => {
    const err = new AggregateError([new Error("a")], "wrapper message");
    // @ts-expect-error -- deliberately corrupting .errors to test the guard
    err.errors = null;
    expect(() => formatErrorDetail(err)).not.toThrow();
    expect(formatErrorDetail(err)).toBe("AggregateError: wrapper message");
  });

  // Found by a fifth review pass: JSON.stringify serializes an Error to "{}" (its
  // message/stack aren't enumerable own properties), so an Error nested INSIDE a
  // plain-object cause (e.g. `{ inner: new Error(...) }`, rather than being the
  // cause itself) silently lost its message. The replacer now expands any nested
  // Error before stringifying.
  it("keeps a nested Error's message when it's inside a plain-object cause, not the cause itself", () => {
    const err = new Error("outer", { cause: { inner: new Error("ECONNRESET details") } });
    const result = formatErrorDetail(err);
    expect(result).toContain("ECONNRESET details");
    expect(result).not.toContain('"inner":{}');
  });

  // Found by a sixth review pass, extending the fifth pass's fix: the replacer
  // projected a nested Error down to just { name, message }, dropping ITS OWN
  // .cause -- the exact ECONNREFUSED-style detail this whole helper exists to
  // keep, just one level deeper than the fifth pass's fix reached.
  it("keeps a nested Error's own .cause, not just its message, inside a plain-object cause", () => {
    const innerCause = new Error("ECONNREFUSED 127.0.0.1:8080");
    const err = new Error("outer", { cause: { inner: new Error("fetch failed", { cause: innerCause }) } });
    const result = formatErrorDetail(err);
    expect(result).toContain("ECONNREFUSED 127.0.0.1:8080");
  });

  // Found by a sixth review pass: err.message was read directly in the
  // AggregateError base-string construction. A throwing .message getter aborted
  // that whole branch before .errors (which could still format fine on its own)
  // was ever reached -- the same class of bug already fixed for .cause and
  // .errors itself, just on the third property this branch reads.
  it("still formats .errors when an AggregateError's own .message getter throws", () => {
    const err = new AggregateError([new Error("ECONNREFUSED")], "");
    Object.defineProperty(err, "message", {
      get() {
        throw new Error("message getter exploded");
      },
    });
    const result = formatErrorDetail(err);
    expect(result).not.toBe("[unformattable error]");
    expect(result).toContain("ECONNREFUSED");
  });
});
