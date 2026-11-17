import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { Router } from "express";
import http from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { healthRouter } from "../../../platform/health.js";
import { createAuthRouter } from "./auth.js";
import { createSessionGuard, SESSION_COOKIE } from "../session.js";
import type { SessionStore, SessionUser } from "../sessionStore.js";

const METHODS = ["google"];
const OPERATOR: SessionUser = { id: "u1", name: "operator", authMethods: ["google"] };

/** An in-memory stand-in for the database store: sessions are started by the test (Google
 *  sign-in starts them in production), resolved, revoked one at a time or all at once. */
function memoryStore() {
  const sessions = new Map<string, SessionUser>();
  const store: SessionStore = {
    create: vi.fn(async () => {
      throw new Error("no route creates a session through the store");
    }),
    resolve: async (value) => (value === undefined ? null : (sessions.get(value) ?? null)),
    revoke: async (value) => {
      if (value !== undefined) sessions.delete(value);
    },
    revokeAllFor: async (user) => {
      let ended = 0;
      for (const [value, owner] of sessions) {
        if (owner.id === user.id) {
          sessions.delete(value);
          ended++;
        }
      }
      return ended;
    },
    recognizes: (value) => /^[A-Za-z0-9_-]{43}$/.test(value),
  };
  /** Starts a session and returns the Cookie header value to send on later requests. */
  const start = (user: SessionUser = OPERATOR): string => {
    const value = randomBytes(32).toString("base64url");
    sessions.set(value, user);
    return `${SESSION_COOKIE}=${value}`;
  };
  return { store, start, sessions };
}

/** The production pipeline with a stand-in protected route and captured logs. */
function buildApp(signInMethods: string[] = METHODS) {
  const lines: string[] = [];
  const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(line) });
  const { store, start, sessions } = memoryStore();
  const protectedRouter = Router();
  protectedRouter.get("/servers", (_req, res) => {
    res.json({ servers: [] });
  });
  const app = createApp({
    logger,
    allowedOrigins: ["https://satis-manager.com"],
    routers: [healthRouter, createAuthRouter({ store, signInMethods })],
    sessionGuard: createSessionGuard({ store }),
    protectedRouters: [protectedRouter],
  });
  return { app, lines, store, signIn: start, sessions };
}

// ADR-0025 PR 9: password login is gone. The path is an unknown route like any other: 401 to a
// visitor (routes can't be probed), 404 once signed in. Nothing is created either way.
describe("POST /api/auth/login (removed)", () => {
  const login = (app: ReturnType<typeof buildApp>["app"]) =>
    request(app)
      .post(endpoints.auth.login.path())
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ username: "operator", password: "correct horse battery staple" }));

  it("answers a signed-out caller 401 and a signed-in one 404, and sets no cookie", async () => {
    const { app, store, signIn, sessions } = buildApp();
    const anon = await login(app);
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("unauthorized");
    expect(anon.headers["set-cookie"]).toBeUndefined();
    const cookie = signIn();
    const signedIn = await login(app).set("Cookie", cookie);
    expect(signedIn.status).toBe(404);
    expect(signedIn.body.error.code).toBe("not_found");
    expect(signedIn.headers["set-cookie"]).toBeUndefined();
    expect(store.create).not.toHaveBeenCalled();
    expect(sessions.size).toBe(1);
  });

  it("never logs the submitted password", async () => {
    const { app, lines } = buildApp();
    await login(app);
    expect(lines.join("\n")).not.toContain("correct horse battery staple");
  });
});

describe("request body rules (on a body-less auth route)", () => {
  // Issue #19: mutations with a body accept JSON only.
  // A genuinely chunked body has no Content-Length, so it must be detected by
  // Transfer-Encoding. Sent over a raw socket: supertest adds a Content-Length, and
  // Node rejects that combination itself.
  it("also rejects a non-JSON body sent chunked (no Content-Length)", async () => {
    const { app } = buildApp();
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const { port } = server.address() as AddressInfo;
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { port, method: "POST", path: endpoints.auth.logout.path(), headers: { "Content-Type": "text/plain" } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.write("username=");
        req.end("operator");
      });
      expect(status).toBe(415);
    } finally {
      server.close();
    }
  });

  it("answers a text/plain body with 415 unsupported_media_type", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post(endpoints.auth.logout.path())
      .set("Content-Type", "text/plain")
      .send("username=operator&password=x");
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_media_type");
  });

  it("never logs the session cookie", async () => {
    const { app, lines, signIn } = buildApp();
    const cookie = signIn();
    await request(app).get("/api/servers").set("Cookie", cookie);
    await request(app).get(endpoints.auth.session.path()).set("Cookie", cookie);
    expect(lines.join("\n")).not.toContain(cookie.split("=")[1]);
  });
});

