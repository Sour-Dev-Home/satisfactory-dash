import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { UnauthorizedError } from "../../../platform/errorResponse.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { startFakeOidcIssuer } from "../../../../test-support/fakeOidcIssuer.js";
import type { FakeOidcIssuer } from "../../../../test-support/fakeOidcIssuer.js";
import { beginGoogleSignIn, completeGoogleSignIn } from "../../../../test-support/googleFlow.js";
import type { GoogleConfig } from "../googleConfig.js";
import { createGoogleOidc } from "../googleOidc.js";
import type { GoogleSignIn, GoogleSignInResult } from "../googleSignIn.js";
import { SESSION_COOKIE } from "../session.js";
import { LOGIN_REQUESTS_PER_WINDOW } from "./loginRequestCap.js";
import { LOGIN_ATTEMPT_COOKIE, createGoogleAuthRouter, createGoogleDisabledRouter } from "./googleAuth.js";

const CLIENT_ID = "test-client-id";
const FRONTEND = "https://satis-manager.com";
const REDIRECT_URI = "http://localhost:3001/api/auth/google/callback";

/** Just enough of identity.login_attempts for the router (the real SQL runs in the DB tests). */
class FakeAttemptDb implements Queryable {
  rows = new Map<string, { state: string; nonce: string; code_verifier: string; return_path: string; expires: number }>();
  failWith: Error | undefined;
  query(sql: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    const key = (values[0] as Buffer).toString("hex");
    if (sql.includes("INSERT INTO identity.login_attempts")) {
      const [, state, nonce, code_verifier, return_path] = values as string[];
      this.rows.set(key, { state: state!, nonce: nonce!, code_verifier: code_verifier!, return_path: return_path!, expires: Date.now() + 600_000 });
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("DELETE FROM identity.login_attempts") && sql.includes("id_hash = $1")) {
      const row = this.rows.get(key);
      this.rows.delete(key);
      return Promise.resolve({ rows: row && row.expires > Date.now() ? [row] : [] });
    }
    return Promise.reject(new Error(`unexpected SQL in test: ${sql.slice(0, 40)}`));
  }
  expireAll() {
    for (const row of this.rows.values()) {
      row.expires = Date.now() - 1;
    }
  }
}

const signedIn: GoogleSignInResult = {
  kind: "signed_in",
  session: { cookieValue: "S".repeat(43), maxAgeSeconds: 28_800, user: { id: "u-1", name: "Owner", authMethods: ["google"] } },
};

