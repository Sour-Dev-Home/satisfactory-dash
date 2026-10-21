import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import request from "supertest";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { startFakeOidcIssuer } from "../../../test-support/fakeOidcIssuer.js";
import type { FakeOidcIssuer, FakeClaims } from "../../../test-support/fakeOidcIssuer.js";
import { LOGIN_ATTEMPT_COOKIE } from "./routes/googleAuth.js";
import { hashPassword } from "./passwordHash.js";
import { createIdentityModule } from "./index.js";
import { SESSION_COOKIE } from "./session.js";
import { createGoogleSignIn } from "./googleSignIn.js";
import type { GoogleSignInResult } from "./googleSignIn.js";
import { DEFAULT_SIGNUP_MAX_PER_HOUR, TERMS_VERSION } from "./signupConfig.js";
import { setUserStatus } from "./repositories/userRepository.js";

// #528 (ADR-0046): open sign-up against a real Postgres, through the real HTTP pipeline and the local
// fake OpenID provider (never real Google).
const available = dbTestsAvailable();
const CLIENT_ID = "test-client-id";
const FRONTEND = "https://satis-manager.com";
const SECRET = "q7Vw2kZ9xLm4TpR8vNc3HbYd6JfUe1SaGo5iXqKzWt0=";

describe.skipIf(!available)("open sign-up against Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let issuer: FakeOidcIssuer;
  let passwordHash: string;

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
  });

  async function buildApp(signupEnv: Record<string, string>) {
    const identity = createIdentityModule(
      {
        DASHBOARD_ADMIN_USER: "operator",
        DASHBOARD_ADMIN_PASSWORD_HASH: passwordHash,
        SESSION_SECRET: SECRET,
        CORS_ALLOWED_ORIGINS: "",
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: "test-client-secret",
        GOOGLE_REDIRECT_URI: "http://localhost:3001/api/auth/google/callback",
        BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
        ...signupEnv,
      },
      { db: pool, googleOidc: { issuer: issuer.issuer, allowInsecureRequests: true } },
    );
    const operatorId = await identity.ensureOperatorUserId!();
    // The operator is old, so it does not count toward the hourly cap.
    await admin.query("UPDATE identity.users SET created_at = now() - interval '2 days' WHERE id = $1", [operatorId]);
    return createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      allowedOrigins: [FRONTEND],
      routers: [identity.authRouter],
      sessionGuard: identity.sessionGuard,
    });
  }

  /** A whole Google sign-in; `terms` is what the sign-in page puts on /start once the box is ticked. */
  async function signIn(app: ReturnType<typeof createApp>, claims: FakeClaims, terms?: string) {
    const start = await request(app).get(`/api/auth/google/start${terms === undefined ? "" : `?terms=${terms}`}`).set("Sec-Fetch-Site", "same-site");
    const attemptCookie = ([start.headers["set-cookie"] ?? []].flat() as string[])
      .find((c) => c.startsWith(`${LOGIN_ATTEMPT_COOKIE}=`))!
      .split(";")[0]!;
    const authUrl = new URL(start.headers.location!);
    const code = issuer.issueCode({
      claims,
      nonce: authUrl.searchParams.get("nonce")!,
      codeChallenge: authUrl.searchParams.get("code_challenge")!,
    });
    return request(app)
      .get(`/api/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(authUrl.searchParams.get("state")!)}`)
      .set("Cookie", attemptCookie);
  }

  const stranger = (n: number, extra: Partial<FakeClaims> = {}): FakeClaims => ({
    sub: `google-sub-${n}`,
    email: `jane.doe${n}@example.net`,
    email_verified: true,
    ...extra,
  });
  const hasSession = (res: request.Response) =>
    ([res.headers["set-cookie"] ?? []].flat() as string[]).some((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const count = async (sql: string) => Number((await admin.query(sql)).rows[0].n);
  const users = () => count("SELECT count(*) AS n FROM identity.users");
  const audits = async () => (await admin.query("SELECT action, actor_user_id, detail FROM audit.audit_events ORDER BY id")).rows;

  it("closed (the default): an unknown account is refused not_invited, even with the terms ticked", async () => {
    const app = await buildApp({});
    const before = await users();
    const res = await signIn(app, stranger(1), TERMS_VERSION);
    expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=not_invited`);
    expect(hasSession(res)).toBe(false);
    expect(await users()).toBe(before);
    expect((await request(app).get("/api/auth/session")).body.signInMethods).not.toContain("google_signup");
  });

  it("open: a new account without the terms is sent to the terms step and nothing is created", async () => {
    const app = await buildApp({ SIGNUP_MODE: "open" });
    const before = await users();
    const res = await signIn(app, stranger(1));
    expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=terms_required&return=%2Fapp`);
    expect(hasSession(res)).toBe(false);
    expect(await users()).toBe(before);
    expect(await count("SELECT count(*) AS n FROM identity.auth_identities WHERE provider = 'google'")).toBe(0);
    // A stale or made-up version does not count either.
    const stale = await signIn(app, stranger(1), "1999-01-01");
    expect(stale.headers.location).toBe(`${FRONTEND}/app/login?error=terms_required&return=%2Fapp`);
  });

  it("open: creates the account, a generated name, no email, the recorded terms, and a working session", async () => {
    const app = await buildApp({ SIGNUP_MODE: "open" });
    const res = await signIn(app, stranger(1), TERMS_VERSION);
    expect(res.headers.location).toBe(`${FRONTEND}/app`);
    expect(hasSession(res)).toBe(true);
    const row = (
      await admin.query(
        `SELECT u.id, u.display_name, u.email, u.status, u.terms_version, u.terms_accepted_at, i.provider_subject
         FROM identity.users u JOIN identity.auth_identities i ON i.user_id = u.id WHERE i.provider = 'google'`,
      )
    ).rows;
    expect(row).toHaveLength(1);
    const user = row[0];
    expect(user.provider_subject).toBe("google-sub-1");
    expect(user.display_name).toMatch(/^Player-[2-9A-HJKMN-Z]{4}$/);
    expect(user.display_name.toLowerCase()).not.toContain("jane");
    expect(user.email).toBeNull();
    expect(user.status).toBe("active");
    expect(user.terms_version).toBe(TERMS_VERSION);
    expect(Math.abs(Date.now() - new Date(user.terms_accepted_at).getTime())).toBeLessThan(60_000);
    const cookie = ([res.headers["set-cookie"] ?? []].flat() as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;
    const session = await request(app).get("/api/auth/session").set("Cookie", cookie);
    expect(session.body.authenticated).toBe(true);
    expect(session.body.user.name).toBe(user.display_name);
    expect(session.body.user.email).toBeUndefined();
    // Audit: ids and the terms version only; no email, no name, no part of either.
    const signup = (await audits()).find((a) => a.action === "signup")!;
    expect(signup).toEqual({ action: "signup", actor_user_id: user.id, detail: { provider: "google", termsVersion: TERMS_VERSION } });
    const everything = JSON.stringify(await audits()) + JSON.stringify(user.display_name);
    expect(everything).not.toMatch(/jane|example\.net/i);
  });

  it("open: a returning account signs in without the terms and is not created twice", async () => {
    const app = await buildApp({ SIGNUP_MODE: "open" });
    await signIn(app, stranger(1), TERMS_VERSION);
    const again = await signIn(app, stranger(1, { email: "changed@example.org" }));
    expect(again.headers.location).toBe(`${FRONTEND}/app`);
    expect(hasSession(again)).toBe(true);
    expect(await count("SELECT count(*) AS n FROM identity.users WHERE terms_version IS NOT NULL")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM audit.audit_events WHERE action = 'signup'")).toBe(1);
  });

  it("open: two racing first sign-ins of the same sub create exactly one user", async () => {
    const app = await buildApp({ SIGNUP_MODE: "open" });
    const results = await Promise.all([signIn(app, stranger(7), TERMS_VERSION), signIn(app, stranger(7), TERMS_VERSION)]);
    expect(results.map((r) => r.headers.location)).toEqual([`${FRONTEND}/app`, `${FRONTEND}/app`]);
    expect(results.every(hasSession)).toBe(true);
    expect(await count("SELECT count(*) AS n FROM identity.auth_identities WHERE provider = 'google'")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM identity.users WHERE terms_version IS NOT NULL")).toBe(1);
  });

  it("open: an unverified email is refused, even with the terms ticked", async () => {
    const app = await buildApp({ SIGNUP_MODE: "open" });
    const before = await users();
    const res = await signIn(app, stranger(1, { email_verified: false }), TERMS_VERSION);
    expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=failed`);
    expect(await users()).toBe(before);
  });

  it("open: a disabled account (#516) is still refused, and its terms are not re-asked", async () => {
    const app = await buildApp({ SIGNUP_MODE: "open" });
    await signIn(app, stranger(1), TERMS_VERSION);
    const id = (await admin.query("SELECT user_id FROM identity.auth_identities WHERE provider_subject = 'google-sub-1'")).rows[0].user_id;
    await setUserStatus(admin, id, "disabled");
    const res = await signIn(app, stranger(1), TERMS_VERSION);
    expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=failed`);
    expect(hasSession(res)).toBe(false);
    const refused = (await audits()).filter((a) => a.action === "signin.refused").pop()!;
    expect(refused.detail).toEqual({ provider: "google", reason: "disabled" });
  });

  // The C8 tests call the sign-in service directly: the HTTP routes have their own per-IP request cap
  // (20 requests per 15 minutes), which a loop of 21 browser sign-ins from one test IP would hit first.
  const service = (maxPerHour?: number) =>
    createGoogleSignIn(pool, "owner@example.com", { mode: "open", maxPerHour: maxPerHour ?? DEFAULT_SIGNUP_MAX_PER_HOUR });
  const claimsOf = (n: number) => ({ sub: `google-sub-${n}`, email: `jane.doe${n}@example.net`, emailVerified: true });
  const reasonOf = (result: GoogleSignInResult) => (result.kind === "refused" ? result.reason : "signed_in");

  it("C8: the default 20 an hour passes, the 21st is refused signup_busy, and existing accounts still sign in", async () => {
    await buildApp({ SIGNUP_MODE: "open" }); // seeds the (old) operator
    const signup = service();
    for (let n = 1; n <= 20; n += 1) {
      expect(reasonOf(await signup.complete(claimsOf(n), undefined, { acceptedTermsVersion: TERMS_VERSION })), `account ${n}`).toBe("signed_in");
    }
    expect(await count("SELECT count(*) AS n FROM identity.users WHERE terms_version IS NOT NULL")).toBe(20);
    expect(reasonOf(await signup.complete(claimsOf(21), undefined, { acceptedTermsVersion: TERMS_VERSION }))).toBe("signup_busy");
    expect(await users()).toBe(21); // 20 new + the operator
    const row = (await audits()).filter((a) => a.action === "signin.refused").pop()!;
    expect(row.detail).toEqual({ provider: "google", reason: "signup_busy" });
    expect(JSON.stringify(row)).not.toMatch(/jane|example\.net/i);
    // An existing account is unaffected by the cap.
    expect(reasonOf(await signup.complete(claimsOf(5), undefined))).toBe("signed_in");
    // Accounts older than an hour stop counting.
    await admin.query("UPDATE identity.users SET terms_accepted_at = now() - interval '61 minutes' WHERE terms_version IS NOT NULL");
    expect(reasonOf(await signup.complete(claimsOf(21), undefined, { acceptedTermsVersion: TERMS_VERSION }))).toBe("signed_in");
  }, 60_000);

  it("C8: concurrent sign-ups cannot pass a lower SIGNUP_MAX_PER_HOUR", async () => {
    await buildApp({ SIGNUP_MODE: "open" });
    const signup = service(3);
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) => signup.complete(claimsOf(n), undefined, { acceptedTermsVersion: TERMS_VERSION })),
    );
    expect(results.map(reasonOf).sort()).toEqual(["signed_in", "signed_in", "signed_in", "signup_busy", "signup_busy", "signup_busy"]);
    expect(await count("SELECT count(*) AS n FROM identity.users WHERE terms_version IS NOT NULL")).toBe(3);
  }, 60_000);

  it("concurrent new accounts all get distinct generated names", async () => {
    await buildApp({ SIGNUP_MODE: "open" });
    const signup = service(40);
    await Promise.all(Array.from({ length: 30 }, (_, i) => signup.complete(claimsOf(i + 1), undefined, { acceptedTermsVersion: TERMS_VERSION })));
    const names = (await admin.query("SELECT display_name FROM identity.users WHERE terms_version IS NOT NULL")).rows.map((r) => r.display_name);
    expect(names).toHaveLength(30);
    expect(new Set(names).size).toBe(30);
  }, 60_000);

  describe("terms forgery and replay, and the boundaries (fresh-eyes pass)", () => {
    const attemptTerms = async () => (await admin.query("SELECT terms_version FROM identity.login_attempts")).rows.map((r) => r.terms_version);

    it("a terms value on the callback's query string never counts", async () => {
      const app = await buildApp({ SIGNUP_MODE: "open" });
      const start = await request(app).get("/api/auth/google/start");
      const attemptCookie = ([start.headers["set-cookie"] ?? []].flat() as string[]).find((c) => c.startsWith(`${LOGIN_ATTEMPT_COOKIE}=`))!.split(";")[0]!;
      const authUrl = new URL(start.headers.location!);
      const code = issuer.issueCode({
        claims: stranger(1),
        nonce: authUrl.searchParams.get("nonce")!,
        codeChallenge: authUrl.searchParams.get("code_challenge")!,
      });
      const res = await request(app)
        .get(`/api/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(authUrl.searchParams.get("state")!)}&terms=${TERMS_VERSION}&acceptedTermsVersion=${TERMS_VERSION}`)
        .set("Cookie", attemptCookie);
      expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=terms_required&return=%2Fapp`);
      expect(await users()).toBe(1);
    });

    it("/start keeps only the exact current version, and nothing at all while sign-up is closed", async () => {
      const open = await buildApp({ SIGNUP_MODE: "open" });
      await request(open).get("/api/auth/google/start?terms=1999-01-01").set("Sec-Fetch-Site", "same-site");
      await request(open).get(`/api/auth/google/start?terms=${TERMS_VERSION}&terms=${TERMS_VERSION}`).set("Sec-Fetch-Site", "same-site");
      await request(open).get(`/api/auth/google/start?terms=${TERMS_VERSION}%20`).set("Sec-Fetch-Site", "same-site");
      expect(await attemptTerms()).toEqual([null, null, null]);
      await request(open).get(`/api/auth/google/start?terms=${TERMS_VERSION}`).set("Sec-Fetch-Site", "same-site");
      expect((await attemptTerms()).filter((t) => t !== null)).toEqual([TERMS_VERSION]);
      await admin.query("TRUNCATE identity.login_attempts");
      const closed = await buildApp({});
      await request(closed).get(`/api/auth/google/start?terms=${TERMS_VERSION}`).set("Sec-Fetch-Site", "same-site");
      expect(await attemptTerms()).toEqual([null]);
    });

    it("an expired attempt with the terms ticked creates nothing and cannot be replayed", async () => {
      const app = await buildApp({ SIGNUP_MODE: "open" });
      const start = await request(app).get(`/api/auth/google/start?terms=${TERMS_VERSION}`).set("Sec-Fetch-Site", "same-site");
      const attemptCookie = ([start.headers["set-cookie"] ?? []].flat() as string[]).find((c) => c.startsWith(`${LOGIN_ATTEMPT_COOKIE}=`))!.split(";")[0]!;
      const authUrl = new URL(start.headers.location!);
      await admin.query("UPDATE identity.login_attempts SET created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute'");
      const code = issuer.issueCode({
        claims: stranger(1),
        nonce: authUrl.searchParams.get("nonce")!,
        codeChallenge: authUrl.searchParams.get("code_challenge")!,
      });
      const url = `/api/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(authUrl.searchParams.get("state")!)}`;
      const first = await request(app).get(url).set("Cookie", attemptCookie);
      expect(first.headers.location).toBe(`${FRONTEND}/app/login?error=expired`);
      const replay = await request(app).get(url).set("Cookie", attemptCookie);
      expect(replay.headers.location).toBe(`${FRONTEND}/app/login?error=expired`);
      expect(await users()).toBe(1);
    });

    it("the CHECK constraints hold: terms pair, version length", async () => {
      await buildApp({ SIGNUP_MODE: "open" });
      const bad = (sql: string, params: unknown[] = []) => admin.query(sql, params).then(() => "ok", (e: Error) => e.message);
      expect(await bad("INSERT INTO identity.users (display_name, terms_version) VALUES ('x', '2026-09-24')")).toMatch(/users_terms_pair/);
      expect(await bad("INSERT INTO identity.users (display_name, terms_accepted_at) VALUES ('x', now())")).toMatch(/users_terms_pair/);
      expect(await bad("INSERT INTO identity.users (display_name, terms_version, terms_accepted_at) VALUES ('x', $1, now())", ["v".repeat(33)])).toMatch(/check/i);
      expect(await bad("INSERT INTO identity.users (display_name, terms_version, terms_accepted_at) VALUES ('x', '', now())")).toMatch(/check/i);
    });

    it("C8 counts sign-ups only: the seeded operator and other non-sign-up accounts never use up the cap", async () => {
      await buildApp({ SIGNUP_MODE: "open" });
      // Fresh accounts that did not come through open sign-up (an invite or bulk path would look like this).
      await admin.query("INSERT INTO identity.users (display_name) SELECT 'Invited ' || g FROM generate_series(1, 5) g");
      await admin.query("UPDATE identity.users SET created_at = now() WHERE terms_version IS NULL");
      const signup = service(1);
      expect(reasonOf(await signup.complete(claimsOf(1), undefined, { acceptedTermsVersion: TERMS_VERSION }))).toBe("signed_in");
      expect(reasonOf(await signup.complete(claimsOf(2), undefined, { acceptedTermsVersion: TERMS_VERSION }))).toBe("signup_busy");
    });

    it("a network gets 3 new accounts a day; the 4th is refused (shown as signup_busy), others are unaffected", async () => {
      await buildApp({ SIGNUP_MODE: "open" });
      const lines: Array<[string, Record<string, string>]> = [];
      const signup = createGoogleSignIn(pool, "owner@example.com", { mode: "open", maxPerHour: 20 }, {
        metrics: { counter: (name, labels) => void lines.push([name, { ...labels }]), histogram: () => undefined },
      });
      const join = (n: number, network: string) =>
        signup.complete(claimsOf(n), undefined, { acceptedTermsVersion: TERMS_VERSION, network });
      for (const n of [1, 2, 3]) expect(reasonOf(await join(n, "203.0.113.9"))).toBe("signed_in");
      expect(reasonOf(await join(4, "203.0.113.9"))).toBe("signup_network_busy");
      expect(reasonOf(await join(4, "203.0.113.10"))).toBe("signed_in");
      // An existing account on the busy network still signs in.
      expect(reasonOf(await signup.complete(claimsOf(1), undefined, { network: "203.0.113.9" }))).toBe("signed_in");
      expect(lines).toEqual([["satis.signup.refused", { reason: "network_limit" }]]);
      const row = (await audits()).filter((a) => a.action === "signin.refused").pop()!;
      expect(row.detail).toEqual({ provider: "google", reason: "signup_network_busy" });
      expect(JSON.stringify(await audits())).not.toContain("203.0.113");
    });

    it("the hourly cap counts its own refusals in the signup_busy counter", async () => {
      await buildApp({ SIGNUP_MODE: "open" });
      const lines: Array<[string, Record<string, string>]> = [];
      const signup = createGoogleSignIn(pool, "owner@example.com", { mode: "open", maxPerHour: 1 }, {
        metrics: { counter: (name, labels) => void lines.push([name, { ...labels }]), histogram: () => undefined },
      });
      await signup.complete(claimsOf(1), undefined, { acceptedTermsVersion: TERMS_VERSION });
      await signup.complete(claimsOf(2), undefined, { acceptedTermsVersion: TERMS_VERSION });
      expect(lines).toEqual([["satis.signup.refused", { reason: "signup_busy" }]]);
    });

    it("the bootstrap address never gets a new account: refused when the operator is disabled and unlinked, or linked elsewhere", async () => {
      const app = await buildApp({ SIGNUP_MODE: "open" });
      const owner: FakeClaims = { sub: "google-sub-owner", email: "Owner@Example.com", email_verified: true };
      await admin.query("UPDATE identity.users SET status = 'disabled'");
      const before = await users();
      const res = await signIn(app, owner, TERMS_VERSION);
      expect(res.headers.location).toBe(`${FRONTEND}/app/login?error=not_invited`);
      expect(hasSession(res)).toBe(false);
      expect(await users()).toBe(before);
      // Operator re-enabled and linked to one Google account: a different account with that address is refused too.
      await admin.query("UPDATE identity.users SET status = 'active'");
      expect((await signIn(app, owner, TERMS_VERSION)).headers.location).toBe(`${FRONTEND}/app`);
      const impostor = await signIn(app, { ...owner, sub: "google-sub-impostor" }, TERMS_VERSION);
      expect(impostor.headers.location).toBe(`${FRONTEND}/app/login?error=not_invited`);
      expect(await users()).toBe(before);
    });

    it("C8 window: an account 59 minutes old still counts, one 61 minutes old does not", async () => {
      await buildApp({ SIGNUP_MODE: "open" });
      const signup = service(1);
      await signup.complete(claimsOf(1), undefined, { acceptedTermsVersion: TERMS_VERSION });
      await admin.query("UPDATE identity.users SET terms_accepted_at = now() - interval '59 minutes' WHERE terms_version IS NOT NULL");
      expect(reasonOf(await signup.complete(claimsOf(2), undefined, { acceptedTermsVersion: TERMS_VERSION }))).toBe("signup_busy");
      await admin.query("UPDATE identity.users SET terms_accepted_at = now() - interval '61 minutes' WHERE terms_version IS NOT NULL");
      expect(reasonOf(await signup.complete(claimsOf(2), undefined, { acceptedTermsVersion: TERMS_VERSION }))).toBe("signed_in");
    });

    it("a refused busy sign-up leaves no user, identity or session behind", async () => {
      await buildApp({ SIGNUP_MODE: "open" });
      const signup = service(1);
      await signup.complete(claimsOf(1), undefined, { acceptedTermsVersion: TERMS_VERSION });
      const sessions = await count("SELECT count(*) AS n FROM identity.sessions");
      await signup.complete(claimsOf(2), undefined, { acceptedTermsVersion: TERMS_VERSION });
      expect(await count("SELECT count(*) AS n FROM identity.sessions")).toBe(sessions);
      expect(await count("SELECT count(*) AS n FROM identity.auth_identities WHERE provider_subject = 'google-sub-2'")).toBe(0);
    });
  });
});
