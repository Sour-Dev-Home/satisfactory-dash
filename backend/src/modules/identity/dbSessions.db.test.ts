import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import request from "supertest";
import { Router } from "express";
import { ApiErrorResponseSchema, SessionResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { createIdentityModule } from "./index.js";
import { SESSION_COOKIE } from "./session.js";
import { revokeAllSessionsAdmin, revokeUserSessionsAdmin } from "./sessionAdmin.js";
import { disableUserAdmin, enableUserAdmin } from "./accountAdmin.js";
import { startSession } from "./dbSessionStore.js";
import { purgeExpired } from "./sessionPurge.js";
import { setUserStatus } from "./repositories/userRepository.js";

// ADR-0025 PR 5 against a real Postgres, as satis_app, through the real HTTP pipeline. Since PR 9 there is no
// password login: sessions are started the way Google sign-in starts them (startSession), for the operator account.
const available = dbTestsAvailable();
/** A pre-database HMAC token's shape (base64url payload "." signature): what a browser may still carry. */
const OLD_STATELESS_TOKEN = "eyJzdWIiOiJvcGVyYXRvciIsImV4cCI6OTk5OTk5OTk5OSwianRpIjoieCJ9.c2lnbmF0dXJlLW9mLWFuLW9sZC10b2tlbg";

describe.skipIf(!available)("database sessions through the real pipeline", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  function build(options: { adminUser?: string; dbPool?: pg.Pool } = {}) {
    const identity = createIdentityModule(
      { ...(options.adminUser ? { DASHBOARD_ADMIN_USER: options.adminUser } : {}), CORS_ALLOWED_ORIGINS: "" },
      { db: options.dbPool ?? pool },
    );
    const protectedRouter = Router();
    protectedRouter.get("/servers", (_req, res) => void res.json({ servers: [] }));
    const app = createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      allowedOrigins: ["https://satis-manager.com"],
      routers: [identity.authRouter],
      sessionGuard: identity.sessionGuard,
      protectedRouters: [protectedRouter],
    });
    /** Starts an operator session (as Google sign-in does) and returns the Cookie header value. `replacing` is the
     *  cookie the browser presented, which ends in the same step. */
    const signIn = async (replacing?: string): Promise<string> => {
      const userId = await identity.ensureOperatorUserId!();
      const presented = replacing?.slice(`${SESSION_COOKIE}=`.length);
      return `${SESSION_COOKIE}=${await startSession(pool, userId, presented)}`;
    };
    return { app, identity, signIn };
  }

  const setCookieOf = (res: request.Response) =>
    [res.headers["set-cookie"] ?? []].flat().find((c: string) => c.startsWith(`${SESSION_COOKIE}=`)) ?? "";
  const cleared = (res: request.Response) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(setCookieOf(res));
  const auditActions = async () => (await admin.query("SELECT action FROM audit.audit_events ORDER BY id")).rows.map((r) => r.action as string);
  const operatorUserId = async () =>
    (await admin.query("SELECT user_id FROM identity.auth_identities WHERE provider_subject = 'operator'")).rows[0].user_id as string;

  it("a session has a hashed id, an 8-hour life and an audit row of ids only; the operator is anchored on `local`", async () => {
    const { app, signIn } = build();
    const cookie = await signIn();
    const id = cookie.slice(`${SESSION_COOKIE}=`.length);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const session = await request(app).get(endpoints.auth.session.path()).set("Cookie", cookie);
    // The `local` identity is the operator's anchor, not a sign-in method (ADR-0025 PR 9): never "password".
    expect(SessionResponseSchema.parse(session.body)).toEqual({
      authenticated: true,
      signInMethods: [],
      user: { name: "operator", authMethods: [] },
    });
    expect(JSON.stringify(session.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no internal id in the body
    const rows = await admin.query("SELECT id_hash, expires_at, created_at FROM identity.sessions");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].id_hash.toString("base64url")).not.toBe(id); // the table holds the hash, never the id
    const hours = (rows.rows[0].expires_at.getTime() - rows.rows[0].created_at.getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(8, 1);
    expect(await admin.query("SELECT provider, provider_subject FROM identity.auth_identities")).toMatchObject({
      rows: [{ provider: "local", provider_subject: "operator" }],
    });
    const audit = (await admin.query("SELECT action, actor_user_id, detail FROM audit.audit_events WHERE action = 'login'")).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toEqual({});
    expect(audit[0].actor_user_id).toBe(await operatorUserId());
  });

  it("POST /api/auth/login is gone: 401 signed out, 404 signed in, and it creates no session or account", async () => {
    const { app, signIn } = build();
    const cookie = await signIn();
    const counts = async () =>
      (await admin.query("SELECT (SELECT count(*)::int FROM identity.sessions) AS s, (SELECT count(*)::int FROM identity.users) AS u, (SELECT count(*)::int FROM audit.audit_events) AS a")).rows[0];
    const before = await counts();
    const body = JSON.stringify({ username: "operator", password: "correct horse battery staple" });
    const anon = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send(body);
    expect(anon.status).toBe(401);
    expect(anon.headers["set-cookie"]).toBeUndefined();
    const signedIn = await request(app).post("/api/auth/login").set("Content-Type", "application/json").set("Cookie", cookie).send(body);
    expect(signedIn.status).toBe(404);
    expect(setCookieOf(signedIn)).toBe("");
    expect(await counts()).toEqual(before);
  });

  it("a new session id on every sign-in (no fixation), each its own row", async () => {
    const { signIn } = build();
    expect(await signIn()).not.toBe(await signIn());
  });

  it("the session cookie opens the protected API and the session endpoint; touch writes at most once a minute", async () => {
    const { app, signIn } = build();
    const cookie = await signIn();
    expect((await request(app).get("/api/servers")).status).toBe(401);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
    const session = await request(app).get(endpoints.auth.session.path()).set("Cookie", cookie);
    expect(SessionResponseSchema.parse(session.body)).toMatchObject({ authenticated: true, user: { name: "operator" } });
    const before = (await admin.query("SELECT max(last_seen_at) AS t FROM identity.sessions")).rows[0].t;
    expect(before).not.toBeNull();
    await request(app).get("/api/servers").set("Cookie", cookie);
    const after = (await admin.query("SELECT max(last_seen_at) AS t FROM identity.sessions")).rows[0].t;
    expect(after.getTime()).toBe(before.getTime()); // within the minute: no write
  });

  it("logout revokes the session, clears the cookie, and writes an audit row; a second logout is harmless", async () => {
    const { app, signIn } = build();
    const cookie = await signIn();
    const out = await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ authenticated: false, signInMethods: [] });
    expect(cleared(out)).toBe(true);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(401);
    expect((await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie)).status).toBe(200);
    expect((await auditActions()).filter((a) => a === "logout").length).toBeGreaterThanOrEqual(1);
  });

  it("sign out everywhere revokes all of the user's sessions and audits the count", async () => {
    const { app, signIn } = build();
    const a = await signIn();
    const b = await signIn();
    const res = await request(app).post(endpoints.auth.logoutAll.path()).set("Cookie", a);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, signInMethods: [] });
    expect(cleared(res)).toBe(true);
    expect((await request(app).get("/api/servers").set("Cookie", a)).status).toBe(401);
    expect((await request(app).get("/api/servers").set("Cookie", b)).status).toBe(401);
    const audit = (await admin.query("SELECT detail FROM audit.audit_events WHERE action = 'logout_all' ORDER BY id DESC LIMIT 1")).rows[0];
    expect(audit.detail.count).toBeGreaterThanOrEqual(2);
    // With no session it is harmless, and never an error.
    expect((await request(app).post(endpoints.auth.logoutAll.path())).status).toBe(200);
  });

  describe("an old stateless cookie", () => {
    it("is a 401 with the cookie cleared on the protected API, never a 400 or 500", async () => {
      const { app } = build();
      const res = await request(app).get("/api/servers").set("Cookie", `${SESSION_COOKIE}=${OLD_STATELESS_TOKEN}`);
      expect(res.status).toBe(401);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("unauthorized");
      expect(cleared(res)).toBe(true);
    });

    it("is authenticated:false on the session endpoint, also clearing the cookie", async () => {
      const { app } = build();
      const res = await request(app).get(endpoints.auth.session.path()).set("Cookie", `${SESSION_COOKIE}=${OLD_STATELESS_TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: false, signInMethods: [] });
      expect(cleared(res)).toBe(true);
    });

    it.each(["x", "a".repeat(43) + "!", "a".repeat(44), "a".repeat(5000), "%%%", "a.b.c", "'; DROP TABLE identity.sessions; --"])(
      "junk cookie %j is refused as signed out, not an error",
      async (value) => {
        const { app } = build();
        const res = await request(app).get("/api/servers").set("Cookie", `${SESSION_COOKIE}=${value}`);
        expect(res.status).toBe(401);
      },
    );

    it("a well-shaped id nobody issued is a 401 (and is not cleared: it is this store's format)", async () => {
      const { app } = build();
      const res = await request(app).get("/api/servers").set("Cookie", `${SESSION_COOKIE}=${"A".repeat(43)}`);
      expect(res.status).toBe(401);
    });
  });

  describe("rotation on sign-in", () => {
    const status = async (app: ReturnType<typeof build>["app"], cookie: string) =>
      (await request(app).get("/api/servers").set("Cookie", cookie)).status;

    it("signing in with a session cookie ends that session, in the same step the new one starts", async () => {
      const { app, signIn } = build();
      const old = await signIn();
      expect(await status(app, old)).toBe(200);
      const fresh = await signIn(old);
      expect(fresh).not.toBe(old);
      expect(await status(app, old)).toBe(401); // a copied old cookie does not survive a re-sign-in
      expect(await status(app, fresh)).toBe(200);
      // The login row records the rotation only when a live session really ended.
      const details = (await admin.query("SELECT detail FROM audit.audit_events WHERE action = 'login' ORDER BY id DESC LIMIT 2")).rows.map((r) => r.detail);
      expect(details).toEqual([{ rotated: true }, {}]);
    });

    it("only the presented session ends: another browser's session stays valid", async () => {
      const { app, signIn } = build();
      const laptop = await signIn();
      const phone = await signIn(); // no cookie sent: rotates nothing
      const laptopAgain = await signIn(laptop);
      expect(await status(app, laptop)).toBe(401);
      expect(await status(app, phone)).toBe(200);
      expect(await status(app, laptopAgain)).toBe(200);
    });

    it("an unknown, malformed or already-revoked cookie is ignored and the sign-in still works", async () => {
      const { app, signIn } = build();
      const gone = await signIn();
      await request(app).post(endpoints.auth.logout.path()).set("Cookie", gone);
      for (const cookie of [`${SESSION_COOKIE}=${"A".repeat(43)}`, `${SESSION_COOKIE}=not-a-session`, gone]) {
        expect(await status(app, await signIn(cookie))).toBe(200);
      }
    });
  });

  it("renaming the operator (DASHBOARD_ADMIN_USER) does not fork the account: same user, new display name", async () => {
    const users = async () => (await admin.query("SELECT u.id, u.display_name FROM identity.users u JOIN identity.auth_identities i ON i.user_id = u.id WHERE i.provider_subject = 'operator'")).rows;
    await build({ adminUser: "old-name" }).identity.ensureOperatorUserId!();
    const [before] = await users();
    expect(before.display_name).toBe("old-name");
    const renamed = build({ adminUser: "new-name" });
    const cookie = await renamed.signIn();
    const after = await users();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].display_name).toBe("new-name");
    const session = await request(renamed.app).get(endpoints.auth.session.path()).set("Cookie", cookie);
    expect(session.body.user.name).toBe("new-name");
    // Unset, the name falls back to "operator" (ADR-0025 PR 9: DASHBOARD_ADMIN_USER is optional).
    await build().identity.ensureOperatorUserId!();
    expect((await users())[0].display_name).toBe("operator");
  });

  it("disabling the account kills its sessions at once", async () => {
    const { app, signIn } = build();
    const cookie = await signIn();
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
    const userId = await operatorUserId();
    await setUserStatus(pool, userId, "disabled");
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(401);
    await setUserStatus(pool, userId, "active");
  });

  describe("when the database is down", () => {
    it("the guard and the session endpoint answer 503 service_unavailable, never 401, with a fixed public message", async () => {
      const { signIn } = build();
      const cookie = await signIn();
      const dead = new pg.Pool({ connectionString: db.appUrl.replace(/:\d+\//, ":1/"), max: 1, connectionTimeoutMillis: 500 });
      const down = build({ dbPool: dead });
      const guarded = await request(down.app).get("/api/servers").set("Cookie", cookie);
      expect(guarded.status).toBe(503);
      expect(ApiErrorResponseSchema.parse(guarded.body).error.code).toBe("service_unavailable");
      expect(guarded.body.error.message).toBe("The service is temporarily unavailable");
      const session = await request(down.app).get(endpoints.auth.session.path()).set("Cookie", cookie);
      expect(session.status).toBe(503); // not "authenticated:false": an outage is not "signed out"
      expect(cleared(guarded)).toBe(false);
      expect(JSON.stringify([guarded.body, session.body])).not.toMatch(/ECONNREFUSED|postgres|127\.0\.0\.1/);
      await dead.end();
    });
  });

  it("the admin commands revoke everyone or one account and audit ids and counts only, with no actor", async () => {
    const { app, signIn } = build();
    const a = await signIn();
    const userId = await operatorUserId();
    expect(await revokeUserSessionsAdmin(pool, userId)).toBeGreaterThanOrEqual(1);
    expect((await request(app).get("/api/servers").set("Cookie", a)).status).toBe(401);
    const b = await signIn();
    expect(await revokeAllSessionsAdmin(pool)).toBeGreaterThanOrEqual(1);
    expect((await request(app).get("/api/servers").set("Cookie", b)).status).toBe(401);
    const rows = (await admin.query("SELECT action, actor_user_id, detail FROM audit.audit_events WHERE action LIKE 'sessions.%' ORDER BY id")).rows;
    expect(rows.map((r) => r.action)).toEqual(["sessions.revoke_user", "sessions.revoke_all"]);
    expect(rows.every((r) => r.actor_user_id === null)).toBe(true);
    expect(rows[0].detail).toMatchObject({ userId });
    expect(JSON.stringify(rows)).not.toMatch(/@|operator/);
  });

  it("disable-user ends the existing session, audits ids only, and enable-user lets the account back (#516)", async () => {
    const { app, signIn } = build();
    const cookie = await signIn();
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
    const userId = await operatorUserId();

    expect(await disableUserAdmin(pool, userId)).toEqual({ found: true, sessionsRevoked: expect.any(Number), agentsRevoked: 0 });
    expect((await admin.query("SELECT status FROM identity.users WHERE id = $1", [userId])).rows[0].status).toBe("disabled");
    // The sessions are revoked rows, not just filtered out by the status check.
    expect((await admin.query("SELECT count(*)::int AS n FROM identity.sessions WHERE user_id = $1 AND revoked_at IS NULL", [userId])).rows[0].n).toBe(0);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(401);

    expect(await enableUserAdmin(pool, userId)).toMatchObject({ found: true });
    // Re-enabling does not bring the revoked session back.
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(401);
    expect((await request(app).get("/api/servers").set("Cookie", await signIn())).status).toBe(200);
    expect(await disableUserAdmin(pool, "00000000-0000-4000-8000-000000000000")).toEqual({ found: false });

    const rows = (await admin.query("SELECT action, actor_user_id, detail FROM audit.audit_events WHERE action IN ('user.disabled', 'user.enabled') ORDER BY id")).rows;
    expect(rows.map((r) => r.action)).toEqual(["user.disabled", "user.enabled"]);
    expect(rows.every((r) => r.actor_user_id === null)).toBe(true);
    expect(rows[0].detail).toMatchObject({ userId });
    expect(JSON.stringify(rows)).not.toMatch(/@|operator/);
  });

  it("a sign-in that raced the disable (its session row lands after the revoke) does not come alive when the account is re-enabled (#516)", async () => {
    const { app, identity } = build();
    const userId = await identity.ensureOperatorUserId!();
    await disableUserAdmin(pool, userId);
    // The racing sign-in read the account as active before the disable committed, and inserts its session after it.
    const straggler = await startSession(pool, userId, undefined);
    expect((await request(app).get("/api/servers").set("Cookie", `${SESSION_COOKIE}=${straggler}`)).status).toBe(401);
    const unrevoked = async () => (await admin.query("SELECT count(*)::int AS n FROM identity.sessions WHERE user_id = $1 AND revoked_at IS NULL", [userId])).rows[0].n;
    expect(await unrevoked()).toBe(1);
    expect(await enableUserAdmin(pool, userId)).toMatchObject({ found: true, sessionsRevoked: 1 });
    expect(await unrevoked()).toBe(0);
    expect((await request(app).get("/api/servers").set("Cookie", `${SESSION_COOKIE}=${straggler}`)).status).toBe(401);
  });

  it("the purge removes sessions expired over 30 days ago and stale login attempts, and keeps the rest", async () => {
    const { app, signIn } = build();
    const live = await signIn();
    const userId = await operatorUserId();
    await admin.query("INSERT INTO identity.sessions (id_hash, user_id, created_at, expires_at) VALUES ($1, $2, now() - interval '50 days', now() - interval '40 days')", [Buffer.alloc(32, 7), userId]);
    await admin.query("INSERT INTO identity.login_attempts (id_hash, state, nonce, code_verifier, return_path, created_at, expires_at) VALUES ($1, $2, $3, $4, '/app', now() - interval '3 hours', now() - interval '2 hours')", [Buffer.alloc(32, 9), "s".repeat(32), "n".repeat(32), "v".repeat(43)]);
    const result = await purgeExpired(pool);
    expect(result.sessions).toBeGreaterThanOrEqual(1);
    expect(result.loginAttempts).toBeGreaterThanOrEqual(1);
    expect((await request(app).get("/api/servers").set("Cookie", live)).status).toBe(200);
  });

  it("the identity module starts a purge worker only in database mode", () => {
    expect(build().identity.workers).toHaveLength(1);
    const noDb = createIdentityModule({ CORS_ALLOWED_ORIGINS: "" });
    expect(noDb.workers).toEqual([]);
    expect(noDb.ensureOperatorUserId).toBeUndefined();
  });
});