describe("Google sign-in routes", () => {
  let issuer: FakeOidcIssuer;
  const config: GoogleConfig = {
    clientId: CLIENT_ID,
    clientSecret: "test-client-secret",
    redirectUri: REDIRECT_URI,
    bootstrapOwnerEmail: "owner@example.com",
    frontendOrigin: FRONTEND,
  };

  beforeAll(async () => {
    issuer = await startFakeOidcIssuer(CLIENT_ID);
  });
  afterAll(async () => {
    await issuer.close();
  });

  function build(options: { result?: GoogleSignInResult; issuerUrl?: URL } = {}) {
    const db = new FakeAttemptDb();
    const complete = vi.fn(async (): Promise<GoogleSignInResult> => options.result ?? signedIn);
    const signIn: GoogleSignIn = { complete };
    const lines: Record<string, unknown>[] = [];
    const app = createApp({
      logger: createLogger({ level: "info" }, { write: (line: string) => lines.push(JSON.parse(line)) }),
      allowedOrigins: [],
      routers: [
        createGoogleAuthRouter({
          config,
          oidc: createGoogleOidc(config, { issuer: options.issuerUrl ?? issuer.issuer, allowInsecureRequests: true }),
          signIn,
          db,
        }),
      ],
      sessionGuard: (_req, _res, next) => next(new UnauthorizedError("Sign in to continue")),
    });
    return { app, db, complete, lines };
  }

  const setCookies = (res: request.Response) => [res.headers["set-cookie"] ?? []].flat() as string[];

  describe("GET /start", () => {
    it("redirects to the provider with S256 PKCE, state, nonce and only the openid email scope", async () => {
      const { app } = build();
      const { start, authUrl } = await beginGoogleSignIn(app);
      expect(start.status).toBe(302);
      expect(authUrl!.origin).toBe(issuer.issuer.origin);
      expect(authUrl!.pathname).toBe("/authorize");
      const p = authUrl!.searchParams;
      expect(p.get("client_id")).toBe(CLIENT_ID);
      expect(p.get("redirect_uri")).toBe(REDIRECT_URI);
      expect(p.get("response_type")).toBe("code");
      expect(p.get("scope")).toBe("openid email");
      expect(p.get("code_challenge_method")).toBe("S256");
      expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(p.get("state")!.length).toBeGreaterThanOrEqual(16);
      expect(p.get("nonce")!.length).toBeGreaterThanOrEqual(16);
      expect(start.headers["cache-control"]).toBe("no-store");
    });

    it("sets one cookie holding only a random attempt id: HttpOnly, Secure, Lax, scoped, 10 minutes", async () => {
      const { app, db } = build();
      const { start, attemptCookie, authUrl } = await beginGoogleSignIn(app);
      const cookie = setCookies(start).find((c) => c.startsWith(`${LOGIN_ATTEMPT_COOKIE}=`))!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\/api\/auth\/google(;|$)/);
      expect(cookie).toMatch(/Max-Age=600/);
      const id = attemptCookie.split("=")[1]!;
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // The state, nonce and verifier are server-side only: none of them is in the cookie.
      const row = [...db.rows.values()][0]!;
      for (const secret of [row.state, row.nonce, row.code_verifier]) {
        expect(cookie).not.toContain(secret);
      }
      expect(authUrl!.searchParams.get("state")).toBe(row.state);
    });

    it("stores a valid /app return path", async () => {
      const { app, db } = build();
      await beginGoogleSignIn(app, "/app/servers/main?tab=power");
      expect([...db.rows.values()][0]!.return_path).toBe("/app/servers/main?tab=power");
    });

    it.each(["https://evil.example/app", "//evil.example", "/app/../admin", "/appx", "/elsewhere", "/app\\evil", "javascript:alert(1)", "/app/é"])(
      "falls back to /app for a return path that is not a safe /app path: %s",
      async (bad) => {
        const { app, db } = build();
        const { start } = await beginGoogleSignIn(app, bad);
        expect(start.status).toBe(302);
        expect([...db.rows.values()][0]!.return_path).toBe("/app");
      },
    );

    it("caches discovery: a second /start does not fetch the provider's metadata again", async () => {
      const { app } = build();
      await beginGoogleSignIn(app);
      const before = issuer.hits()["/.well-known/openid-configuration"] ?? 0;
      await beginGoogleSignIn(app);
      expect(issuer.hits()["/.well-known/openid-configuration"]).toBe(before);
    });

    it("answers 503 service_unavailable when Google is unreachable, writes nothing, and leaves the rest of the API alone", async () => {
      const { app, db } = build({ issuerUrl: new URL("http://127.0.0.1:1") });
      const res = await request(app).get("/api/auth/google/start");
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("service_unavailable");
      expect(db.rows.size).toBe(0);
      expect(setCookies(res).some((c) => c.startsWith(`${LOGIN_ATTEMPT_COOKIE}=`))).toBe(false);
      // Any other route still answers normally (here: the guard's 401, not a crash or a hang).
      expect((await request(app).get("/api/anything")).status).toBe(401);
    });

    it("answers 503 when the database is down, without leaving a cookie", async () => {
      const { app, db } = build();
      db.failWith = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      const res = await request(app).get("/api/auth/google/start");
      expect(res.status).toBe(503);
      expect(setCookies(res).some((c) => c.startsWith(`${LOGIN_ATTEMPT_COOKIE}=`))).toBe(false);
    });

    it(`is capped per IP at ${LOGIN_REQUESTS_PER_WINDOW} requests`, async () => {
      const { app } = build();
      for (let i = 0; i < LOGIN_REQUESTS_PER_WINDOW; i++) {
        expect((await request(app).get("/api/auth/google/start")).status).toBe(302);
      }
      expect((await request(app).get("/api/auth/google/start")).status).toBe(429);
    });
  });

  describe("GET /callback", () => {
    const claims = { sub: "google-sub-1", email: "owner@example.com", email_verified: true };
    const location = (res: request.Response) => new URL(res.headers.location!);

    it("signs in: sets the session cookie, clears the attempt cookie, redirects to the frontend + the stored path", async () => {
      const { app, complete } = build();
      const begun = await beginGoogleSignIn(app, "/app/servers/main");
      const old = "O".repeat(43);
      const res = await completeGoogleSignIn(app, issuer, begun, { claims, extraCookies: [`${SESSION_COOKIE}=${old}`] });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${FRONTEND}/app/servers/main`);
      const cookies = setCookies(res);
      expect(cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=${"S".repeat(43)}`))).toMatch(/HttpOnly/i);
      expect(cookies.find((c) => c.startsWith(`${LOGIN_ATTEMPT_COOKIE}=;`))).toBeDefined();
      expect(complete).toHaveBeenCalledWith({ sub: "google-sub-1", email: "owner@example.com", emailVerified: true }, old);
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("never reflects query parameters into the redirect", async () => {
      const { app } = build();
      const begun = await beginGoogleSignIn(app);
      const res = await completeGoogleSignIn(app, issuer, begun, { claims });
      expect(res.headers.location).toBe(`${FRONTEND}/app`);
      const denied = await request(app)
        .get("/api/auth/google/callback?error=access_denied&redirect=https://evil.example&return=//evil.example")
        .set("Cookie", (await beginGoogleSignIn(app)).attemptCookie);
      expect(denied.headers.location).toBe(`${FRONTEND}/app/login?error=denied`);
    });

    it("is single use: a replayed callback finds no attempt", async () => {
      const { app, complete } = build();
      const begun = await beginGoogleSignIn(app);
      const first = await completeGoogleSignIn(app, issuer, begun, { claims });
      expect(first.headers.location).toBe(`${FRONTEND}/app`);
      const replay = await completeGoogleSignIn(app, issuer, begun, { claims });
      expect(replay.headers.location).toBe(`${FRONTEND}/app/login?error=expired`);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(setCookies(replay).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    });

    it("refuses an expired attempt", async () => {
      const { app, db, complete } = build();
      const begun = await beginGoogleSignIn(app);
      db.expireAll();
      const res = await completeGoogleSignIn(app, issuer, begun, { claims });
      expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=expired`);
      expect(complete).not.toHaveBeenCalled();
    });

    it("refuses a callback that carries no attempt cookie (another browser) without touching the provider", async () => {
      const { app, complete } = build();
      const begun = await beginGoogleSignIn(app);
      const tokenHitsBefore = issuer.hits()["/token"] ?? 0;
      const res = await completeGoogleSignIn(app, issuer, begun, { claims, omitAttemptCookie: true });
      expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=expired`);
      expect(issuer.hits()["/token"] ?? 0).toBe(tokenHitsBefore);
      expect(complete).not.toHaveBeenCalled();
    });

    it("refuses a wrong state", async () => {
      const { app, complete } = build();
      const begun = await beginGoogleSignIn(app);
      const res = await completeGoogleSignIn(app, issuer, begun, { claims, state: "attacker-chosen-state-value" });
      expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=failed`);
      expect(complete).not.toHaveBeenCalled();
    });

    it("refuses an ID token whose nonce does not match", async () => {
      const { app, complete } = build();
      const begun = await beginGoogleSignIn(app);
      const res = await completeGoogleSignIn(app, issuer, begun, { claims, nonce: "some-other-nonce-value-000000" });
      expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=failed`);
      expect(complete).not.toHaveBeenCalled();
    });

    it("maps the user denying consent to error=denied and never passes Google's text through", async () => {
      const { app, complete } = build();
      const begun = await beginGoogleSignIn(app);
      const res = await request(app)
        .get("/api/auth/google/callback?error=access_denied&error_description=%3Cscript%3E&state=x")
        .set("Cookie", begun.attemptCookie);
      expect(location(res).href).toBe(`${FRONTEND}/app/login?error=denied`);
      const other = await request(app)
        .get("/api/auth/google/callback?error=server_error&error_description=leak-me")
        .set("Cookie", (await beginGoogleSignIn(app)).attemptCookie);
      expect(other.headers.location).toBe(`${FRONTEND}/app/login?error=failed`);
      expect(complete).not.toHaveBeenCalled();
    });

    it.each([
      ["not_invited", "not_invited"],
      ["disabled", "failed"],
      ["unverified_email", "failed"],
    ] as const)("a refused sign-in (%s) redirects with error=%s and starts no session", async (reason, code) => {
      const { app } = build({ result: { kind: "refused", reason } });
      const begun = await beginGoogleSignIn(app);
      const res = await completeGoogleSignIn(app, issuer, begun, { claims });
      expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=${code}`);
      expect(setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    });

    it("hands the raw email_verified claim to the sign-in service (the string \"true\" is not a boolean)", async () => {
      const { app, complete } = build();
      const begun = await beginGoogleSignIn(app);
      await completeGoogleSignIn(app, issuer, begun, { claims: { ...claims, email_verified: "true" } });
      expect(complete).toHaveBeenCalledWith(expect.objectContaining({ emailVerified: "true" }), undefined);
    });

    it("refuses an unusable subject (empty or over 255 characters) without calling the sign-in service", async () => {
      for (const sub of ["x".repeat(256), ""]) {
        const { app, complete } = build();
        const begun = await beginGoogleSignIn(app);
        const res = await completeGoogleSignIn(app, issuer, begun, { claims: { ...claims, sub } });
        expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=failed`);
        expect(complete).not.toHaveBeenCalled();
      }
    });

    it("treats a malformed attempt cookie as expired, without querying the database", async () => {
      const { app, db } = build();
      const spy = vi.spyOn(db, "query");
      const res = await request(app).get("/api/auth/google/callback?code=x&state=y").set("Cookie", `${LOGIN_ATTEMPT_COOKIE}=not-a-valid-id`);
      expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=expired`);
      expect(spy).not.toHaveBeenCalled();
    });

    it("logs a code and no claims, cookies or provider text on failure", async () => {
      const { app, lines } = build();
      const begun = await beginGoogleSignIn(app);
      await completeGoogleSignIn(app, issuer, begun, { claims, nonce: "some-other-nonce-value-000000" });
      const text = JSON.stringify(lines);
      expect(text).toContain("google sign-in failed");
      for (const secret of ["owner@example.com", "google-sub-1", begun.attemptCookie.split("=")[1]!, "test-client-secret"]) {
        expect(text).not.toContain(secret);
      }
    });

    it("answers with the unavailable code when the database is down mid-callback", async () => {
      const { app, db } = build();
      const begun = await beginGoogleSignIn(app);
      db.failWith = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      const res = await completeGoogleSignIn(app, issuer, begun, { claims });
      expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=unavailable`);
    });
  });

  describe("Google not configured", () => {
    it("answers 404 not_found for every /api/auth/google/* path, before the session guard", async () => {
      const app = createApp({
        logger: createLogger({ level: "silent" }, { write: () => {} }),
        allowedOrigins: [],
        routers: [createGoogleDisabledRouter()],
        sessionGuard: (_req, _res, next) => next(new UnauthorizedError("Sign in to continue")),
      });
      for (const path of ["/api/auth/google/start", "/api/auth/google/callback", "/api/auth/google/anything"]) {
        const res = await request(app).get(path);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("not_found");
      }
    });
  });
});
