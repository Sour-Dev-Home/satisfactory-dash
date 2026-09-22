import { describe, it, expect } from "vitest";
import { formatErrorDetail } from "./formatErrorDetail.js";

/**
 * Narrow confirmation pass for the round-2 fix: `err.errors.map((cause) =>
 * formatErrorDetail(cause))` (recursive call) replacing the old
 * `err.errors.map((cause) => String(cause))`. These tests go beyond the single
 * nested-AggregateError case already in formatErrorDetail.test.ts to check the
 * fix is genuinely recursive (not a one-level-deeper special case) and that it
 * doesn't regress the previously-verified flat cases.
 */
describe("formatErrorDetail — recursive fix confirmation", () => {
  it("unwraps three levels of nested AggregateError, surfacing the deepest message", () => {
    const level3 = new AggregateError([new Error("deepest failure")], "");
    const level2 = new AggregateError([level3, new Error("mid failure")], "");
    const level1 = new AggregateError([level2, new Error("top failure")], "");

    const detail = formatErrorDetail(level1);

    expect(detail).not.toContain("(AggregateError;");
    expect(detail).not.toBe("AggregateError");
    expect(detail).toContain("deepest failure");
    expect(detail).toContain("mid failure");
    expect(detail).toContain("top failure");
  });

  it("unwraps four levels deep with multiple causes at each level", () => {
    const level4 = new AggregateError([new Error("L4-a"), new Error("L4-b")], "");
    const level3 = new AggregateError([level4, new Error("L3-a")], "");
    const level2 = new AggregateError([level3, new Error("L2-a"), new Error("L2-b")], "");
    const level1 = new AggregateError([level2], "outer");

    const detail = formatErrorDetail(level1);

    for (const needle of ["L4-a", "L4-b", "L3-a", "L2-a", "L2-b"]) {
      expect(detail).toContain(needle);
    }
    expect(detail).toContain("AggregateError: outer");
  });

  it("does not throw or hang on a very deep (but finite) chain of nested AggregateErrors", () => {
    const depth = 500;
    let current: unknown = new Error("bottom");
    for (let i = 0; i < depth; i++) {
      current = new AggregateError([current as Error], "");
    }

    expect(() => formatErrorDetail(current)).not.toThrow();
    const detail = formatErrorDetail(current);
    expect(detail).toContain("bottom");
  });

  it("regression: plain Error still stringifies the same as before the fix", () => {
    expect(formatErrorDetail(new Error("boom"))).toBe("Error: boom");
  });

  it("regression: single-level multi-error AggregateError still formats correctly", () => {
    const err = new AggregateError([new Error("a"), new Error("b"), new Error("c")], "multi");
    expect(formatErrorDetail(err)).toBe("AggregateError: multi (Error: a; Error: b; Error: c)");
  });

  it("regression: zero-error AggregateError still formats correctly", () => {
    const err = new AggregateError([], "empty");
    expect(formatErrorDetail(err)).toBe("AggregateError: empty");
  });

  it("regression: non-Error values (string, number, object, undefined, null) pass through String()", () => {
    expect(formatErrorDetail("plain string")).toBe("plain string");
    expect(formatErrorDetail(42)).toBe("42");
    expect(formatErrorDetail(undefined)).toBe("undefined");
    expect(formatErrorDetail(null)).toBe("null");
    expect(formatErrorDetail({ foo: "bar" })).toBe("[object Object]");
  });

  it("regression: nested AggregateError whose inner causes are non-Error values still surfaces them", () => {
    const inner = new AggregateError(["raw string cause", 123], "");
    const outer = new AggregateError([inner], "wrapper");
    const detail = formatErrorDetail(outer);
    expect(detail).toContain("raw string cause");
    expect(detail).toContain("123");
  });

  it("bounds a deliberately-constructed circular AggregateError with a RangeError rather than hanging forever", () => {
    // `.errors` is a normal writable, configurable own property (not frozen), so a
    // circular AggregateError can be constructed deliberately (not reachable from any
    // real Node API — happy-eyeballs / Promise.any never produce a cycle). The
    // recursive fix has no cycle detection, so this documents that it fails the same
    // bounded way any unguarded recursive traversal does (like JSON.stringify) — a
    // synchronous RangeError, not an infinite loop that hangs the process.
    const err = new AggregateError([new Error("x")], "msg");
    (err.errors as unknown as unknown[])[0] = err;

    expect(() => formatErrorDetail(err)).toThrow(RangeError);
  });
});
