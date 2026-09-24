import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { Router } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ApiErrorResponseSchema, SessionResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { healthRouter } from "../../../platform/health.js";
import { LOGIN_REQUESTS_PER_WINDOW, createAuthRouter } from "./auth.js";
import { createSessionGuard, SESSION_COOKIE } from "../session.js";
import { SessionDenylist } from "../sessionDenylist.js";
import { createStatelessSessionStore } from "../statelessSessionStore.js";
import { SingleOperatorAuthenticator } from "../authenticator.js";
import { hashPassword, parsePasswordHash } from "../passwordHash.js";
import type { ParsedPasswordHash } from "../passwordHash.js";
import { LoginRateLimiter, MAX_FAILURES } from "../loginRateLimiter.js";

const PASSWORD = "correct horse battery staple";
const SECRET = "q7Vw2kZ9xLm4TpR8vNc3HbYd6JfUe1SaGo5iXqKzWt0=";
let passwordHash: ParsedPasswordHash;

beforeAll(async () => {
  passwordHash = parsePasswordHash(await hashPassword(PASSWORD))!;
});

/** The production pipeline with a stand-in protected route and captured logs. */
function buildApp() {
  const lines: string[] = [];
  const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(line) });
  const authenticator = new SingleOperatorAuthenticator("operator", passwordHash);
  const deps = {
    authenticator,
    store: createStatelessSessionStore({ authenticator, sessionSecret: SECRET, denylist: new SessionDenylist() }),
  };
  const protectedRouter = Router();
  protectedRouter.get("/servers", (_req, res) => {
    res.json({ servers: [] });
  });
  const app = createApp({
    logger,
    allowedOrigins: ["https://satis-manager.com"],
    routers: [healthRouter, createAuthRouter({ ...deps, rateLimiter: new LoginRateLimiter() })],
    sessionGuard: createSessionGuard({ store: deps.store }),
    protectedRouters: [protectedRouter],
  });
  return { app, lines };
}

const login = (app: ReturnType<typeof buildApp>["app"], body: object) =>
  request(app).post(endpoints.auth.login.path()).set("Content-Type", "application/json").send(JSON.stringify(body));

/** Signs in and returns the Cookie header value to send on later requests. */
async function signIn(app: ReturnType<typeof buildApp>["app"]): Promise<string> {
  const res = await login(app, { username: "operator", password: PASSWORD });
  expect(res.status).toBe(200);
  const setCookie = [res.headers["set-cookie"]].flat().find((c: string) => c.startsWith(`${SESSION_COOKIE}=`))!;
  return setCookie.split(";")[0];
}

