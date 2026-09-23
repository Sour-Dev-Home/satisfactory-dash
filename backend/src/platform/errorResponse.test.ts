import { describe, it, expect, vi, afterEach } from "vitest";
import { Router } from "express";
import request from "supertest";
import { ApiErrorResponseSchema } from "@satisfactory-dash/shared";
import { createErrorHandler, describeFailure, HTTP_STATUS_BY_CODE } from "./errorResponse.js";
import { ContractViolationError } from "./sendValidated.js";
import { createApp } from "../app.js";
import { createLogger } from "./logger.js";
import { UpstreamError } from "./errors.js";
import { VanillaApiClient } from "../modules/gameserver/index.js";

const originalNodeEnv = process.env.NODE_ENV;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

/** An app whose only route throws `err`, with every log line captured as parsed JSON. */
function appThrowing(err: unknown) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(JSON.parse(line)) });
  const router = Router();
  router.get("/boom", async () => {
    throw err;
  });
  router.post("/echo", (req, res) => {
    res.json(req.body);
  });
  router.get("/items/:id", (req, res) => {
    res.json({ id: req.params.id });
  });
  return { app: createApp({ logger, routers: [router] }), lines };
}

const unreachable = () =>
  new UpstreamError("connect ECONNREFUSED 127.0.0.1:8080", { failureKind: "unreachable" });

describe("describeFailure (classification; inputs and branches unchanged by ADR-0003)", () => {
  // Found by a review pass: every failure used to get the same "Could not reach..."
  // message, wrong for anything that isn't a connectivity problem.
  it("describes an auth failure (401/403-style error) distinctly from an unreachable server", () => {
    expect(describeFailure(new UpstreamError("unauthorized", { status: 401 }))).toEqual({
      code: "upstream_auth_rejected",
      message: "Satisfactory dedicated server rejected the request (check the configured auth token)",
    });
  });

  it('says "Could not reach" only for an error the adapter classified as unreachable', () => {
    expect(describeFailure(unreachable())).toEqual({
      code: "upstream_unreachable",
      message: "Could not reach the Satisfactory dedicated server",
    });
  });

  // Found by a review pass: a 200 response with malformed JSON, and any adapter
  // crash, were both reported as "Could not reach..." even though the server
  // had answered.
  it("describes an invalid response distinctly from an unreachable server", () => {
    const err = new UpstreamError("not valid JSON", { failureKind: "invalid_response" });
    expect(describeFailure(err)).toEqual({
      code: "upstream_invalid_response",
      message: "Satisfactory dedicated server returned an invalid response",
    });
  });

  it("treats a non-upstream error like a TypeError as our own internal failure", () => {
    expect(describeFailure(new TypeError("Cannot read properties of null"))).toEqual({
      code: "internal",
      message: "Internal server error",
    });
  });

  // Architect acceptance tests for PR 3: only an UpstreamError can become an upstream
  // code. A plain Error carrying a numeric status fails closed as 500, never 502 --
  // that duck-typing is how PR #16's URIError got blamed on the game server.
  it("fails closed for a plain Error with a numeric status: internal, not upstream", () => {
    expect(describeFailure(Object.assign(new Error("x"), { status: 404 })).code).toBe("internal");
    expect(describeFailure(Object.assign(new Error("x"), { failureKind: "unreachable" })).code).toBe("internal");
  });

  it("maps an UpstreamError with no status, errorCode or failureKind to upstream_error", () => {
    expect(describeFailure(new UpstreamError("something upstream")).code).toBe("upstream_error");
  });

  // Issue #8 item 4: the vanilla API's errorCode lands in the public message, so it's
  // bounded to 64 characters from a safe set.
  it("bounds and sanitizes the server-supplied errorCode in the message", () => {
    const hostile = "<script>" + "a".repeat(10_000);
    const { message } = describeFailure(new UpstreamError("x", { errorCode: hostile }));
    expect(message).not.toContain("<");
    expect(message.length).toBeLessThan(120);
  });

  // Found by a review pass: describeFailure read err.status unguarded, so a
  // throwing getter made the route's error handling itself throw.
  it("does not throw when reading the error's status throws", () => {
    const err = new UpstreamError("hostile");
    Object.defineProperty(err, "status", {
      get() {
        throw new Error("boom");
      },
    });
    expect(describeFailure(err)).toEqual({ code: "internal", message: "Internal server error" });
  });

  // Found by a review pass: typeof === "number" accepted NaN, 0 and negatives,
  // producing "request failed (status NaN)".
  it.each([Number.NaN, 0, -1, 200.5, 1000])("ignores a non-HTTP status value %s", (status) => {
    expect(describeFailure(new UpstreamError("bad status", { status })).code).toBe("upstream_error");
  });

  // Found by a review pass, using errors thrown by the real VanillaApiClient
  // rather than hand-built ones: it never put the HTTP status on its errors, so
  // /api/status with a bad token got a generic message instead of the auth hint.
  describe("with errors from the real VanillaApiClient", () => {
    async function classify(transportResult: { status: number; body: unknown }) {
      const client = new VanillaApiClient({
        host: "localhost",
        port: 7777,
        timeoutMs: 1000,
        allowSelfSignedCert: false,
        transport: vi.fn().mockResolvedValue(transportResult),
      });
      return describeFailure(await client.call("QueryServerState").catch((e: unknown) => e));
    }

    it("a 401 with no body gets the auth-token message", async () => {
      expect(await classify({ status: 401, body: undefined })).toMatchObject({ code: "upstream_auth_rejected" });
    });

    it("a 403 with an errorCode body still gets the auth-token message", async () => {
      const failure = await classify({ status: 403, body: { errorCode: "insufficient_scope" } });
      expect(failure.message).toContain("check the configured auth token");
    });

    it("a 500 with no body reports the status", async () => {
      expect(await classify({ status: 500, body: undefined })).toEqual({
        code: "upstream_error",
        message: "Satisfactory dedicated server request failed (status 500)",
      });
    });
  });
});