describe("GET /api/auth/session", () => {
  it("answers 200 { authenticated: false } when signed out, never 401 (issue #19)", async () => {
    const { app } = buildApp();
    const res = await request(app).get(endpoints.auth.session.path());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, signInMethods: METHODS });
  });

  it("reports the signed-in user, never the internal id", async () => {
    const { app, signIn } = buildApp();
    const res = await request(app).get(endpoints.auth.session.path()).set("Cookie", signIn());
    expect(res.body).toEqual({ authenticated: true, signInMethods: METHODS, user: { name: "operator", authMethods: ["google"] } });
  });

  it("treats a tampered cookie as signed out", async () => {
    const { app, signIn } = buildApp();
    const res = await request(app).get(endpoints.auth.session.path()).set("Cookie", `${signIn()}x`);
    expect(res.body).toEqual({ authenticated: false, signInMethods: METHODS });
  });

  it("with no sign-in method (no database, no Google) answers signInMethods []", async () => {
    const { app } = buildApp([]);
    expect((await request(app).get(endpoints.auth.session.path())).body).toEqual({ authenticated: false, signInMethods: [] });
  });
});

describe("POST /api/auth/logout", () => {
  // Issue #19: the frontend sends logout with no body and no Content-Type.
  it("signs out with a body-less POST and clears the cookie", async () => {
    const { app, signIn } = buildApp();
    const cookie = signIn();
    // Content-Length: 0 is what a browser sends for fetch(url, { method: "POST" }).
    const res = await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie).set("Content-Length", "0");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, signInMethods: METHODS });
    expect([res.headers["set-cookie"]].flat().join("\n")).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));
  });
});

describe("logout revokes the session", () => {
  it("rejects the old cookie after logout, on the guard and on the session route", async () => {
    const { app, signIn } = buildApp();
    const cookie = signIn();
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(401);
    const session = await request(app).get(endpoints.auth.session.path()).set("Cookie", cookie);
    expect(session.body).toEqual({ authenticated: false, signInMethods: METHODS });
  });

  it("revokes only the session that signed out, not another sign-in", async () => {
    const { app, signIn } = buildApp();
    const first = signIn();
    const second = signIn();
    await request(app).post(endpoints.auth.logout.path()).set("Cookie", first);
    expect((await request(app).get("/api/servers").set("Cookie", first)).status).toBe(401);
    expect((await request(app).get("/api/servers").set("Cookie", second)).status).toBe(200);
  });

  it("logging out with no cookie or a garbage cookie is still a 200 no-op", async () => {
    const { app } = buildApp();
    expect((await request(app).post(endpoints.auth.logout.path())).status).toBe(200);
    const garbage = await request(app).post(endpoints.auth.logout.path()).set("Cookie", `${SESSION_COOKIE}=not-a-token`);
    expect(garbage.status).toBe(200);
  });

  it("logging out twice with the same cookie stays 200", async () => {
    const { app, signIn } = buildApp();
    const cookie = signIn();
    await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie);
    expect((await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie)).status).toBe(200);
  });
});

// ADR-0019: JSON is never cached, sniffed, framed or leaked through a referrer.
describe("security headers", () => {
  const expectHeaders = (headers: Record<string, unknown>) => {
    expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(headers["x-powered-by"]).toBeUndefined();
  };

  it("sets them on a public route", async () => {
    const { app } = buildApp();
    expectHeaders((await request(app).get("/api/health")).headers);
  });

  it("sets them on a protected route, an error response and a 404", async () => {
    const { app, signIn } = buildApp();
    const cookie = signIn();
    expectHeaders((await request(app).get("/api/servers").set("Cookie", cookie)).headers);
    expectHeaders((await request(app).get("/api/servers")).headers); // 401
    expectHeaders((await request(app).get("/api/no-such-route").set("Cookie", cookie)).headers); // 404
  });

  it("sets them on the logout response that clears the session cookie", async () => {
    const { app, signIn } = buildApp();
    expectHeaders((await request(app).post(endpoints.auth.logout.path()).set("Cookie", signIn())).headers);
  });

  it("sets them on a CORS preflight answer", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .options(endpoints.auth.logout.path())
      .set("Origin", "https://satis-manager.com")
      .set("Access-Control-Request-Method", "POST");
    expectHeaders(res.headers);
  });
});

