import { describe, it, expect, vi, afterEach } from "vitest";
import { buildServerUnreachableResponse } from "./errorResponse.js";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

describe("buildServerUnreachableResponse", () => {
  // Found by a review pass: once frmApiClient.ts started setting { cause: err },
  // formatErrorDetail's .cause-unwrapping started faithfully including the
  // internal FRM server's host:port (from Node's own "connect ECONNREFUSED
  // <ip>:<port>" text) in detail -- which every route sends in a public,
  // unauthenticated 503 body. detail is now omitted outside local dev.
  it("omits detail in production, keeping only the generic error message", () => {
    process.env.NODE_ENV = "production";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("connect ECONNREFUSED 127.0.0.1:8080");
    const body = buildServerUnreachableResponse(err);
    expect(body).toEqual({ error: "Could not reach the Satisfactory dedicated server" });
    expect(body).not.toHaveProperty("detail");
  });

  it("includes detail outside production", () => {
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("connect ECONNREFUSED 127.0.0.1:8080");
    const body = buildServerUnreachableResponse(err);
    expect(body.detail).toContain("ECONNREFUSED");
  });

  it("always logs the full detail server-side, even in production", () => {
    process.env.NODE_ENV = "production";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("connect ECONNREFUSED 127.0.0.1:8080");
    buildServerUnreachableResponse(err);
    expect(errorSpy).toHaveBeenCalled();
    const loggedArgs = errorSpy.mock.calls[0]?.join(" ") ?? "";
    expect(loggedArgs).toContain("ECONNREFUSED");
  });

  // Found by a review pass: the original NODE_ENV === "production" check left
  // detail exposed for anything else -- unset, "", "staging", "Production"
  // (capitalized). Now an explicit allowlist (development/test), so anything
  // unrecognized is redacted by default.
  it("omits detail when NODE_ENV is unset, unlike the old opt-out-of-production check", () => {
    delete process.env.NODE_ENV;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = buildServerUnreachableResponse(new Error("connect ECONNREFUSED 127.0.0.1:8080"));
    expect(body).not.toHaveProperty("detail");
  });

  it("omits detail for an unrecognized NODE_ENV value like staging", () => {
    process.env.NODE_ENV = "staging";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = buildServerUnreachableResponse(new Error("connect ECONNREFUSED 127.0.0.1:8080"));
    expect(body).not.toHaveProperty("detail");
  });

  it("includes detail in development", () => {
    process.env.NODE_ENV = "development";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = buildServerUnreachableResponse(new Error("connect ECONNREFUSED 127.0.0.1:8080"));
    expect(body.detail).toContain("ECONNREFUSED");
  });

  // Found by a review pass: every failure previously got the same "Could not
  // reach..." message, wrong for anything that isn't a connectivity problem.
  it("describes an auth failure (401/403-style error) distinctly from an unreachable server", () => {
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "error").mockImplementation(() => {});
    class FakeStatusError extends Error {
      status = 401;
    }
    const body = buildServerUnreachableResponse(new FakeStatusError("unauthorized"));
    expect(body.error).toContain("rejected the request");
  });

  it("falls back to the generic connectivity message for a plain error with no status/errorCode", () => {
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = buildServerUnreachableResponse(new Error("connect ECONNREFUSED"));
    expect(body.error).toBe("Could not reach the Satisfactory dedicated server");
  });
});
