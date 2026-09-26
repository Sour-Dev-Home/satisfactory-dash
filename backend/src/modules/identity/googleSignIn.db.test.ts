import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import request from "supertest";
import { Router } from "express";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { startFakeOidcIssuer } from "../../../test-support/fakeOidcIssuer.js";
import type { FakeOidcIssuer, FakeClaims } from "../../../test-support/fakeOidcIssuer.js";
import { beginGoogleSignIn, completeGoogleSignIn } from "../../../test-support/googleFlow.js";
import { hashPassword } from "./passwordHash.js";
import { createIdentityModule } from "./index.js";
import { SESSION_COOKIE } from "./session.js";
import { startSession } from "./dbSessionStore.js";
import { setUserStatus } from "./repositories/userRepository.js";

// ADR-0025 PR 7 against a real Postgres, as satis_app, through the real HTTP pipeline and a local
// fake OpenID provider (real discovery, JWKS, PKCE check and RS256 ID tokens).
const available = dbTestsAvailable();
const CLIENT_ID = "test-client-id";
const FRONTEND = "https://satis-manager.com";
const OWNER_EMAIL = "owner@example.com";
const SECRET = "q7Vw2kZ9xLm4TpR8vNc3HbYd6JfUe1SaGo5iXqKzWt0=";

