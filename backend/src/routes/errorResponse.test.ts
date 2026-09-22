import { describe, it, expect, vi, afterEach } from "vitest";
import { buildServerUnreachableResponse } from "./errorResponse.js";
import { VanillaApiClient } from "../adapters/index.js";

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
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8080"), { failureKind: "unreachable" });
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

  it('says "Could not reach" only for an error the adapter classified as unreachable', () => {
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("FRM request to getPower failed"), { failureKind: "unreachable" });
    expect(buildServerUnreachableResponse(err).error).toBe("Could not reach the Satisfactory dedicated server");
  });

  // Found by a review pass: a 200 response with malformed JSON, and any adapter
  // crash, were both reported as "Could not reach..." even though the server
  // had answered.
  it("describes an invalid response distinctly from an unreachable server", () => {
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("not valid JSON"), { failureKind: "invalid_response" });
    expect(buildServerUnreachableResponse(err).error).toBe(
      "Satisfactory dedicated server returned an invalid response",
    );
  });

  it("uses a neutral message, not a connectivity claim, for an unclassified error like an adapter TypeError", () => {
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = buildServerUnreachableResponse(new TypeError("Cannot read properties of null"));
    expect(body.error).toBe("Request to the Satisfactory dedicated server failed");
  });

  // Found by a review pass: describeFailure read err.status unguarded, so a
  // throwing getter made the route's catch block itself throw.
  it("does not throw when reading the error's status throws", () => {
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("hostile");
    Object.defineProperty(err, "status", {
      get() {
        throw new Error("boom");
      },
    });
    expect(buildServerUnreachableResponse(err).error).toBe("Request to the Satisfactory dedicated server failed");
  });

  // Found by a review pass: typeof === "number" accepted NaN, 0 and negatives,
  // producing "request failed (status NaN)".
  it.each([Number.NaN, 0, -1, 200.5, 1000])("ignores a non-HTTP status value %s", (status) => {
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("bad status"), { status });
    expect(buildServerUnreachableResponse(err).error).toBe("Request to the Satisfactory dedicated server failed");
  });

  // Found by a review pass, using errors thrown by the real VanillaApiClient
  // rather than hand-built ones: it never put the HTTP status on its errors, so
  // /api/status with a bad token got a generic message instead of the auth hint.
  describe("with errors from the real VanillaApiClient", () => {
    async function responseFor(transportResult: { status: number; body: unknown }) {
      process.env.NODE_ENV = "test";
      vi.spyOn(console, "error").mockImplementation(() => {});
      const client = new VanillaApiClient({
        host: "localhost",
        port: 7777,
        timeoutMs: 1000,
        allowSelfSignedCert: false,
        transport: vi.fn().mockResolvedValue(transportResult),
      });
      const err = await client.call("QueryServerState").catch((e: unknown) => e);
      return buildServerUnreachableResponse(err);
    }

    it("a 401 with no body gets the auth-token message", async () => {
      expect((await responseFor({ status: 401, body: undefined })).error).toContain("check the configured auth token");
    });

    it("a 403 with an errorCode body still gets the auth-token message", async () => {
      const body = await responseFor({ status: 403, body: { errorCode: "insufficient_scope" } });
      expect(body.error).toContain("check the configured auth token");
    });

    it("a 500 with no body reports the status", async () => {
      expect((await responseFor({ status: 500, body: undefined })).error).toBe(
        "Satisfactory dedicated server request failed (status 500)",
      );
    });
  });
});