describe("POST /api/auth/login", () => {
  it("signs in with a session cookie that is httpOnly, Secure, SameSite=Lax and scoped to /api", async () => {
    const { app } = buildApp();
    const res = await login(app, { username: "operator", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(SessionResponseSchema.parse(res.body)).toEqual({ authenticated: true, signInMethods: ["password"], user: { name: "operator" } });
    const cookie = [res.headers["set-cookie"]].flat().join("\n");
    expect(cookie).toMatch(new RegExp(`${SESSION_COOKIE}=`));
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api", "Max-Age="]) {
      expect(cookie).toContain(flag);
    }
  });

  it("never puts the session token in the response body", async () => {
    const { app } = buildApp();
    const res = await login(app, { username: "operator", password: PASSWORD });
    const token = [res.headers["set-cookie"]].flat()[0].split(";")[0].split("=")[1];
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it.each([
    ["a wrong password", { username: "operator", password: "wrong password here" }],
    ["a wrong username", { username: "someone", password: PASSWORD }],
  ])("answers %s with the same 401, without saying which part was wrong", async (_name, body) => {
    const { app } = buildApp();
    const res = await login(app, body);
    expect(res.status).toBe(401);
    expect(ApiErrorResponseSchema.parse(res.body).error).toMatchObject({
      code: "unauthorized",
      message: "Invalid username or password",
    });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("answers a body that isn't a login request with 400", async () => {
    const { app } = buildApp();
    const res = await login(app, { username: "operator" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

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
          { port, method: "POST", path: endpoints.auth.login.path(), headers: { "Content-Type": "text/plain" } },
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

  it("answers a text/plain login with 415 unsupported_media_type", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post(endpoints.auth.login.path())
      .set("Content-Type", "text/plain")
      .send("username=operator&password=x");
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_media_type");
  });

  it(`rate-limits an IP after ${MAX_FAILURES} failures, even for the right password, with Retry-After`, async () => {
    const { app } = buildApp();
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect((await login(app, { username: "operator", password: `wrong-${i}` })).status).toBe(401);
    }
    const res = await login(app, { username: "operator", password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("rate_limited");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  // Found by CodeQL on PR #24 (js/missing-rate-limiting): the failure counter above
  // doesn't cap malformed or repeated successful requests, so the route also has an
  // outer per-IP cap on every login request.
  it(`caps all login requests per IP at ${LOGIN_REQUESTS_PER_WINDOW}, not just failures`, async () => {
    const { app } = buildApp();
    for (let i = 0; i < LOGIN_REQUESTS_PER_WINDOW; i++) {
      expect((await login(app, { nonsense: i })).status).toBe(400); // malformed, not a failure
    }
    const res = await login(app, { nonsense: "one too many" });
    expect(res.status).toBe(429);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("rate_limited");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  // Found by PR #24's fresh-eyes review: failures were counted only after the slow
  // password check, so parallel guesses all got through before any was counted.
  it(`stops parallel guessing at ${MAX_FAILURES} attempts`, async () => {
    const { app } = buildApp();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => login(app, { username: "operator", password: `parallel-wrong-${i}` })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(MAX_FAILURES);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(12 - MAX_FAILURES);
  });

  // Go-live blocker (issue #19): behind the tunnel every request comes from loopback,
  // like supertest's here. Visitors must be told apart by CF-Connecting-IP, or one
  // attacker's failures would lock everyone out.
  it("keeps separate lockout counts per tunnel visitor (CF-Connecting-IP)", async () => {
    const { app } = buildApp();
    const loginAs = (visitor: string, password: string) =>
      request(app)
        .post(endpoints.auth.login.path())
        .set("Content-Type", "application/json")
        .set("CF-Connecting-IP", visitor)
        .send(JSON.stringify({ username: "operator", password }));
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect((await loginAs("203.0.113.5", `attacker-${i}`)).status).toBe(401);
    }
    expect((await loginAs("203.0.113.5", PASSWORD)).status).toBe(429);
    expect((await loginAs("198.51.100.7", PASSWORD)).status).toBe(200); // the owner still gets in
  });

  // Found by the security review of PR #24: people type their password into the
  // username field, so a failed login must not log the submitted username verbatim.
  it("doesn't log the submitted username on a failed login, only whether it matched", async () => {
    const { app, lines } = buildApp();
    await login(app, { username: "Hunter2-MyRealPassw0rd", password: "whatever-else" });
    const failure = lines.map((line) => JSON.parse(line)).find((line) => line.msg === "login failed");
    expect(failure).toMatchObject({ usernameMatched: false });
    expect(lines.join(" ")).not.toContain("Hunter2-MyRealPassw0rd");
  });

  it("never logs the submitted password or the session cookie", async () => {
    const { app, lines } = buildApp();
    await login(app, { username: "operator", password: "wrong-password-xyz-123" });
    const cookie = await signIn(app);
    await request(app).get("/api/servers").set("Cookie", cookie);
    const logged = lines.join("\n");
    expect(logged).not.toContain("wrong-password-xyz-123");
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain(cookie.split("=")[1]);
    expect(logged).toContain("login failed");
  });
});

describe("GET /api/auth/session", () => {
  it("answers 200 { authenticated: false } when signed out, never 401 (issue #19)", async () => {
    const { app } = buildApp();
    const res = await request(app).get(endpoints.auth.session.path());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, signInMethods: ["password"] });
  });

  it("reports the signed-in user", async () => {
    const { app } = buildApp();
    const cookie = await signIn(app);
    const res = await request(app).get(endpoints.auth.session.path()).set("Cookie", cookie);
    expect(res.body).toEqual({ authenticated: true, signInMethods: ["password"], user: { name: "operator" } });
  });

  it("treats a tampered cookie as signed out", async () => {
    const { app } = buildApp();
    const cookie = await signIn(app);
    const res = await request(app).get(endpoints.auth.session.path()).set("Cookie", `${cookie}x`);
    expect(res.body).toEqual({ authenticated: false, signInMethods: ["password"] });
  });
});

describe("POST /api/auth/logout", () => {
  // Issue #19: the frontend sends logout with no body and no Content-Type.
  it("signs out with a body-less POST and clears the cookie", async () => {
    const { app } = buildApp();
    const cookie = await signIn(app);
    // Content-Length: 0 is what a browser sends for fetch(url, { method: "POST" }).
    const res = await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie).set("Content-Length", "0");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, signInMethods: ["password"] });
    expect([res.headers["set-cookie"]].flat().join("\n")).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));
  });
});

// ADR-0019: logout adds the session's id to a denylist, so a copied cookie stops working.
describe("logout revokes the session", () => {
  it("rejects the old cookie after logout, on the guard and on the session route", async () => {
    const { app } = buildApp();
    const cookie = await signIn(app);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(401);
    const session = await request(app).get(endpoints.auth.session.path()).set("Cookie", cookie);
    expect(session.body).toEqual({ authenticated: false, signInMethods: ["password"] });
  });

  it("revokes only the session that signed out, not another sign-in", async () => {
    const { app } = buildApp();
    const first = await signIn(app);
    const second = await signIn(app);
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
    const { app } = buildApp();
    const cookie = await signIn(app);
    await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie);
    expect((await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie)).status).toBe(200);
  });
});

// ADR-0019: JSON is never cached, sniffed, framed or leaked through a referrer.
describe("security headers", () => {
  const expectHeaders = (headers: Record<string, unknown>) => {
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
    const { app } = buildApp();
    const cookie = await signIn(app);
    expectHeaders((await request(app).get("/api/servers").set("Cookie", cookie)).headers);
    expectHeaders((await request(app).get("/api/servers")).headers); // 401
    expectHeaders((await request(app).get("/api/no-such-route").set("Cookie", cookie)).headers); // 404
  });

  it("sets them on the login response that carries the session cookie", async () => {
    const { app } = buildApp();
    expectHeaders((await login(app, { username: "operator", password: PASSWORD })).headers);
  });

  it("sets them on a CORS preflight answer", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .options(endpoints.auth.login.path())
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
    const bad = await request(app).post(endpoints.auth.login.path()).set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    expectHeaders(bad.headers);
    const big = await request(app)
      .post(endpoints.auth.login.path())
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ username: "x".repeat(300_000), password: "y" }));
    expect(big.status).toBe(413);
    expectHeaders(big.headers);
    const wrongType = await request(app).post(endpoints.auth.login.path()).set("Content-Type", "text/plain").send("hi");
    expect(wrongType.status).toBe(415);
    expectHeaders(wrongType.headers);
  });

  it("sets them on a cross-site refusal and on a 429 rate-limit answer", async () => {
    const { app } = buildApp();
    const refused = await request(app).post(endpoints.auth.logout.path()).set("Sec-Fetch-Site", "cross-site");
    expect(refused.status).toBe(400);
    expectHeaders(refused.headers);
    let last = await login(app, { username: "operator", password: "wrong" });
    for (let i = 0; i < MAX_FAILURES; i++) last = await login(app, { username: "operator", password: "wrong" });
    expect(last.status).toBe(429);
    expect(last.headers["retry-after"]).toBeDefined();
    expectHeaders(last.headers);
  });
});

describe("logout revocation edge cases", () => {
  it("a forged signature is a no-op and does not revoke the real session", async () => {
    const { app } = buildApp();
    const cookie = await signIn(app);
    const [payload] = cookie.slice(`${SESSION_COOKIE}=`.length).split(".");
    const forged = `${SESSION_COOKIE}=${payload}.AAAA`;
    expect((await request(app).post(endpoints.auth.logout.path()).set("Cookie", forged)).status).toBe(200);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
  });

  it("a revoked cookie stays rejected on repeated use, and a new sign-in still works", async () => {
    const { app } = buildApp();
    const cookie = await signIn(app);
    await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie);
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(401);
    }
    const fresh = await signIn(app);
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
    const { app } = buildApp();
    const cookie = await signIn(app);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
  });

  it("answers any other /api path with 401 when signed out, so routes can't be probed", async () => {
    const { app } = buildApp();
    expect((await request(app).get("/api/no-such-route")).status).toBe(401);
    const cookie = await signIn(app);
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
