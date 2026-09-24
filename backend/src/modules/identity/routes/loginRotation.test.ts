import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { createAuthRouter } from "./auth.js";
import { createSessionGuard, SESSION_COOKIE } from "../session.js";
import { LoginRateLimiter } from "../loginRateLimiter.js";
import type { SessionStore } from "../sessionStore.js";

/** L2 (gate A review): the login route hands the browser's current session cookie to the store,
 *  so the store can end it in the same step it starts the new one. */
function build() {
  const create = vi.fn(async () => ({
    cookieValue: "B".repeat(43),
    maxAgeSeconds: 60,
    user: { id: "u1", name: "op" },
  }));
  const store: SessionStore = {
    create,
    resolve: async () => null,
    revoke: async () => {},
    revokeAllFor: async () => 0,
    recognizes: () => true,
  };
  const authenticator = { verifyCredentials: async () => ({ subject: "operator", name: "op" }), isActiveUser: () => true };
  const app = createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    allowedOrigins: [],
    routers: [createAuthRouter({ store, authenticator, rateLimiter: new LoginRateLimiter() })],
    sessionGuard: createSessionGuard({ store }),
  });
  return { app, create };
}

const login = (app: ReturnType<typeof build>["app"]) =>
  request(app).post("/api/auth/login").set("Content-Type", "application/json").send(JSON.stringify({ username: "op", password: "x" }));

describe("login passes the current session cookie to the store (rotation)", () => {
  it("with the incoming cookie value", async () => {
    const { app, create } = build();
    const old = "A".repeat(43);
    const res = await login(app).set("Cookie", `${SESSION_COOKIE}=${old}`);
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledWith({ subject: "operator", name: "op" }, old);
  });

  it("with undefined when the browser sent no session cookie", async () => {
    const { app, create } = build();
    await login(app);
    expect(create).toHaveBeenCalledWith({ subject: "operator", name: "op" }, undefined);
  });

  it("without touching any other cookie", async () => {
    const { app, create } = build();
    await login(app).set("Cookie", "theme=dark");
    expect(create).toHaveBeenCalledWith({ subject: "operator", name: "op" }, undefined);
  });
});
