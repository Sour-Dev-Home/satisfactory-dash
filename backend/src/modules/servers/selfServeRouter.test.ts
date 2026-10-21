import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, CreateAgentServerResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { ApiFailure, RateLimitedError } from "../../platform/errorResponse.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { InMemoryServerDirectory } from "./serverDirectory.js";
import { createServersRouter } from "./serversRouter.js";
import { createSelfServeRouter } from "./selfServeRouter.js";
import type { SelfServeRouterOptions } from "./selfServeRouter.js";
import type { SelfServeService } from "./selfServe.js";
import type { ServerAccess } from "./serverAccess.js";

const OPERATOR = "op";
const PLAYER = "player";
const URL = endpoints.selfServe.createAgentServer.path();
const ON = { enabled: true };

function fakeService(overrides: Partial<SelfServeService> = {}) {
  return {
    isOperator: (id: string) => id === OPERATOR,
    create: vi.fn(async (_actor: string, input: { displayName: string }) => ({ id: "abcdefghijklmnopqrst", displayName: input.displayName, kind: "agent" as const })),
    renameAsOwner: vi.fn(async () => "not_self_serve" as const),
    removeAsOwner: vi.fn(async () => "not_self_serve" as const),
    ...overrides,
  };
}

const guard: RequestHandler = (req, res, next) => {
  const id = req.header("x-test-user");
  if (id === undefined) {
    res.status(401).json({ error: { code: "unauthorized", message: "Sign in to continue", requestId: "t" } });
    return;
  }
  res.locals.user = { id, name: id };
  next();
};

// Nobody is a member of anything: a request that fell through to the servers router would be a 404, never a create.
const access: ServerAccess = { getRole: async () => undefined, listForUser: async () => [] };

function build(service: SelfServeService, options: Partial<SelfServeRouterOptions> = {}) {
  const router = createSelfServeRouter(service, { config: ON, ...options });
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: guard,
    // Production order: the collection routes, then the servers router.
    protectedRouters: [router, createServersRouter(new InMemoryServerDirectory([]), access, {})],
  });
}

const post = (app: ReturnType<typeof build>, user: string | undefined, body: unknown = { displayName: "My world" }) => {
  let req = request(app).post(URL);
  if (user !== undefined) req = req.set("x-test-user", user);
  return req.set("Content-Type", "application/json").send(JSON.stringify(body));
};
const codeOf = (res: request.Response) => ApiErrorResponseSchema.parse(res.body).error.code;

describe("POST /api/servers/agent (ADR-0046 self-serve create)", () => {
  it("is 401 without a session", async () => {
    const service = fakeService();
    expect((await post(build(service), undefined)).status).toBe(401);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("is 403 forbidden for everyone, the operator included, while SELF_SERVE_ENABLED is off", async () => {
    const service = fakeService();
    const app = build(service, { config: { enabled: false } });
    for (const user of [PLAYER, OPERATOR]) {
      const res = await post(app, user);
      expect(res.status).toBe(403);
      expect(codeOf(res)).toBe("forbidden");
    }
    // Off wins over a bad body too: nothing about the request is looked at.
    expect((await post(app, PLAYER, { nope: 1 })).status).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("on: 201 with the new agent server in the contract's shape, created for the caller", async () => {
    const service = fakeService();
    const res = await post(build(service), PLAYER);
    expect(res.status).toBe(201);
    expect(CreateAgentServerResponseSchema.parse(res.body)).toEqual({ server: { id: "abcdefghijklmnopqrst", displayName: "My world", kind: "agent" } });
    expect(service.create).toHaveBeenCalledWith(PLAYER, { displayName: "My world" });
  });

  it("is 503 until the servers are loaded", async () => {
    const service = fakeService();
    const res = await post(build(service, { isReady: () => false }), PLAYER);
    expect(res.status).toBe(503);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("is 400 for a body that is not exactly { displayName } (no id, no host can be chosen)", async () => {
    const service = fakeService();
    const app = build(service);
    for (const body of [{}, { displayName: "" }, { displayName: "x", id: "mine" }, { displayName: "x", host: "127.0.0.1" }]) {
      expect((await post(app, PLAYER, body)).status).toBe(400);
    }
    expect(service.create).not.toHaveBeenCalled();
  });

  it("passes a cap refusal through as 409 server_limit_reached", async () => {
    const service = fakeService({ create: vi.fn(async () => Promise.reject(new ApiFailure("server_limit_reached", "full"))) });
    const res = await post(build(service), PLAYER);
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe("server_limit_reached");
  });

  // #526: C5 is counted by the service from the server rows (selfServe.db.test.ts); the route passes its answer through.
  it("passes the service's C5 refusal through as 429 rate_limited with its Retry-After", async () => {
    const service = fakeService({ create: vi.fn(async () => Promise.reject(new RateLimitedError(7200, "You have added the most servers allowed in one day."))) });
    const refused = await post(build(service), PLAYER);
    expect(refused.status).toBe(429);
    expect(codeOf(refused)).toBe("rate_limited");
    expect(refused.headers["retry-after"]).toBe("7200");
  });

  it("keeps no in-memory C5 count of its own: many creations in a row all reach the service", async () => {
    const service = fakeService();
    const app = build(service);
    for (let i = 0; i < 8; i++) expect((await post(app, PLAYER)).status).toBe(201);
    expect(service.create).toHaveBeenCalledTimes(8);
  });

  it("is write-rate-limited for everyone (the operator too)", async () => {
    const service = fakeService();
    const app = build(service, { writeLimiter: new UserRateLimiter({ max: 1, windowMs: 60_000 }) });
    expect((await post(app, OPERATOR)).status).toBe(201);
    expect((await post(app, OPERATOR)).status).toBe(429);
  });
});
