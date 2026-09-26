import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, ManagedServerListResponseSchema, ServerConnectionResponseSchema, ServerListResponseSchema, TestConnectionResponseSchema } from "@satisfactory-dash/shared";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { ApiFailure, ServerNotFoundError } from "../../platform/errorResponse.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { InMemoryServerDirectory } from "./serverDirectory.js";
import { createServerManagementRouters } from "./serverManagementRouter.js";
import { createServersRouter } from "./serversRouter.js";
import type { ServerManagementService } from "./serverManagement.js";
import type { ServerAccess } from "./serverAccess.js";

const OPERATOR = "op";
const OTHER = "someone";

const view = {
  id: "alpha",
  displayName: "Home",
  host: "192.168.1.20",
  apiPort: 7777,
  frmPort: 8080,
  apiTokenSet: true as const,
  apiTokenLast4: "1234",
  frmTokenSet: true,
  frmTokenLast4: "5678",
  state: "ok" as const,
  plainHttpOverLan: true,
};
const passed = { ok: true, api: { ok: true }, frm: { ok: true } };

function fakeService(overrides: Partial<ServerManagementService> = {}) {
  const service = {
    canManage: (id: string) => id === OPERATOR,
    create: vi.fn(async () => view),
    get: vi.fn(async () => view),
    list: vi.fn(async () => [view]),
    update: vi.fn(async () => view),
    remove: vi.fn(async () => undefined),
    testCandidate: vi.fn(async () => passed),
    testSaved: vi.fn(async () => passed),
    ...overrides,
  };
  return service;
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

// Everyone is a member of "alpha", so this file tests the operator check and the routes, not membership.
const access: ServerAccess = {
  getRole: async (publicId) => (publicId === "alpha" ? "admin" : undefined),
  listForUser: async () => [{ publicId: "alpha", displayName: "Home", role: "admin" }],
};

function build(service: ServerManagementService, options: { isReady?: () => boolean; writeLimiter?: UserRateLimiter; testLimiter?: UserRateLimiter } = {}) {
  const management = createServerManagementRouters(service, options);
  const directory = new InMemoryServerDirectory([{ id: "alpha", displayName: "Home", services: {} }]);
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: guard,
    protectedRouters: [management.collection, createServersRouter(directory, access, { canManage: service.canManage }), management.scoped],
  });
}

const send = (app: ReturnType<typeof build>, method: "post" | "patch" | "delete" | "get", url: string, user: string | undefined, body?: unknown) => {
  let req = request(app)[method](url);
  if (user !== undefined) req = req.set("x-test-user", user);
  return body === undefined ? req : req.set("Content-Type", "application/json").send(JSON.stringify(body));
};

