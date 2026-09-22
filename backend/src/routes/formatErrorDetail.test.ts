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
});
