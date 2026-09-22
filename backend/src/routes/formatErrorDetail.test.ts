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
  // produce exactly this shape. `formatErrorDetail` maps over `.errors` with
  // `String(cause)` rather than recursing into itself, so a nested AggregateError
  // collapses back to the bare, undiagnostic "AggregateError" string one level down —
  // the same failure mode this helper exists to fix, just not caught at the top level.
  it("recursively unwraps a nested AggregateError instead of collapsing it back to a bare string", () => {
    const inner = new AggregateError([new Error("ECONNREFUSED 127.0.0.1"), new Error("ECONNREFUSED ::1")], "");
    const outer = new AggregateError([inner, new Error("other failure")], "");
    const detail = formatErrorDetail(outer);
    expect(detail).not.toContain("(AggregateError;");
    expect(detail).toContain("ECONNREFUSED 127.0.0.1");
    expect(detail).toContain("ECONNREFUSED ::1");
  });
});
