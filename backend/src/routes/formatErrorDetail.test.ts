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
  // never itself throw", but three adversarial inputs broke that promise --
  // String(err) itself can throw (a null-prototype object has no toString), reading
  // .cause can throw (a getter that throws), and a value's own toString() can throw.
  // All three now fall back to a fixed string rather than propagating.
  it("does not throw on a null-prototype object, where String() itself throws", () => {
    const err: unknown = Object.create(null);
    expect(() => formatErrorDetail(err)).not.toThrow();
    expect(formatErrorDetail(err)).toBe("[unformattable error]");
  });

  it("does not throw when reading .cause throws", () => {
    const err = new Error("boom");
    Object.defineProperty(err, "cause", {
      get() {
        throw new Error("cause getter exploded");
      },
    });
    expect(() => formatErrorDetail(err)).not.toThrow();
    expect(formatErrorDetail(err)).toBe("[unformattable error]");
  });

  it("does not throw when a thrown value's toString() throws", () => {
    const err = {
      toString() {
        throw new Error("toString exploded");
      },
    };
    expect(() => formatErrorDetail(err)).not.toThrow();
    expect(formatErrorDetail(err)).toBe("[unformattable error]");
  });
});