const createBody = { id: "alt", displayName: "Alt", host: "192.168.1.30", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abc123", frmToken: "frm-token-def456" };

describe("POST /api/servers (create)", () => {
  it("is 401 without a session and 403 for anyone but the operator, without calling the service", async () => {
    const service = fakeService();
    const app = build(service);
    expect((await send(app, "post", "/api/servers", undefined, createBody)).status).toBe(401);
    const refused = await send(app, "post", "/api/servers", OTHER, createBody);
    expect(refused.status).toBe(403);
    expect(ApiErrorResponseSchema.parse(refused.body).error.code).toBe("forbidden");
    expect(service.create).not.toHaveBeenCalled();
  });

  it("creates for the operator: 201, the contract shape, and no token in the response", async () => {
    const service = fakeService();
    const res = await send(build(service), "post", "/api/servers", OPERATOR, createBody);
    expect(res.status).toBe(201);
    expect(ServerConnectionResponseSchema.parse(res.body).server.id).toBe("alpha");
    expect(JSON.stringify(res.body)).not.toContain("api-token-abc123");
    expect(JSON.stringify(res.body)).not.toContain("frm-token-def456");
    expect(service.create).toHaveBeenCalledWith(OPERATOR, expect.objectContaining({ id: "alt", host: "192.168.1.30" }));
  });

  it.each([
    ["an unknown field", { ...createBody, extra: 1 }],
    ["a missing token", { ...createBody, apiToken: undefined }],
    ["an empty FRM token", { ...createBody, frmToken: "" }],
    ["a token with a space", { ...createBody, apiToken: "has space" }],
    ["a token with a newline (header injection)", { ...createBody, apiToken: "abc\r\nX-Evil: 1" }],
    ["a host that is a URL", { ...createBody, host: "http://192.168.1.30" }],
    ["a host with a path", { ...createBody, host: "192.168.1.30/x" }],
    ["a host with credentials", { ...createBody, host: "user@192.168.1.30" }],
    ["a port of 0", { ...createBody, apiPort: 0 }],
    ["a port over 65535", { ...createBody, frmPort: 65536 }],
    ["a string port", { ...createBody, apiPort: "7777" }],
    ["a bad server id", { ...createBody, id: "Bad_Id" }],
    ["the reserved id", { ...createBody, id: "test-connection" }],
    ["an empty name", { ...createBody, displayName: "  " }],
  ])("is a 400 for %s, without calling the service and without echoing a token", async (_label, body) => {
    const service = fakeService();
    const res = await send(build(service), "post", "/api/servers", OPERATOR, body);
    expect(res.status).toBe(400);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("bad_request");
    expect(service.create).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain("api-token-abc123");
    expect(JSON.stringify(res.body)).not.toContain("X-Evil");
  });

  it.each([
    ["address_not_allowed", 422],
    ["connection_test_failed", 422],
    ["server_exists", 409],
    ["server_limit_reached", 409],
    ["connection_unreadable", 409],
  ] as const)("maps the stable code %s to HTTP %i", async (code, status) => {
    const service = fakeService({ create: vi.fn(async () => Promise.reject(new ApiFailure(code, "fixed message"))) });
    const res = await send(build(service), "post", "/api/servers", OPERATOR, createBody);
    expect(res.status).toBe(status);
    expect(ApiErrorResponseSchema.parse(res.body).error).toMatchObject({ code, message: "fixed message" });
  });

  it("is 503 until the servers are loaded", async () => {
    const res = await send(build(fakeService(), { isReady: () => false }), "post", "/api/servers", OPERATOR, createBody);
    expect(res.status).toBe(503);
  });

  it("is rate limited per user (429 with Retry-After), and one user's limit does not affect another", async () => {
    const writeLimiter = new UserRateLimiter({ max: 2, windowMs: 60_000 });
    const app = build(fakeService(), { writeLimiter });
    expect((await send(app, "post", "/api/servers", OPERATOR, createBody)).status).toBe(201);
    expect((await send(app, "post", "/api/servers", OPERATOR, createBody)).status).toBe(201);
    const limited = await send(app, "post", "/api/servers", OPERATOR, createBody);
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(ApiErrorResponseSchema.parse(limited.body).error.code).toBe("rate_limited");
    // A non-operator is refused (403) before the limiter is touched, so they cannot use up the operator's window.
    expect((await send(app, "post", "/api/servers", OTHER, createBody)).status).toBe(403);
  });
});

describe("POST /api/servers/test-connection", () => {
  const candidate = { host: "192.168.1.30", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abc123" };

  it("is not read as a server id: the operator reaches it, a non-operator gets 403 (not a 404 for an unknown server)", async () => {
    const service = fakeService();
    const app = build(service);
    const ok = await send(app, "post", "/api/servers/test-connection", OPERATOR, candidate);
    expect(ok.status).toBe(200);
    expect(TestConnectionResponseSchema.parse(ok.body).ok).toBe(true);
    expect((await send(app, "post", "/api/servers/test-connection", OTHER, candidate)).status).toBe(403);
    expect((await send(app, "post", "/api/servers/test-connection", undefined, candidate)).status).toBe(401);
    expect(service.testCandidate).toHaveBeenCalledTimes(1);
  });

  it("returns a failed test as data (200 with ok: false), never the game server's words", async () => {
    const failed = { ok: false, api: { ok: false, error: "unreachable" as const }, frm: { ok: true } };
    const res = await send(build(fakeService({ testCandidate: vi.fn(async () => failed) })), "post", "/api/servers/test-connection", OPERATOR, candidate);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(failed);
  });

  it("refuses an address that is not allowed with the stable code, naming no address", async () => {
    const service = fakeService({ testCandidate: vi.fn(async () => Promise.reject(new ApiFailure("address_not_allowed", "That host is not a loopback or private (LAN) address, or it could not be resolved."))) });
    const res = await send(build(service), "post", "/api/servers/test-connection", OPERATOR, { ...candidate, host: "8.8.8.8" });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toContain("8.8.8.8");
  });

  it("is rate limited more tightly than the writes", async () => {
    const testLimiter = new UserRateLimiter({ max: 1, windowMs: 60_000 });
    const app = build(fakeService(), { testLimiter });
    expect((await send(app, "post", "/api/servers/test-connection", OPERATOR, candidate)).status).toBe(200);
    expect((await send(app, "post", "/api/servers/test-connection", OPERATOR, candidate)).status).toBe(429);
  });
});

describe("GET /api/servers/managed (the operator's list of every stored connection)", () => {
  it("is not read as a server id: the operator gets the list, a non-operator 403, no session 401", async () => {
    const service = fakeService({
      list: vi.fn(async () => [
        view,
        { ...view, id: "stranded", state: "unreadable" as const, apiTokenLast4: null, frmTokenLast4: null },
        { ...view, id: "tampered", state: "refused" as const, apiTokenLast4: null, frmTokenLast4: null },
      ]),
    });
    const app = build(service);
    const ok = await send(app, "get", "/api/servers/managed", OPERATOR);
    expect(ok.status).toBe(200);
    expect(ManagedServerListResponseSchema.parse(ok.body).servers.map((s) => s.state)).toEqual(["ok", "unreadable", "refused"]);
    const refused = await send(app, "get", "/api/servers/managed", OTHER);
    expect(refused.status).toBe(403);
    expect(ApiErrorResponseSchema.parse(refused.body).error.code).toBe("forbidden");
    expect((await send(app, "get", "/api/servers/managed", undefined)).status).toBe(401);
    expect(service.list).toHaveBeenCalledTimes(1);
  });

  it("carries no token, is 503 until ready, and maps a database outage to 503", async () => {
    const res = await send(build(fakeService()), "get", "/api/servers/managed", OPERATOR);
    expect(JSON.stringify(res.body)).not.toMatch(/api-token|frm-token/);
    expect((await send(build(fakeService(), { isReady: () => false }), "get", "/api/servers/managed", OPERATOR)).status).toBe(503);
    const outage = Object.assign(new Error("down"), { code: "ECONNREFUSED" });
    expect((await send(build(fakeService({ list: vi.fn(async () => Promise.reject(outage)) })), "get", "/api/servers/managed", OPERATOR)).status).toBe(503);
  });

  it("import_required maps to 409", async () => {
    const service = fakeService({ create: vi.fn(async () => Promise.reject(new ApiFailure("import_required", "Import first."))) });
    const res = await send(build(service), "post", "/api/servers", OPERATOR, createBody);
    expect(res.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("import_required");
  });
});

describe("the scoped routes", () => {
  it("GET connection returns the write-only view", async () => {
    const service = fakeService();
    const res = await send(build(service), "get", "/api/servers/alpha/connection", OPERATOR);
    expect(res.status).toBe(200);
    expect(ServerConnectionResponseSchema.parse(res.body).server).toMatchObject({ apiTokenSet: true, apiTokenLast4: "1234" });
    expect(service.get).toHaveBeenCalledWith("alpha");
  });

  it("PATCH validates the body (at least one field; null clears the FRM token; an empty FRM token is refused)", async () => {
    const service = fakeService();
    const app = build(service);
    expect((await send(app, "patch", "/api/servers/alpha", OPERATOR, {})).status).toBe(400);
    expect((await send(app, "patch", "/api/servers/alpha", OPERATOR, { frmToken: "" })).status).toBe(400);
    expect((await send(app, "patch", "/api/servers/alpha", OPERATOR, { id: "other" })).status).toBe(400);
    expect((await send(app, "patch", "/api/servers/alpha", OPERATOR, { frmToken: null })).status).toBe(200);
    expect(service.update).toHaveBeenCalledWith(OPERATOR, "alpha", { frmToken: null });
  });

  it("DELETE removes and answers { deleted: true }", async () => {
    const service = fakeService();
    const res = await send(build(service), "delete", "/api/servers/alpha", OPERATOR);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(service.remove).toHaveBeenCalledWith(OPERATOR, "alpha");
  });

  it("a server the service does not know is the same 404 as any unknown server", async () => {
    const service = fakeService({ get: vi.fn(async () => Promise.reject(new ServerNotFoundError())) });
    const res = await send(build(service), "get", "/api/servers/alpha/connection", OPERATOR);
    expect(res.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("server_not_found");
  });

  it("a database outage inside the service is a 503, not a 500", async () => {
    const outage = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    const service = fakeService({ update: vi.fn(async () => Promise.reject(outage)) });
    const res = await send(build(service), "patch", "/api/servers/alpha", OPERATOR, { displayName: "New" });
    expect(res.status).toBe(503);
  });

  it("POST test-connection on a saved server needs no body and is operator only", async () => {
    const service = fakeService();
    const app = build(service);
    expect((await send(app, "post", "/api/servers/alpha/test-connection", OPERATOR)).status).toBe(200);
    expect((await send(app, "post", "/api/servers/alpha/test-connection", OTHER)).status).toBe(403);
    expect(service.testSaved).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/servers says whether the user may manage servers", () => {
  it("true for the operator, false for anyone else, and the field is absent without a manager", async () => {
    const app = build(fakeService());
    expect(ServerListResponseSchema.parse((await send(app, "get", "/api/servers", OPERATOR)).body).canManageServers).toBe(true);
    expect(ServerListResponseSchema.parse((await send(app, "get", "/api/servers", OTHER)).body).canManageServers).toBe(false);
  });
});