describe.skipIf(!available)("Google sign-in against Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let issuer: FakeOidcIssuer;
  let passwordHash: string;
  let operatorId: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 8 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    issuer = await startFakeOidcIssuer(CLIENT_ID);
    passwordHash = await hashPassword("correct horse battery staple");
  }, 60_000);

  afterAll(async () => {
    await issuer?.close();
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await admin.query(
      "TRUNCATE identity.users, identity.auth_identities, identity.sessions, identity.login_attempts, servers.servers, servers.server_members, audit.audit_events CASCADE",
    );
    const identity = createIdentityModule(
      {
        DASHBOARD_ADMIN_USER: "operator",
        DASHBOARD_ADMIN_PASSWORD_HASH: passwordHash,
        SESSION_SECRET: SECRET,
        CORS_ALLOWED_ORIGINS: "",
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: "test-client-secret",
        GOOGLE_REDIRECT_URI: "http://localhost:3001/api/auth/google/callback",
        BOOTSTRAP_OWNER_EMAIL: OWNER_EMAIL,
      },
      { db: pool, googleOidc: { issuer: issuer.issuer, allowInsecureRequests: true } },
    );
    operatorId = await identity.ensureOperatorUserId!();
    // The operator owns a server, as create and import-servers seed it.
    const server = await admin.query("INSERT INTO servers.servers (public_id, display_name) VALUES ('main', 'Main') RETURNING id");
    await admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, $2, 'owner')", [
      server.rows[0].id,
      operatorId,
    ]);
    const protectedRouter = Router();
    protectedRouter.get("/servers", (_req, res) => void res.json({ servers: [] }));
    app = createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      allowedOrigins: [FRONTEND],
      routers: [identity.authRouter],
      sessionGuard: identity.sessionGuard,
      protectedRouters: [protectedRouter],
    });
  });

  const owner: FakeClaims = { sub: "google-sub-owner", email: OWNER_EMAIL, email_verified: true };
  const count = async (sql: string, values: unknown[] = []) => Number((await admin.query(sql, values)).rows[0].n);
  const users = () => count("SELECT count(*) AS n FROM identity.users");
  const identities = () => count("SELECT count(*) AS n FROM identity.auth_identities");
  const signIn = async (claims: FakeClaims, extra: { extraCookies?: string[] } = {}) => {
    const begun = await beginGoogleSignIn(app);
    return completeGoogleSignIn(app, issuer, begun, { claims, ...extra });
  };
  const sessionCookieOf = (res: request.Response) =>
    ([res.headers["set-cookie"] ?? []].flat() as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(";")[0];
  const auditActions = async () => (await admin.query("SELECT action, actor_user_id, detail FROM audit.audit_events ORDER BY id")).rows;

  it("links the bootstrap owner's Google account to the seeded operator: memberships carry over, a session starts", async () => {
    const before = await users();
    const res = await signIn({ ...owner, email: "Owner@Example.COM" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${FRONTEND}/app`);
    // The session works on a protected route.
    const cookie = sessionCookieOf(res)!;
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
    // No new user; the identity is on the operator, whose email is now stored lowercased.
    expect(await users()).toBe(before);
    const linked = await admin.query("SELECT user_id FROM identity.auth_identities WHERE provider = 'google' AND provider_subject = $1", [owner.sub]);
    expect(linked.rows.map((r) => r.user_id)).toEqual([operatorId]);
    expect((await admin.query("SELECT email FROM identity.users WHERE id = $1", [operatorId])).rows[0].email).toBe(OWNER_EMAIL);
    // Memberships are untouched.
    const members = await admin.query("SELECT role FROM servers.server_members WHERE user_id = $1", [operatorId]);
    expect(members.rows).toEqual([{ role: "owner" }]);
    // The audit row: ids and codes only.
    const login = (await auditActions()).find((row) => row.action === "login")!;
    expect(login.actor_user_id).toBe(operatorId);
    expect(login.detail).toEqual({ provider: "google" });
    expect(JSON.stringify(await auditActions())).not.toContain("example.com");
    // The account now reports the Google method.
    const session = await request(app).get("/api/auth/session").set("Cookie", cookie);
    expect(session.body.user.authMethods).toEqual(expect.arrayContaining(["google", "password"]));
  });

  it("honors the return path", async () => {
    const begun = await beginGoogleSignIn(app, "/app/servers/main?tab=power");
    const res = await completeGoogleSignIn(app, issuer, begun, { claims: owner });
    expect(res.headers.location).toBe(`${FRONTEND}/app/servers/main?tab=power`);
  });

  it("finds a returning user by sub, even when the email changed", async () => {
    await signIn(owner);
    const again = await signIn({ sub: owner.sub, email: "someone.else@example.org", email_verified: true });
    expect(again.headers.location).toBe(`${FRONTEND}/app`);
    expect(sessionCookieOf(again)).toBeDefined();
    expect(await users()).toBe(1);
    expect((await admin.query("SELECT email FROM identity.users WHERE id = $1", [operatorId])).rows[0].email).toBe(OWNER_EMAIL);
  });

  it("refuses an unknown Google account (closed sign-up): no user, no identity, no email stored, no session", async () => {
    const usersBefore = await users();
    const identitiesBefore = await identities();
    const res = await signIn({ sub: "google-sub-stranger", email: "stranger@example.net", email_verified: true });
    expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=not_invited`);
    expect(sessionCookieOf(res)).toBeUndefined();
    expect(await users()).toBe(usersBefore);
    expect(await identities()).toBe(identitiesBefore);
    expect(await count("SELECT count(*) AS n FROM identity.users WHERE email IS NOT NULL")).toBe(0);
    const refused = (await auditActions()).filter((row) => row.action === "signin.refused");
    expect(refused).toEqual([{ action: "signin.refused", actor_user_id: null, detail: { provider: "google", reason: "not_invited" } }]);
    expect(JSON.stringify(await auditActions())).not.toContain("stranger");
  });

  it.each([
    ["false", false],
    ['the string "true"', "true"],
    ["missing", undefined],
  ])("refuses an unverified email (email_verified %s), even the bootstrap owner's", async (_label, value) => {
    const res = await signIn({ sub: owner.sub, email: OWNER_EMAIL, email_verified: value });
    expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=failed`);
    expect(sessionCookieOf(res)).toBeUndefined();
    expect(await identities()).toBe(1); // only the operator's local identity
    expect((await auditActions()).find((row) => row.action === "signin.refused")!.detail).toEqual({
      provider: "google",
      reason: "unverified_email",
    });
  });

  it("does not link a second Google account that claims the bootstrap email once the operator is linked", async () => {
    await signIn(owner);
    const res = await signIn({ sub: "google-sub-impostor", email: OWNER_EMAIL, email_verified: true });
    expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=not_invited`);
    expect(await identities()).toBe(2); // local + the first google
  });

  it("refuses a disabled user even with a valid identity", async () => {
    await signIn(owner);
    await setUserStatus(pool, operatorId, "disabled");
    const res = await signIn(owner);
    expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=failed`);
    expect(sessionCookieOf(res)).toBeUndefined();
    const refused = (await auditActions()).filter((row) => row.action === "signin.refused");
    expect(refused).toEqual([{ action: "signin.refused", actor_user_id: operatorId, detail: { provider: "google", reason: "disabled" } }]);
  });

  it("does not link a disabled operator", async () => {
    await setUserStatus(pool, operatorId, "disabled");
    const res = await signIn(owner);
    expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=not_invited`);
    expect(await identities()).toBe(1);
  });

  it("rotates the session the browser presented, and says so in the login audit row", async () => {
    const oldId = await pool.connect().then(async (client) => {
      try {
        return await startSession(client, operatorId, undefined);
      } finally {
        client.release();
      }
    });
    const oldCookie = `${SESSION_COOKIE}=${oldId}`;
    expect((await request(app).get("/api/servers").set("Cookie", oldCookie)).status).toBe(200);
    const res = await signIn(owner, { extraCookies: [oldCookie] });
    expect(res.headers.location).toBe(`${FRONTEND}/app`);
    expect((await request(app).get("/api/servers").set("Cookie", oldCookie)).status).toBe(401);
    expect((await request(app).get("/api/servers").set("Cookie", sessionCookieOf(res)!)).status).toBe(200);
    const logins = (await auditActions()).filter((row) => row.action === "login");
    expect(logins.at(-1)!.detail).toEqual({ provider: "google", rotated: true });
  });

  it("two racing first sign-ins for the bootstrap owner both succeed and leave one Google identity", async () => {
    const [a, b] = await Promise.all([beginGoogleSignIn(app), beginGoogleSignIn(app)]);
    const [ra, rb] = await Promise.all([
      completeGoogleSignIn(app, issuer, a, { claims: owner }),
      completeGoogleSignIn(app, issuer, b, { claims: owner }),
    ]);
    expect(ra.headers.location).toBe(`${FRONTEND}/app`);
    expect(rb.headers.location).toBe(`${FRONTEND}/app`);
    expect(await identities()).toBe(2);
  });

  it("a replayed callback and an expired attempt create nothing", async () => {
    const begun = await beginGoogleSignIn(app);
    expect((await completeGoogleSignIn(app, issuer, begun, { claims: owner })).headers.location).toBe(`${FRONTEND}/app`);
    const replay = await completeGoogleSignIn(app, issuer, begun, { claims: owner });
    expect(replay.headers.location).toBe(`${FRONTEND}/app/login?error=expired`);
    const stale = await beginGoogleSignIn(app);
    await admin.query("UPDATE identity.login_attempts SET created_at = now() - interval '1 hour', expires_at = now() - interval '50 minutes'");
    const expired = await completeGoogleSignIn(app, issuer, stale, { claims: owner });
    expect(expired.headers.location).toBe(`${FRONTEND}/app/login?error=expired`);
    // The expired row is left for the purge worker; nothing live remains.
    expect(await count("SELECT count(*) AS n FROM identity.login_attempts WHERE expires_at > now()")).toBe(0);
  });

  it("a wrong state and a wrong nonce end in error=failed and create no session", async () => {
    const wrongState = await beginGoogleSignIn(app);
    const r1 = await completeGoogleSignIn(app, issuer, wrongState, { claims: owner, state: "not-the-state-we-issued" });
    const wrongNonce = await beginGoogleSignIn(app);
    const r2 = await completeGoogleSignIn(app, issuer, wrongNonce, { claims: owner, nonce: "not-the-nonce-we-issued-00" });
    for (const res of [r1, r2]) {
      expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=failed`);
      expect(sessionCookieOf(res)).toBeUndefined();
    }
    expect(await identities()).toBe(1);
  });

  it("an open-redirect attempt through ?return= is ignored and lands on /app", async () => {
    for (const bad of ["https://evil.example/app", "//evil.example/app", "/app/../../evil"]) {
      const begun = await beginGoogleSignIn(app, bad);
      const res = await completeGoogleSignIn(app, issuer, begun, { claims: owner });
      expect(res.headers.location).toBe(`${FRONTEND}/app`);
    }
  });
});
