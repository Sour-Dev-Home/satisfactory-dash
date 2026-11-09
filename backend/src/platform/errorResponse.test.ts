import { describe, it, expect, vi, afterEach } from "vitest";
import { Router } from "express";
import request from "supertest";
import { ApiErrorResponseSchema } from "@satisfactory-dash/shared";
import {
  ApiFailure,
  classifyRequestFailure,
  createErrorHandler,
  ForbiddenError,
  HTTP_STATUS_BY_CODE,
  ServerNotFoundError,
  ServiceUnavailableError,
} from "./errorResponse.js";
import { ContractViolationError } from "./sendValidated.js";
import { createApp } from "../app.js";
import { createLogger } from "./logger.js";

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

/** An upstream failure as the agent snapshot store throws it, with a cause whose text carries an address (the
 *  detail tests below check that address never reaches a production body). */
const unreachable = () =>
  Object.assign(new ApiFailure("upstream_unreachable", "This server's game PC has not reported yet"), {
    cause: new Error("connect ECONNREFUSED 127.0.0.1:8080"),
  });

// ADR-0066 build PR 6: the UpstreamError mapping is gone. An upstream code comes only from an ApiFailure; anything else
// fails closed as our own 500 (architect ruling, ADR-0003 PR 3).
describe("classifyRequestFailure fails closed", () => {
  it("treats a non-ApiFailure error like a TypeError as our own internal failure", () => {
    expect(classifyRequestFailure(new TypeError("Cannot read properties of null"))).toEqual({
      code: "internal",
      message: "Internal server error",
    });
  });

  // A plain Error carrying a numeric status fails closed as 500, never 502: that duck-typing is how PR #16's
  // URIError got blamed on the game server.
  it("fails closed for a plain Error with a numeric status or a failureKind: internal, not upstream", () => {
    expect(classifyRequestFailure(Object.assign(new Error("x"), { status: 404 })).code).toBe("internal");
    expect(classifyRequestFailure(Object.assign(new Error("x"), { failureKind: "unreachable" })).code).toBe("internal");
  });

  // Found by a review pass: a throwing getter must not make the error handling itself throw.
  it("does not throw when reading the error's expose or statusCode throws", () => {
    const err = new Error("hostile");
    for (const key of ["expose", "statusCode", "status"]) {
      Object.defineProperty(err, key, {
        get() {
          throw new Error("boom");
        },
      });
    }
    expect(classifyRequestFailure(err)).toEqual({ code: "internal", message: "Internal server error" });
  });
});

describe("error middleware (ADR-0003 envelope)", () => {
  it.each([
    ["upstream unreachable", unreachable(), 503, "upstream_unreachable"],
    ["upstream auth rejected", new ApiFailure("upstream_auth_rejected", "rejected"), 502, "upstream_auth_rejected"],
    ["upstream invalid response", new ApiFailure("upstream_invalid_response", "bad"), 502, "upstream_invalid_response"],
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

  it.each([["development"], ["test"]])("never puts detail in a service_unavailable body, even when NODE_ENV is %s", async (env) => {
    process.env.NODE_ENV = env;
    const err = new ServiceUnavailableError();
    err.cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const { app, lines } = appThrowing(err);
    const res = await request(app).get("/api/boom");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("service_unavailable");
    expect(res.body.error).not.toHaveProperty("detail");
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
    expect(lines.some((line) => String(line.detail).includes("ECONNREFUSED"))).toBe(true);
  });

  it("always logs the full detail server-side, even in production", async () => {
    process.env.NODE_ENV = "production";
    const { app, lines } = appThrowing(unreachable());
    await request(app).get("/api/boom");
    expect(lines.some((line) => String(line.detail).includes("ECONNREFUSED"))).toBe(true);
  });

  // Found while writing this middleware: express.json() rejects a malformed body with
  // an http-errors error carrying status 400, which the old upstream mapping's status
  // branch would have blamed on the game server.
  it("reports a malformed JSON request body as our 400 bad_request, not an upstream error", async () => {
    const { app } = appThrowing(unreachable());
    const res = await request(app).post("/api/echo").set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

  // ADR-0030 security review (L1): body-parser's SyntaxError message quotes a snippet of the body, which on a
  // management route can be part of a token. Neither the log nor a development response may carry it.
  it("never logs or returns a fragment of a rejected request body", async () => {
    process.env.NODE_ENV = "development";
    const { app, lines } = appThrowing(unreachable());
    const secret = "tok-SECRET-fragment-1234567890";
    // An unquoted value makes V8 quote the surrounding text in its message; a missing comma (the earlier
    // body here) does not, which made the SECRET assertions below pass even on the unfixed code.
    const body = `{"apiToken": ${secret}}`;
    expect(() => JSON.parse(body)).toThrow(/SECRET/);
    const res = await request(app).post("/api/echo").set("Content-Type", "application/json").send(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("SECRET");
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain("SECRET");
    expect(lines.some((line) => String(line.detail).startsWith("request rejected: entity.parse.failed (400)"))).toBe(true);
  });

  // Found by PR #13's fresh-eyes review: body-parser 4xx errors were all flattened
  // to 400. Each now has its own code, and each code keeps one status (ADR-0003).
  // Found by PR #16's fresh-eyes review: Express's router throws a URIError with a
  // bare `status: 400` (no `expose`) for a broken percent-encoded route parameter, and
  // the old upstream mapping's status branch blamed it on the game server as a 502. Latent
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

  // ADR-0025 PR 4: the two new codes, end to end through the real error middleware.
  it("answers a ForbiddenError with 403 forbidden, a contract-valid body and no server detail", async () => {
    const { app } = appThrowing(new ForbiddenError());
    const res = await request(app).get("/api/boom");
    expect(res.status).toBe(403);
    expect(ApiErrorResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.error).toMatchObject({ code: "forbidden", message: "You don't have permission to do that on this server" });
  });

  it("answers a ServiceUnavailableError with 503 service_unavailable and a fixed public message, never the cause", async () => {
    const cause = new Error("connect ECONNREFUSED postgres://satis_app:hunter2@127.0.0.1:5432/satis");
    const failure = Object.assign(new ServiceUnavailableError(), { cause });
    const { app, lines } = appThrowing(failure);
    const res = await request(app).get("/api/boom");
    expect(res.status).toBe(503);
    expect(ApiErrorResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.error).toMatchObject({ code: "service_unavailable", message: "The service is temporarily unavailable" });
    // The public message is fixed. (`detail` is only ever included in development and test.)
    process.env.NODE_ENV = "production";
    const prod = await request(appThrowing(failure).app).get("/api/boom");
    expect(JSON.stringify(prod.body)).not.toMatch(/hunter2|postgres:|ECONNREFUSED/);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("maps the new codes to 403 and 503, and a non-member's 404 stays a different code", () => {
    expect(HTTP_STATUS_BY_CODE.forbidden).toBe(403);
    expect(HTTP_STATUS_BY_CODE.service_unavailable).toBe(503);
    expect(HTTP_STATUS_BY_CODE.server_not_found).toBe(404);
    expect(classifyRequestFailure(new ForbiddenError()).code).not.toBe(classifyRequestFailure(new ServerNotFoundError()).code);
  });

  it("maps every known error code to an HTTP status", () => {
    for (const status of Object.values(HTTP_STATUS_BY_CODE)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });
});
