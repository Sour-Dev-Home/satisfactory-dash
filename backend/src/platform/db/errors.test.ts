import { describe, it, expect } from "vitest";
import { ConfigError } from "../errors.js";
import { classifyStartupError, DatabaseSetupError, errorCode, isTransientConnectionError, isUniqueViolation } from "./errors.js";

const withCode = (code: string, message = "boom") => Object.assign(new Error(message), { code });

describe("classifyStartupError (ADR-0025 decision 6)", () => {
  it.each([
    "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH",
    "57P03", "57P01", "57P02", "53300", "08006", "08001",
  ])(
    "retries %s (the database is coming up or dropped us)",
    (code) => {
      expect(classifyStartupError(withCode(code)).kind).toBe("transient");
    },
  );

  it.each([
    ["28P01", /credentials/],
    ["28000", /credentials/],
    ["3D000", /does not exist/],
    ["ENOTFOUND", /resolved/],
  ])("fails fast on %s with a clear reason", (code, reason) => {
    const verdict = classifyStartupError(withCode(code));
    expect(verdict.kind).toBe("fatal");
    expect(verdict.reason).toMatch(reason);
  });

  it("fails fast on anything unrecognized, and on a schema problem", () => {
    expect(classifyStartupError(new Error("weird")).kind).toBe("fatal");
    expect(classifyStartupError(withCode("42P01")).kind).toBe("fatal");
    expect(classifyStartupError(withCode("08P01")).kind).toBe("fatal"); // protocol violation
    expect(classifyStartupError(new DatabaseSetupError("run npm run db:migrate")).kind).toBe("fatal");
  });

  // #368: FATAL_REASONS is a plain object; a driver-supplied code of "constructor" etc. must not
  // resolve to Object.prototype's member (a function) through FATAL_REASONS[code] and must fall
  // through to the generic "unexpected database error" reason, same as any other unmapped code.
  it("a driver code that collides with Object.prototype is treated as unrecognized, not as a fatal reason", () => {
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const verdict = classifyStartupError(withCode(code));
      expect(verdict.kind).toBe("fatal");
      expect(verdict.reason).toBe(`an unexpected database error (${code})`);
    }
  });

  it("retries pg's code-less connect timeout and early close", () => {
    expect(classifyStartupError(new Error("timeout exceeded when trying to connect")).kind).toBe("transient");
    expect(classifyStartupError(new Error("Connection terminated unexpectedly")).kind).toBe("transient");
    expect(classifyStartupError(new Error("Connection terminated due to connection timeout")).kind).toBe("transient");
    expect(classifyStartupError(new Error("Query read timeout")).kind).toBe("transient");
  });

  it("treats a dual-stack AggregateError as transient if ANY attempt was (#298)", () => {
    const refused = new AggregateError([withCode("ECONNREFUSED"), withCode("ECONNREFUSED")]);
    expect(classifyStartupError(refused).kind).toBe("transient");
    // Windows, closed port: ::1 answers EACCES, 127.0.0.1 answers ECONNREFUSED (the aggregate's own code is the first's).
    const windows = Object.assign(new AggregateError([withCode("EACCES"), withCode("ECONNREFUSED")]), { code: "EACCES" });
    const verdict = classifyStartupError(windows);
    expect(verdict.kind).toBe("transient");
    expect(verdict.reason).toContain("ECONNREFUSED");
    expect(verdict.reason).not.toContain("EACCES");
  });

  it("keeps an AggregateError fatal when no attempt was transient, and a plain EACCES fatal", () => {
    expect(classifyStartupError(new AggregateError([withCode("EACCES"), withCode("EACCES")])).kind).toBe("fatal");
    expect(classifyStartupError(new AggregateError([withCode("ENOTFOUND")])).kind).toBe("fatal");
    expect(classifyStartupError(withCode("EACCES")).kind).toBe("fatal");
    expect(isTransientConnectionError(withCode("EACCES"))).toBe(false);
  });

  it("handles nested aggregates, non-Error inners and mixed codes", () => {
    const nested = new AggregateError([withCode("EACCES"), new AggregateError([withCode("EACCES"), withCode("ECONNREFUSED")])]);
    const verdict = classifyStartupError(nested);
    expect(verdict.kind).toBe("transient");
    expect(verdict.reason).toContain("ECONNREFUSED");
    expect(isTransientConnectionError(new AggregateError([null, "x", undefined, 5]))).toBe(false);
    expect(isTransientConnectionError(new AggregateError([null, withCode("57P03")]))).toBe(true);
    expect(isTransientConnectionError(new AggregateError([new AggregateError([])]))).toBe(false);
  });

  it("never puts the driver's message (which can quote the URL) in the reason", () => {
    const err = withCode("28P01", "password authentication failed for user satis_app at postgres://satis_app:hunter2@host/db");
    expect(JSON.stringify(classifyStartupError(err))).not.toMatch(/hunter2|satis_app/);
    const odd = withCode("XX000", "postgres://u:hunter2@host/db exploded");
    expect(JSON.stringify(classifyStartupError(odd))).not.toContain("hunter2");
  });
});

describe("pg error helpers", () => {
  it("errorCode reads only string codes", () => {
    expect(errorCode(withCode("23505"))).toBe("23505");
    expect(errorCode({ code: 23505 })).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode("x")).toBeUndefined();
  });

  it("isUniqueViolation is exactly 23505", () => {
    expect(isUniqueViolation(withCode("23505"))).toBe(true);
    expect(isUniqueViolation(withCode("23503"))).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
  });

  it("isTransientConnectionError agrees with the classifier", () => {
    expect(isTransientConnectionError(withCode("ECONNREFUSED"))).toBe(true);
    expect(isTransientConnectionError(withCode("28P01"))).toBe(false);
    expect(isTransientConnectionError(new AggregateError([]))).toBe(false);
  });

  it("a DatabaseSetupError is a ConfigError, so the composition root exits 1 on it", () => {
    expect(new DatabaseSetupError("x")).toBeInstanceOf(ConfigError);
  });
});
