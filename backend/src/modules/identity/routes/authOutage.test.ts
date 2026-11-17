import { describe, it, expect } from "vitest";
import request from "supertest";
import { Router } from "express";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { createAuthRouter } from "./auth.js";
import { createSessionGuard, SESSION_COOKIE } from "../session.js";
import type { SessionStore } from "../sessionStore.js";

const down = () => Promise.reject(new ServiceUnavailableError());

/** A store whose database is down: every answer is a 503, and recognizes() is the DB shape. */
const outageStore: SessionStore = {
  create: down,
  resolve: down,
  revoke: down,
  revokeAllFor: down,
  recognizes: (value) => /^[A-Za-z0-9_-]{43}$/.test(value),
};

function buildApp(store: SessionStore) {
  const logger = createLogger({ level: "silent" }, { write: () => {} });
  const protectedRouter = Router();
  protectedRouter.get("/servers", (_req, res) => {
    res.json({ servers: [] });
  });
  return createApp({
    logger,
    allowedOrigins: ["https://satis-manager.com"],
    routers: [createAuthRouter({ store, signInMethods: ["google"] })],
    sessionGuard: createSessionGuard({ store }),
    protectedRouters: [protectedRouter],
  });
}

const cookie = `${SESSION_COOKIE}=${"A".repeat(43)}`;

describe("session store outage (503, never 401 or signed-out)", () => {
  it("GET session is 503 and keeps the cookie", async () => {
    const res = await request(buildApp(outageStore)).get("/api/auth/session").set("Cookie", cookie);
    expect(res.status).toBe(503);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/ECONN|detail/);
  });

  it("the guard answers a protected route with 503", async () => {
    const res = await request(buildApp(outageStore)).get("/api/servers").set("Cookie", cookie);
    expect(res.status).toBe(503);
  });

  it("logout-all during an outage is 503", async () => {
    const res = await request(buildApp(outageStore)).post("/api/auth/logout-all").set("Cookie", cookie);
    expect(res.status).toBe(503);
  });

  it("logout during an outage is 503 rather than pretending the session ended", async () => {
    const res = await request(buildApp(outageStore)).post("/api/auth/logout").set("Cookie", cookie);
    expect(res.status).toBe(503);
  });
});
