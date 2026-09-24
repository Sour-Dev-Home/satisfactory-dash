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

  it("retries pg's code-less connect timeout and early close", () => {
    expect(classifyStartupError(new Error("timeout exceeded when trying to connect")).kind).toBe("transient");
    expect(classifyStartupError(new Error("Connection terminated unexpectedly")).kind).toBe("transient");
    expect(classifyStartupError(new Error("Connection terminated due to connection timeout")).kind).toBe("transient");
    expect(classifyStartupError(new Error("Query read timeout")).kind).toBe("transient");
  });

  it("treats a dual-stack AggregateError as transient only if every attempt was", () => {
    const refused = new AggregateError([withCode("ECONNREFUSED"), withCode("ECONNREFUSED")]);
    expect(classifyStartupError(refused).kind).toBe("transient");
    const mixed = new AggregateError([withCode("ECONNREFUSED"), withCode("ENOTFOUND")]);
    expect(classifyStartupError(mixed).kind).toBe("fatal");
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
