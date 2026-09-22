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
});
