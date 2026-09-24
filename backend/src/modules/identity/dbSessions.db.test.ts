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
import { hashPassword } from "./passwordHash.js";
import { SESSION_COOKIE } from "./session.js";
import { createSessionToken } from "./sessionToken.js";
import { revokeAllSessionsAdmin, revokeUserSessionsAdmin } from "./sessionAdmin.js";
import { purgeExpired } from "./sessionPurge.js";
import { setUserStatus } from "./repositories/userRepository.js";

// ADR-0025 PR 5 against a real Postgres, as satis_app, through the real HTTP pipeline.
const available = dbTestsAvailable();
const PASSWORD = "correct horse battery staple";
const SECRET = "q7Vw2kZ9xLm4TpR8vNc3HbYd6JfUe1SaGo5iXqKzWt0=";

describe.skipIf(!available)("database sessions through the real pipeline", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let passwordHash: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    passwordHash = await hashPassword(PASSWORD);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  function build(options: { adminUser?: string; dbPool?: pg.Pool } = {}) {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(JSON.parse(line)) });
    const identity = createIdentityModule(
      {
        DASHBOARD_ADMIN_USER: options.adminUser ?? "operator",
        DASHBOARD_ADMIN_PASSWORD_HASH: passwordHash,
        SESSION_SECRET: SECRET,
        CORS_ALLOWED_ORIGINS: "",
      },
      { db: options.dbPool ?? pool },
    );
    const protectedRouter = Router();
    protectedRouter.get("/servers", (_req, res) => void res.json({ servers: [] }));
    const app = createApp({
      logger,
      allowedOrigins: ["https://satis-manager.com"],
      routers: [identity.authRouter],
      sessionGuard: identity.sessionGuard,
      protectedRouters: [protectedRouter],
    });
    return { app, lines, identity };
  }

  const loginRequest = (app: ReturnType<typeof build>["app"], username = "operator") =>
    request(app).post(endpoints.auth.login.path()).set("Content-Type", "application/json").send(JSON.stringify({ username, password: PASSWORD }));
  const cookieOf = (res: request.Response) =>
    [res.headers["set-cookie"]].flat().find((c: string) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0];
  const setCookieOf = (res: request.Response) =>
    [res.headers["set-cookie"] ?? []].flat().find((c: string) => c.startsWith(`${SESSION_COOKIE}=`)) ?? "";
  const cleared = (res: request.Response) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(setCookieOf(res));
  const auditActions = async () => (await admin.query("SELECT action FROM audit.audit_events ORDER BY id")).rows.map((r) => r.action as string);

  it("login creates the operator account, a database session with a hashed id, and an audit row of ids only", async () => {
    const { app, lines } = build();
    const res = await loginRequest(app);
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    const id = cookie.slice(`${SESSION_COOKIE}=`.length);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(SessionResponseSchema.parse(res.body)).toEqual({ authenticated: true, user: { name: "operator", authMethods: ["password"] } });
    expect(JSON.stringify(res.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no internal id in the body
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
    const userId = (await admin.query("SELECT id FROM identity.users")).rows[0].id;
    expect(audit[0].actor_user_id).toBe(userId);
    // The sign-in log line carries the id, never the username.
    const line = lines.find((l) => l.msg === "login succeeded");
    expect(line).toMatchObject({ userId });
    expect(JSON.stringify(line)).not.toContain('"username"');
  });

  it("a new session id on every login (no fixation), each its own row", async () => {
    const { app } = build();
    const a = cookieOf(await loginRequest(app));
    const b = cookieOf(await loginRequest(app));
    expect(a).not.toBe(b);
  });

  it("the session cookie opens the protected API and the session endpoint; touch writes at most once a minute", async () => {
    const { app } = build();
    const cookie = cookieOf(await loginRequest(app));
    expect((await request(app).get("/api/servers")).status).toBe(401);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
    const session = await request(app).get(endpoints.auth.session.path()).set("Cookie", cookie);
    expect(SessionResponseSchema.parse(session.body)).toMatchObject({ authenticated: true, user: { name: "operator", authMethods: ["password"] } });
    const before = (await admin.query("SELECT max(last_seen_at) AS t FROM identity.sessions")).rows[0].t;
    expect(before).not.toBeNull();
    await request(app).get("/api/servers").set("Cookie", cookie);
    const after = (await admin.query("SELECT max(last_seen_at) AS t FROM identity.sessions")).rows[0].t;
    expect(after.getTime()).toBe(before.getTime()); // within the minute: no write
  });

  it("logout revokes the session, clears the cookie, and writes an audit row; a second logout is harmless", async () => {
    const { app } = build();
    const cookie = cookieOf(await loginRequest(app));
    const out = await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ authenticated: false });
    expect(cleared(out)).toBe(true);
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(401);
    expect((await request(app).post(endpoints.auth.logout.path()).set("Cookie", cookie)).status).toBe(200);
    expect((await auditActions()).filter((a) => a === "logout").length).toBeGreaterThanOrEqual(1);
  });

  it("sign out everywhere revokes all of the user's sessions and audits the count", async () => {
    const { app } = build();
    const a = cookieOf(await loginRequest(app));
    const b = cookieOf(await loginRequest(app));
    const res = await request(app).post(endpoints.auth.logoutAll.path()).set("Cookie", a);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
    expect(cleared(res)).toBe(true);
    expect((await request(app).get("/api/servers").set("Cookie", a)).status).toBe(401);
    expect((await request(app).get("/api/servers").set("Cookie", b)).status).toBe(401);
    const audit = (await admin.query("SELECT detail FROM audit.audit_events WHERE action = 'logout_all' ORDER BY id DESC LIMIT 1")).rows[0];
    expect(audit.detail.count).toBeGreaterThanOrEqual(2);
    // With no session it is harmless, and never an error.
    expect((await request(app).post(endpoints.auth.logoutAll.path())).status).toBe(200);
  });

  describe("an old stateless cookie at deploy A", () => {
    it("is a 401 with the cookie cleared on the protected API, never a 400 or 500", async () => {
      const { app } = build();
      const oldToken = createSessionToken("operator", SECRET); // the pre-database HMAC token, for real
      const res = await request(app).get("/api/servers").set("Cookie", `${SESSION_COOKIE}=${oldToken}`);
      expect(res.status).toBe(401);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("unauthorized");
      expect(cleared(res)).toBe(true);
    });

    it("is authenticated:false on the session endpoint, also clearing the cookie", async () => {
      const { app } = build();
      const oldToken = createSessionToken("operator", SECRET);
      const res = await request(app).get(endpoints.auth.session.path()).set("Cookie", `${SESSION_COOKIE}=${oldToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: false });
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

  describe("rotation on login", () => {
    const loginWithCookie = (app: ReturnType<typeof build>["app"], cookie: string) =>
      request(app).post(endpoints.auth.login.path()).set("Content-Type", "application/json").set("Cookie", cookie).send(JSON.stringify({ username: "operator", password: PASSWORD }));
    const status = async (app: ReturnType<typeof build>["app"], cookie: string) =>
      (await request(app).get("/api/servers").set("Cookie", cookie)).status;

    it("logging in with a session cookie ends that session, in the same step the new one starts", async () => {
      const { app } = build();
      const old = cookieOf(await loginRequest(app));
      expect(await status(app, old)).toBe(200);
      const res = await loginWithCookie(app, old);
      expect(res.status).toBe(200);
      const fresh = cookieOf(res);
      expect(fresh).not.toBe(old);
      expect(await status(app, old)).toBe(401); // a copied old cookie does not survive a re-login
      expect(await status(app, fresh)).toBe(200);
    });

    it("only the presented session ends: another browser's session stays valid", async () => {
      const { app } = build();
      const laptop = cookieOf(await loginRequest(app));
      const phone = cookieOf(await loginRequest(app)); // no cookie sent: rotates nothing
      expect(await status(app, laptop)).toBe(200);
      const laptopAgain = cookieOf(await loginWithCookie(app, laptop));
      expect(await status(app, laptop)).toBe(401);
      expect(await status(app, phone)).toBe(200);
      expect(await status(app, laptopAgain)).toBe(200);
    });

    it("an unknown, malformed or already-revoked cookie is ignored and the login still works", async () => {
      const { app } = build();
      const gone = cookieOf(await loginRequest(app));
      await request(app).post(endpoints.auth.logout.path()).set("Cookie", gone);
      for (const cookie of [`${SESSION_COOKIE}=${"A".repeat(43)}`, `${SESSION_COOKIE}=not-a-session`, gone]) {
        const res = await loginWithCookie(app, cookie);
        expect(res.status).toBe(200);
        expect(await status(app, cookieOf(res))).toBe(200);
      }
    });
  });

  it("renaming the operator in .env does not fork the account: same user, new display name", async () => {
    const first = build({ adminUser: "old-name" });
    const idBefore = (await admin.query("SELECT count(*)::int AS n FROM identity.users WHERE display_name = 'old-name'")).rows[0].n;
    expect(idBefore).toBe(0);
    await loginRequest(first.app, "old-name");
    const users = async () => (await admin.query("SELECT u.id, u.display_name FROM identity.users u JOIN identity.auth_identities i ON i.user_id = u.id WHERE i.provider_subject = 'operator'")).rows;
    const [before] = await users();
    const renamed = build({ adminUser: "new-name" });
    const res = await loginRequest(renamed.app, "new-name");
    expect(res.status).toBe(200);
    const after = await users();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].display_name).toBe("new-name");
    expect(res.body.user.name).toBe("new-name");
  });

  it("disabling the account kills its sessions at once and refuses a new login", async () => {
    const { app } = build();
    const cookie = cookieOf(await loginRequest(app));
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(200);
    const userId = (await admin.query("SELECT user_id FROM identity.auth_identities WHERE provider_subject = 'operator'")).rows[0].user_id;
    await setUserStatus(pool, userId, "disabled");
    expect((await request(app).get("/api/servers").set("Cookie", cookie)).status).toBe(401);
    const retry = await loginRequest(app);
    expect(retry.status).toBe(401);
    expect(ApiErrorResponseSchema.parse(retry.body).error.message).toBe("Invalid username or password");
    await setUserStatus(pool, userId, "active");
    expect((await loginRequest(app)).status).toBe(200);
  });

  describe("when the database is down", () => {
    it("login and the guard answer 503 service_unavailable, never 401, with a fixed public message", async () => {
      const { app } = build();
      const cookie = cookieOf(await loginRequest(app));
      const dead = new pg.Pool({ connectionString: db.appUrl.replace(/:\d+\//, ":1/"), max: 1, connectionTimeoutMillis: 500 });
      const down = build({ dbPool: dead });
      const guarded = await request(down.app).get("/api/servers").set("Cookie", cookie);
      expect(guarded.status).toBe(503);
      expect(ApiErrorResponseSchema.parse(guarded.body).error.code).toBe("service_unavailable");
      expect(guarded.body.error.message).toBe("The service is temporarily unavailable");
      const login = await loginRequest(down.app);
      expect(login.status).toBe(503);
      expect(login.body.error.code).toBe("service_unavailable");
      const session = await request(down.app).get(endpoints.auth.session.path()).set("Cookie", cookie);
      expect(session.status).toBe(503); // not "authenticated:false": an outage is not "signed out"
      expect(cleared(guarded)).toBe(false);
      expect(JSON.stringify([guarded.body, login.body, session.body])).not.toMatch(/ECONNREFUSED|postgres|127\.0\.0\.1/);
      await dead.end();
    });
  });

  it("the admin commands revoke everyone or one account and audit ids and counts only, with no actor", async () => {
    const { app } = build();
    const a = cookieOf(await loginRequest(app));
    const userId = (await admin.query("SELECT user_id FROM identity.auth_identities WHERE provider_subject = 'operator'")).rows[0].user_id;
    expect(await revokeUserSessionsAdmin(pool, userId)).toBeGreaterThanOrEqual(1);
    expect((await request(app).get("/api/servers").set("Cookie", a)).status).toBe(401);
    const b = cookieOf(await loginRequest(app));
    expect(await revokeAllSessionsAdmin(pool)).toBeGreaterThanOrEqual(1);
    expect((await request(app).get("/api/servers").set("Cookie", b)).status).toBe(401);
    const rows = (await admin.query("SELECT action, actor_user_id, detail FROM audit.audit_events WHERE action LIKE 'sessions.%' ORDER BY id")).rows;
    expect(rows.map((r) => r.action)).toEqual(["sessions.revoke_user", "sessions.revoke_all"]);
    expect(rows.every((r) => r.actor_user_id === null)).toBe(true);
    expect(rows[0].detail).toMatchObject({ userId });
    expect(JSON.stringify(rows)).not.toMatch(/@|operator/);
  });

  it("the purge removes sessions expired over 30 days ago and stale login attempts, and keeps the rest", async () => {
    const { app } = build();
    const live = cookieOf(await loginRequest(app));
    const userId = (await admin.query("SELECT user_id FROM identity.auth_identities WHERE provider_subject = 'operator'")).rows[0].user_id;
    await admin.query("INSERT INTO identity.sessions (id_hash, user_id, created_at, expires_at) VALUES ($1, $2, now() - interval '50 days', now() - interval '40 days')", [Buffer.alloc(32, 7), userId]);
    await admin.query("INSERT INTO identity.login_attempts (id_hash, state, nonce, code_verifier, return_path, created_at, expires_at) VALUES ($1, $2, $3, $4, '/app', now() - interval '3 hours', now() - interval '2 hours')", [Buffer.alloc(32, 9), "s".repeat(32), "n".repeat(32), "v".repeat(43)]);
    const result = await purgeExpired(pool);
    expect(result.sessions).toBeGreaterThanOrEqual(1);
    expect(result.loginAttempts).toBeGreaterThanOrEqual(1);
    expect((await request(app).get("/api/servers").set("Cookie", live)).status).toBe(200);
  });

  it("the identity module starts a purge worker only in database mode", () => {
    expect(build().identity.workers).toHaveLength(1);
    const noDb = createIdentityModule({ DASHBOARD_ADMIN_USER: "operator", DASHBOARD_ADMIN_PASSWORD_HASH: passwordHash, SESSION_SECRET: SECRET, CORS_ALLOWED_ORIGINS: "" });
    expect(noDb.workers).toEqual([]);
  });
});