describe("security headers on framework-generated failures", () => {
  const expectHeaders = (headers: Record<string, unknown>) => {
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  };

  it("sets them on a malformed JSON body (400), an oversized body (413) and a 415", async () => {
    const { app } = buildApp();
    const bad = await request(app).post(endpoints.auth.logout.path()).set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    expectHeaders(bad.headers);
    const big = await request(app)
      .post(endpoints.auth.logout.path())
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ username: "x".repeat(300_000), password: "y" }));
    expect(big.status).toBe(413);
    expectHeaders(big.headers);
    const wrongType = await request(app).post(endpoints.auth.logout.path()).set("Content-Type", "text/plain").send("hi");
    expect(wrongType.status).toBe(415);
    expectHeaders(wrongType.headers);
  });

  it("sets them on a cross-site refusal", async () => {
    const { app } = buildApp();
    const refused = await request(app).post(endpoints.auth.logout.path()).set("Sec-Fetch-Site", "cross-site");
    expect(refused.status).toBe(400);
    expectHeaders(refused.headers);
  });
});

describe("logout revocation edge cases", () => {
  it("an altered cookie is a no-op and does not revoke the real session", async () => {
    const { app, signIn } = buildApp();
    const cookie = signIn();
    const forged = `${cookie.slice(0, -4)}AAAA`;
    expect((await request(app).post(endpoints.auth.logout.path()).set("Cookie", forged)).status).toBe(200);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
  });

  it("a revoked cookie stays rejected on repeated use, and a new sign-in still works", async () => {
    const { app, signIn } = buildApp();
    const cookie = signIn();
    await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie);
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(401);
    }
    const fresh = signIn();
    expect((await request(app).get("/api/servers").set("Cookie", fresh)).status).toBe(200);
  });
});

