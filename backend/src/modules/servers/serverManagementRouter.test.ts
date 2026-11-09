import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, ManagedServerListResponseSchema, RenameServerResponseSchema, ServerListResponseSchema } from "@satisfactory-dash/shared";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { ServerNotFoundError } from "../../platform/errorResponse.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { InMemoryServerDirectory } from "./serverDirectory.js";
import { createServerManagementRouters } from "./serverManagementRouter.js";
import { createServersRouter } from "./serversRouter.js";
import type { ServerManagementService } from "./serverManagement.js";
import type { ServerAccess } from "./serverAccess.js";

const OPERATOR = "op";
const OTHER = "someone";

function fakeService(overrides: Partial<ServerManagementService> = {}) {
  return {
    canManage: (id: string) => id === OPERATOR,
    listAgentServers: vi.fn(async () => [{ id: "agent-one", displayName: "Agent One", kind: "agent" as const }]),
    renameAgentServer: vi.fn(async (_actor: string, id: string, displayName: string) => ({ id, displayName, kind: "agent" as const })),
    remove: vi.fn(async () => undefined),
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

// Everyone is a member of "alpha", so this file tests the operator check and the routes, not membership.
const access: ServerAccess = {
  getRole: async (publicId) => (publicId === "alpha" ? "admin" : undefined),
  listForUser: async () => [{ publicId: "alpha", displayName: "Home", role: "admin", id: "uuid-alpha", createdVia: "operator" }],
};

function build(service: ServerManagementService, options: { isReady?: () => boolean; writeLimiter?: UserRateLimiter } = {}) {
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

const connectionBody = { id: "alt", displayName: "Alt", host: "192.168.1.30", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abc123", frmToken: "frm-token-def456" };

// ADR-0066: the direct-poll routes answered 410 for one release (build PR 5) and are deleted (build PR 6). A call to one
// now falls through to the app's normal 404, with the shared envelope, and reaches no service.
const DELETED: [string, "post" | "patch" | "get", string, unknown][] = [
  ["create", "post", "/api/servers", connectionBody],
  ["test a candidate", "post", "/api/servers/test-connection", connectionBody],
  ["get the stored connection", "get", "/api/servers/alpha/connection", undefined],
  ["update", "patch", "/api/servers/alpha", { displayName: "New" }],
  ["test the saved connection", "post", "/api/servers/alpha/test-connection", undefined],
  ["switch to local", "post", "/api/servers/alpha/local-connection", connectionBody],
];

describe("the deleted direct-poll routes (ADR-0066 build PR 6)", () => {
  it.each(DELETED)("%s: 404 for the operator, with the shared envelope, and nothing called", async (_name, method, url, body) => {
    const service = fakeService();
    const res = await send(build(service), method, url, OPERATOR, body);
    expect(res.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toMatch(/^(not_found|server_not_found)$/);
    expect(JSON.stringify(res.body)).not.toMatch(/api-token|frm-token|192\.168/);
    for (const fn of [service.listAgentServers, service.renameAgentServer, service.remove]) expect(fn).not.toHaveBeenCalled();
  });

  it("a body that would fail the old schema is never validated: a 404, never a 400 echoing it", async () => {
    const res = await send(build(fakeService()), "post", "/api/servers", OPERATOR, { apiToken: "has space\r\nX-Evil: 1" });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("X-Evil");
  });
});

describe("GET /api/servers/managed", () => {
  it("is not read as a server id: the operator gets `servers: []` and the agent servers, a non-operator 403, no session 401", async () => {
    const service = fakeService();
    const app = build(service);
    const ok = await send(app, "get", "/api/servers/managed", OPERATOR);
    expect(ok.status).toBe(200);
    const parsed = ManagedServerListResponseSchema.parse(ok.body);
    expect(parsed.servers).toEqual([]);
    expect(parsed.agentServers).toEqual([{ id: "agent-one", displayName: "Agent One", kind: "agent" }]);
    expect(Object.keys(parsed.agentServers![0]!).sort()).toEqual(["displayName", "id", "kind"]); // nothing of a connection
    const refused = await send(app, "get", "/api/servers/managed", OTHER);
    expect(refused.status).toBe(403);
    expect(ApiErrorResponseSchema.parse(refused.body).error.code).toBe("forbidden");
    expect((await send(app, "get", "/api/servers/managed", undefined)).status).toBe(401);
    expect(service.listAgentServers).toHaveBeenCalledTimes(1);
  });

  it("is 503 until ready, and maps a database outage to 503", async () => {
    expect((await send(build(fakeService(), { isReady: () => false }), "get", "/api/servers/managed", OPERATOR)).status).toBe(503);
    const outage = Object.assign(new Error("down"), { code: "ECONNREFUSED" });
    const service = fakeService({ listAgentServers: vi.fn(async () => Promise.reject(outage)) });
    expect((await send(build(service), "get", "/api/servers/managed", OPERATOR)).status).toBe(503);
  });
});

describe("rename and remove (kept)", () => {
  it("renames through PATCH /:serverId/name: operator only, validated, and the answer is the contract's shape", async () => {
    const service = fakeService();
    const app = build(service);
    const ok = await send(app, "patch", "/api/servers/alpha/name", OPERATOR, { displayName: "  Renamed  " });
    expect(ok.status).toBe(200);
    expect(RenameServerResponseSchema.parse(ok.body).server).toEqual({ id: "alpha", displayName: "Renamed", kind: "agent" });
    expect(service.renameAgentServer).toHaveBeenCalledWith(OPERATOR, "alpha", "Renamed"); // trimmed by the schema
    expect((await send(app, "patch", "/api/servers/alpha/name", OTHER, { displayName: "X" })).status).toBe(403);
    expect((await send(app, "patch", "/api/servers/alpha/name", undefined, { displayName: "X" })).status).toBe(401);
    for (const bad of [{}, { displayName: "" }, { displayName: "x".repeat(65) }, { displayName: "ok", host: "10.0.0.1" }, { displayName: 5 }]) {
      expect((await send(app, "patch", "/api/servers/alpha/name", OPERATOR, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(service.renameAgentServer).toHaveBeenCalledTimes(1);
  });

  it("an unknown server is the same not-found answer", async () => {
    const service = fakeService({ renameAgentServer: vi.fn(async () => Promise.reject(new ServerNotFoundError())) });
    expect((await send(build(service), "patch", "/api/servers/alpha/name", OPERATOR, { displayName: "X" })).status).toBe(404);
  });

  it("DELETE removes and answers { deleted: true }; a database outage is a 503", async () => {
    const service = fakeService();
    const res = await send(build(service), "delete", "/api/servers/alpha", OPERATOR);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(service.remove).toHaveBeenCalledWith(OPERATOR, "alpha");
    const outage = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    expect((await send(build(fakeService({ remove: vi.fn(async () => Promise.reject(outage)) })), "delete", "/api/servers/alpha", OPERATOR)).status).toBe(503);
  });

  it("the writes are rate limited per user (429 with Retry-After), after the operator check", async () => {
    const writeLimiter = new UserRateLimiter({ max: 2, windowMs: 60_000 });
    const app = build(fakeService(), { writeLimiter });
    expect((await send(app, "patch", "/api/servers/alpha/name", OPERATOR, { displayName: "A" })).status).toBe(200);
    expect((await send(app, "patch", "/api/servers/alpha/name", OPERATOR, { displayName: "B" })).status).toBe(200);
    const limited = await send(app, "patch", "/api/servers/alpha/name", OPERATOR, { displayName: "C" });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect((await send(app, "patch", "/api/servers/alpha/name", OTHER, { displayName: "D" })).status).toBe(403);
  });
});

describe("GET /api/servers says whether the user may manage servers", () => {
  it("true for the operator, false for anyone else", async () => {
    const app = build(fakeService());
    expect(ServerListResponseSchema.parse((await send(app, "get", "/api/servers", OPERATOR)).body).canManageServers).toBe(true);
    expect(ServerListResponseSchema.parse((await send(app, "get", "/api/servers", OTHER)).body).canManageServers).toBe(false);
  });
});
