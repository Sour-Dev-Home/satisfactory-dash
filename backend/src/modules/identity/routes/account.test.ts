import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, DeleteAccountResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import type { AccountDeletion, DeleteAccountResult } from "../accountDeletion.js";
import { hashSessionId } from "../repositories/sessionRepository.js";
import { SESSION_COOKIE } from "../session.js";
import { createAccountRouter } from "./account.js";

// ADR-0047: DELETE /api/account through the real app, with a stand-in deletion (the SQL is accountDeletion.db.test.ts).
const COOKIE = "a".repeat(43);
const guard: RequestHandler = (req, res, next) => {
  const id = req.header("x-test-user");
  if (id === undefined) {
    res.status(401).json({ error: { code: "unauthorized", message: "Sign in to continue", requestId: "t" } });
    return;
  }
  res.locals.user = { id, name: id };
  next();
};

function build(result: DeleteAccountResult | (() => Promise<DeleteAccountResult>), limiter?: UserRateLimiter) {
  const deleteAccount = vi.fn(typeof result === "function" ? result : async () => result);
  const deletion: AccountDeletion = { deleteAccount };
  const app = createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: guard,
    protectedRouters: [createAccountRouter(deletion, limiter ? { limiter } : {})],
  });
  return { app, deleteAccount };
}
const del = (app: ReturnType<typeof build>["app"], user = "u-1") =>
  request(app).delete(endpoints.account.remove.path()).set("x-test-user", user).set("Cookie", `${SESSION_COOKIE}=${COOKIE}`);
const deleted: DeleteAccountResult = { outcome: "deleted", serversDeleted: 1, membershipsLeft: 2, pushSubscriptions: 0 };

describe("DELETE /api/account", () => {
  it("deletes the signed-in user's account with this session's hash, answers { deleted: true } and clears the cookie", async () => {
    const { app, deleteAccount } = build(deleted);
    const res = await del(app);
    expect(res.status).toBe(200);
    expect(DeleteAccountResponseSchema.parse(res.body)).toEqual({ deleted: true });
    expect(deleteAccount).toHaveBeenCalledWith({ userId: "u-1", sessionIdHash: hashSessionId(COOKIE) });
    expect(String(res.headers["set-cookie"])).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));
  });

  it("an old sign-in is 403 reauth_required (not 401, so the client does not read it as signed out); the cookie stays", async () => {
    const res = await del(build({ outcome: "reauth_required" }).app);
    expect(res.status).toBe(403);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("reauth_required");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("the operator's account is 403 forbidden, reason operator_account", async () => {
    const res = await del(build({ outcome: "operator_account" }).app);
    expect(res.status).toBe(403);
    const { error } = ApiErrorResponseSchema.parse(res.body);
    expect([error.code, error.reason]).toEqual(["forbidden", "operator_account"]);
  });

  it("an owned operator-created server is 409 would_orphan, reason operator_servers, listing them in `servers`", async () => {
    const servers = [{ id: "alpha", displayName: "Alpha" }];
    const res = await del(build({ outcome: "operator_servers", servers }).app);
    expect(res.status).toBe(409);
    const { error } = ApiErrorResponseSchema.parse(res.body);
    expect([error.code, error.reason, error.servers]).toEqual(["would_orphan", "operator_servers", servers]);
  });

  it("an account already gone (another tab) is a 401 and the cookie is cleared", async () => {
    const res = await del(build({ outcome: "not_found" }).app);
    expect([res.status, res.body.error.code]).toEqual([401, "unauthorized"]);
    expect(String(res.headers["set-cookie"])).toMatch(`${SESSION_COOKIE}=;`);
  });

  it("without a session cookie it is a 401 and nothing runs (the guard passed a user, but there is no session to check)", async () => {
    const { app, deleteAccount } = build(deleted);
    const res = await request(app).delete(endpoints.account.remove.path()).set("x-test-user", "u-1");
    expect(res.status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("signed out is the guard's 401", async () => {
    const { app, deleteAccount } = build(deleted);
    expect((await request(app).delete(endpoints.account.remove.path())).status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("a database outage is a 503, never a 401 or a 500", async () => {
    const res = await del(build(async () => Promise.reject(Object.assign(new Error("down"), { code: "ECONNREFUSED" }))).app);
    expect([res.status, res.body.error.code]).toEqual([503, "service_unavailable"]);
  });

  it("is rate limited per user", async () => {
    const { app, deleteAccount } = build({ outcome: "reauth_required" }, new UserRateLimiter({ max: 2, windowMs: 60_000 }));
    await del(app);
    await del(app);
    const res = await del(app);
    expect([res.status, res.body.error.code]).toEqual([429, "rate_limited"]);
    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect((await del(app, "u-2")).status).toBe(403);
  });
});