describe("cross-site guard across methods", () => {
  it.each(["put", "delete", "post"] as const)("refuses a sibling-subdomain %s and allows the frontend's", async (method) => {
    const { app } = buildApp();
    const sibling = await request(app)[method]("/api/anything").set("Sec-Fetch-Site", "same-site").set("Origin", "https://blog.satis-manager.com");
    expect(sibling.status).toBe(400);
    const cross = await request(app)[method]("/api/anything").set("Sec-Fetch-Site", "cross-site");
    expect(cross.status).toBe(400);
    // Allowed through the guard: fails later (401 from the session guard), not 400.
    const ok = await request(app)[method]("/api/anything").set("Sec-Fetch-Site", "same-site").set("Origin", "https://satis-manager.com");
    expect(ok.status).toBe(401);
  });

  it("does not hold OPTIONS or GET to the guard", async () => {
    const { app } = buildApp();
    const res = await request(app).options("/api/health").set("Sec-Fetch-Site", "cross-site").set("Origin", "https://evil.example");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("the session guard", () => {
  // Issue #19: health and the three auth routes work without a session.
  it.each([
    ["GET", "/api/health"],
    ["GET", endpoints.auth.session.path()],
    ["POST", endpoints.auth.logout.path()],
  ])("lets %s %s through without a session", async (method, path) => {
    const { app } = buildApp();
    const res = method === "GET" ? await request(app).get(path) : await request(app).post(path);
    expect(res.status).toBe(200);
  });

  it("answers a protected route with 401 unauthorized when signed out", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/servers");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "unauthorized", message: "Sign in to continue" });
  });

  it("lets a signed-in request through", async () => {
    const { app, signIn } = buildApp();
    expect((await request(app).get("/api/servers").set("Cookie", signIn())).status).toBe(200);
  });

  it("answers any other /api path with 401 when signed out, so routes can't be probed", async () => {
    const { app, signIn } = buildApp();
    expect((await request(app).get("/api/no-such-route")).status).toBe(401);
    const cookie = signIn();
    expect((await request(app).get("/api/no-such-route").set("Cookie", cookie)).status).toBe(404);
  });
});

describe("CORS (ADR-0011: allowlist, never a wildcard)", () => {
  it("allows the configured frontend origin, with credentials", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/health").set("Origin", "https://satis-manager.com");
    expect(res.headers["access-control-allow-origin"]).toBe("https://satis-manager.com");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("gives any other origin no CORS headers", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

// Found by the security review of PR #24: an empty cross-site form POST to logout
// signed the operator out (the JSON-only rule exempts body-less requests, and logout
// needs no cookie, so SameSite=Lax didn't help). Any future body-less mutation would
// have had the same gap, so cross-site mutations are refused outright.
describe("cross-site mutations", () => {
  const evilLogout = (app: ReturnType<typeof buildApp>["app"], headers: Record<string, string>) => {
    let req = request(app).post(endpoints.auth.logout.path()).set("Content-Type", "application/x-www-form-urlencoded").set("Content-Length", "0");
    for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
    return req;
  };

  it.each([
    ["a cross-site Sec-Fetch-Site", { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" }],
    ["an unlisted Origin (older browser, no Sec-Fetch-Site)", { Origin: "https://evil.example" }],
    ["a null Origin", { Origin: "null" }],
    // ADR-0019: same-site includes any sibling subdomain of the frontend's site.
    ["a sibling subdomain (same-site, Origin not allowlisted)", { "Sec-Fetch-Site": "same-site", Origin: "https://blog.satis-manager.com" }],
    ["a same-site request with a null Origin", { "Sec-Fetch-Site": "same-site", Origin: "null" }],
    ["an unknown Sec-Fetch-Site value", { "Sec-Fetch-Site": "bogus", Origin: "https://satis-manager.com" }],
  ])("refuses a body-less POST with %s, without clearing the cookie", async (_name, headers) => {
    const { app } = buildApp();
    const res = await evilLogout(app, headers);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it.each([
    ["the frontend's own site (same-site)", { "Sec-Fetch-Site": "same-site", Origin: "https://satis-manager.com" }],
    ["the Vite dev proxy (same-origin)", { "Sec-Fetch-Site": "same-origin", Origin: "http://localhost:5173" }],
    ["an allowlisted Origin without Sec-Fetch-Site", { Origin: "https://satis-manager.com" }],
    ["a non-browser client (no Origin, no Sec-Fetch-Site)", {}],
    ["a same-site request with no Origin header", { "Sec-Fetch-Site": "same-site" }],
    ["a user-initiated request (none), whatever its Origin", { "Sec-Fetch-Site": "none", Origin: "null" }],
  ])("allows %s", async (_name, headers) => {
    const { app } = buildApp();
    expect((await evilLogout(app, headers)).status).toBe(200);
  });

  it("still allows cross-site GETs (reads are guarded by the session and CORS instead)", async () => {
    const { app } = buildApp();
    const res = await request(app).get(endpoints.auth.session.path()).set("Sec-Fetch-Site", "cross-site");
    expect(res.status).toBe(200);
  });
});

// ADR-0025: signInMethods rides on every SessionResponse, signed in or out.
describe("signInMethods with Google configured and sign-up open", () => {
  const OPEN = ["google", "google_signup"];

  it("is sent on session (in and out), logout and logout-all", async () => {
    const { app, signIn } = buildApp(OPEN);
    const cookie = signIn();
    const inRes = await request(app).get(endpoints.auth.session.path()).set("Cookie", cookie);
    expect(inRes.body).toEqual({ authenticated: true, signInMethods: OPEN, user: { name: "operator", authMethods: ["google"] } });
    expect((await request(app).get(endpoints.auth.session.path())).body).toEqual({ authenticated: false, signInMethods: OPEN });
    const out = await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie);
    expect(out.body).toEqual({ authenticated: false, signInMethods: OPEN });
    const cookie2 = signIn();
    const cookie3 = signIn();
    const all = await request(app).post(endpoints.auth.logoutAll.path()).set("Cookie", cookie2);
    expect(all.body).toEqual({ authenticated: false, signInMethods: OPEN });
    expect((await request(app).get("/api/servers").set("Cookie", cookie3)).status).toBe(401); // every session ended
    // No session at all: still the same answer.
    const anon = await request(app).post(endpoints.auth.logoutAll.path());
    expect(anon.body).toEqual({ authenticated: false, signInMethods: OPEN });
  });
});