describe("error middleware (ADR-0003 envelope)", () => {
  it.each([
    ["upstream unreachable", unreachable(), 503, "upstream_unreachable"],
    ["upstream auth rejected", new UpstreamError("401", { status: 401 }), 502, "upstream_auth_rejected"],
    ["upstream invalid response", new UpstreamError("bad", { failureKind: "invalid_response" }), 502, "upstream_invalid_response"],
    ["our own bug", new TypeError("oops"), 500, "internal"],
    ["a plain Error with a numeric status", Object.assign(new Error("x"), { status: 503 }), 500, "internal"],
  ])("maps %s to its HTTP status and code, in a body that matches the shared schema", async (_name, err, status, code) => {
    const { app } = appThrowing(err);
    const res = await request(app).get("/api/boom");
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(ApiErrorResponseSchema.parse(res.body)).toEqual(res.body);
  });

  it("puts the same fresh request id in the body, the X-Request-Id header and the log line", async () => {
    const { app, lines } = appThrowing(unreachable());
    const res = await request(app).get("/api/boom");
    const id = res.headers["x-request-id"];
    expect(id).toMatch(UUID);
    expect(res.body.error.requestId).toBe(id);
    expect(lines.some((line) => line.requestId === id && line.code === "upstream_unreachable")).toBe(true);
  });

  it("ignores an inbound X-Request-Id (it isn't trusted until a proxy we control sets it)", async () => {
    const { app } = appThrowing(unreachable());
    const res = await request(app).get("/api/boom").set("X-Request-Id", "attacker-chosen");
    expect(res.headers["x-request-id"]).toMatch(UUID);
    expect(res.body.error.requestId).not.toBe("attacker-chosen");
  });

  it("gives successful responses a request id too", async () => {
    const { app } = appThrowing(unreachable());
    const res = await request(app).post("/api/echo").send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  // Found by a review pass: once frmApiClient.ts started setting { cause: err },
  // detail started faithfully including the internal FRM server's host:port, and
  // the error body is public. detail is omitted outside an allowlisted NODE_ENV.
  it.each([["production"], ["staging"], [undefined]])("omits detail when NODE_ENV is %s", async (env) => {
    if (env === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = env;
    }
    const { app } = appThrowing(unreachable());
    const res = await request(app).get("/api/boom");
    expect(res.body.error).not.toHaveProperty("detail");
    expect(JSON.stringify(res.body)).not.toContain("127.0.0.1");
  });

  it.each([["development"], ["test"]])("includes detail when NODE_ENV is %s", async (env) => {
    process.env.NODE_ENV = env;
    const { app } = appThrowing(unreachable());
    const res = await request(app).get("/api/boom");
    expect(res.body.error.detail).toContain("ECONNREFUSED");
  });

  it("always logs the full detail server-side, even in production", async () => {
    process.env.NODE_ENV = "production";
    const { app, lines } = appThrowing(unreachable());
    await request(app).get("/api/boom");
    expect(lines.some((line) => String(line.detail).includes("ECONNREFUSED"))).toBe(true);
  });

  // Found while writing this middleware: express.json() rejects a malformed body with
  // an http-errors error carrying status 400, which describeFailure's status branch
  // would have blamed on the game server.
  it("reports a malformed JSON request body as our 400 bad_request, not an upstream error", async () => {
    const { app } = appThrowing(unreachable());
    const res = await request(app).post("/api/echo").set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

  // Found by PR #13's fresh-eyes review: body-parser 4xx errors were all flattened
  // to 400. Each now has its own code, and each code keeps one status (ADR-0003).
  // Found by PR #16's fresh-eyes review: Express's router throws a URIError with a
  // bare `status: 400` (no `expose`) for a broken percent-encoded route parameter, and
  // describeFailure's status branch blamed it on the game server as a 502. Latent
  // until the first parameterised route (server-scoped routes, ADR-0001).
  it("reports a malformed percent-encoded route parameter as our 400 bad_request, not a 502", async () => {
    const { app } = appThrowing(unreachable());
    const res = await request(app).get("/api/items/%E0%A4%A");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

  it("reports an oversized JSON body as 413 payload_too_large", async () => {
    const { app } = appThrowing(unreachable());
    const res = await request(app)
      .post("/api/echo")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ blob: "x".repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("payload_too_large");
  });

  it("reports an unsupported body encoding as 415 unsupported_media_type", async () => {
    const { app } = appThrowing(unreachable());
    const res = await request(app)
      .post("/api/echo")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "x-not-a-real-encoding")
      .send("{}");
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_media_type");
  });

  // Also from that review: an unknown /api route got Express's HTML 404 page, which
  // the frontend's error parsing can't read.
  it.each([
    ["GET", "/api/does-not-exist"],
    ["POST", "/api/boom"],
    ["GET", "/api"],
  ])("answers %s %s (no such route) with a 404 not_found envelope, never HTML", async (method, path) => {
    const { app } = appThrowing(unreachable());
    const res = method === "GET" ? await request(app).get(path) : await request(app).post(path).send({});
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.error.code).toBe("not_found");
    expect(ApiErrorResponseSchema.parse(res.body)).toEqual(res.body);
  });

  it("leaves paths outside /api to Express's default 404", async () => {
    const { app } = appThrowing(unreachable());
    const res = await request(app).get("/not-api");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).not.toMatch(/application\/json/);
  });

  it("maps a contract violation to 500 internal with a generic message", async () => {
    process.env.NODE_ENV = "production";
    const { app, lines } = appThrowing(new ContractViolationError([{ code: "custom", path: ["status"], message: "bad", input: 1 }]));
    const res = await request(app).get("/api/boom");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: "internal", message: "Internal server error" });
    expect(lines.some((line) => String(line.detail).includes("status: bad"))).toBe(true);
  });

  it("redacts credentials from request logs", async () => {
    const { app, lines } = appThrowing(unreachable());
    await request(app)
      .get("/api/boom")
      .set("Authorization", "Bearer secret-api-token")
      .set("Cookie", "session=secret-session")
      .set("X-FRM-Authorization", "secret-frm-token");
    const logged = JSON.stringify(lines);
    expect(logged).toContain("[Redacted]");
    for (const secret of ["secret-api-token", "secret-session", "secret-frm-token"]) {
      expect(logged).not.toContain(secret);
    }
  });

  // Express identifies error middleware by arity; a refactor that drops the unused
  // fourth parameter would silently turn it into ordinary middleware.
  it("keeps exactly four parameters so Express treats it as error middleware", () => {
    expect(createErrorHandler(createLogger()).length).toBe(4);
  });

  it("maps every known error code to an HTTP status", () => {
    for (const status of Object.values(HTTP_STATUS_BY_CODE)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });
});
