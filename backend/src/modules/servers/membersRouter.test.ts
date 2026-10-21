import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, LeaveServerResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { InMemoryServerDirectory } from "./serverDirectory.js";
import { createServersRouter } from "./serversRouter.js";
import { createMembersRouter } from "./membersRouter.js";
import type { MemberSelfService } from "./membersRouter.js";
import type { ServerAccess } from "./serverAccess.js";

// ADR-0047 decision 4: POST /api/servers/:serverId/members/me/leave behind the real membership middleware.
const roles: Record<string, Record<string, "owner" | "admin" | "viewer">> = { alpha: { own: "owner", adm: "admin", view: "viewer" } };
const access: ServerAccess = {
  getRole: async (publicId, userId) => roles[publicId]?.[userId],
  listForUser: async () => [],
};
const guard: RequestHandler = (req, res, next) => {
  res.locals.user = { id: req.header("x-test-user") ?? "nobody" };
  next();
};

function build(service: MemberSelfService, limiter?: UserRateLimiter) {
  const directory = new InMemoryServerDirectory([{ id: "alpha", displayName: "Alpha", services: {} }]);
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: guard,
    protectedRouters: [createServersRouter(directory, access), createMembersRouter(service, limiter ? { limiter } : {})],
  });
}

const url = endpoints.members.leave.path("alpha");

describe("leaving a server", () => {
  it("a viewer or admin leaves: 200 { left: true }, and only the signed-in user is passed to the service", async () => {
    const leave = vi.fn(async () => "left" as const);
    const app = build({ leave });
    for (const user of ["view", "adm"]) {
      const res = await request(app).post(url).set("x-test-user", user);
      expect(res.status).toBe(200);
      expect(LeaveServerResponseSchema.parse(res.body)).toEqual({ left: true });
    }
    expect(leave.mock.calls).toEqual([
      ["alpha", "view"],
      ["alpha", "adm"],
    ]);
  });

  it("ignores any user id in the body: it acts on the caller only", async () => {
    const leave = vi.fn(async () => "left" as const);
    await request(build({ leave })).post(url).set("x-test-user", "view").set("Content-Type", "application/json").send({ userId: "own" });
    expect(leave).toHaveBeenCalledWith("alpha", "view");
  });

  it("the owner gets 409 would_orphan, reason last_owner", async () => {
    const res = await request(build({ leave: async () => "last_owner" })).post(url).set("x-test-user", "own");
    expect(res.status).toBe(409);
    const { error } = ApiErrorResponseSchema.parse(res.body);
    expect([error.code, error.reason]).toEqual(["would_orphan", "last_owner"]);
    expect(error.message).toMatch(/Remove it from Satisfactory Dash/);
    expect(error.message).not.toMatch(/delete/i);
  });

  it("a membership gone between the check and the delete (another tab) is the unknown-server 404", async () => {
    const res = await request(build({ leave: async () => "not_member" })).post(url).set("x-test-user", "view");
    expect([res.status, res.body.error.code]).toEqual([404, "server_not_found"]);
  });

  it("a non-member never reaches the service (the middleware's 404)", async () => {
    const leave = vi.fn(async () => "left" as const);
    const res = await request(build({ leave })).post(url).set("x-test-user", "stranger");
    expect([res.status, res.body.error.code]).toEqual([404, "server_not_found"]);
    expect(leave).not.toHaveBeenCalled();
  });

  it("a database outage is a 503, never a 404", async () => {
    const down = async () => {
      throw Object.assign(new Error("boom"), { code: "ECONNREFUSED" });
    };
    const res = await request(build({ leave: down })).post(url).set("x-test-user", "view");
    expect([res.status, res.body.error.code]).toEqual([503, "service_unavailable"]);
  });

  it("is rate limited per user (429 with Retry-After), before the service runs", async () => {
    const leave = vi.fn(async () => "left" as const);
    const app = build({ leave }, new UserRateLimiter({ max: 1, windowMs: 60_000 }));
    expect((await request(app).post(url).set("x-test-user", "view")).status).toBe(200);
    const res = await request(app).post(url).set("x-test-user", "view");
    expect([res.status, res.body.error.code]).toEqual([429, "rate_limited"]);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(leave).toHaveBeenCalledTimes(1);
  });
});
