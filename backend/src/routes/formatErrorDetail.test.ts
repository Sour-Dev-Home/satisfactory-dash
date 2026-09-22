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
});
