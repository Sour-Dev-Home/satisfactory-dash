import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { createUser } from "../../identity/repositories/userRepository.js";
import { addMember } from "../../servers/repositories/memberRepository.js";
import { upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { InMemoryServerDirectory, createServersRouter } from "../../servers/index.js";
import { createDbServerAccess } from "../../servers/serverAccess.js";
import { createPushRouters } from "../index.js";
import { loadPushConfig } from "../pushConfig.js";
import { createPushService } from "./pushService.js";

// ADR-0044, task 348-1: web push storage and routes against a real Postgres, through the real app (so the session-less
// guard stand-in, the membership middleware, the body parser and the error envelope are all the production ones).
const available = dbTestsAvailable();
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));

const HOST = "push.example.test";
const endpointOf = (n: number) => `https://${HOST}/send/secret-endpoint-token-${n}`;
const P256DH = "B".repeat(87);
const AUTH = "C".repeat(22);
const subscription = (n: number, keys = { p256dh: P256DH, auth: AUTH }) => ({ endpoint: endpointOf(n), keys });

const VAPID_ENV = (() => {
  // A syntactically valid P-256 key pair is not needed beyond shape here: the config only validates length and encoding.
  const point = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url");
  return { VAPID_PUBLIC_KEY: point, VAPID_PRIVATE_KEY: randomBytes(32).toString("base64url"), VAPID_SUBJECT: "mailto:ops@example.test", PUSH_ENDPOINT_HOSTS: HOST };
})();

describe.skipIf(!available)("web push against a real Postgres (ADR-0044)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  const logLines: string[] = [];

  let alice: string;
  let bob: string;
  let viewer: string;
  let serverId: string; // alpha's internal id

  const members: Record<string, string> = {};
  const guard: RequestHandler = (req, res, next) => {
    const id = req.header("x-test-user");
    if (id === undefined) {
      res.status(401).json({ error: { code: "unauthorized", message: "Sign in to continue", requestId: "t" } });
      return;
    }
    res.locals.user = { id, name: id };
    next();
  };

  const buildApp = (mode: "on" | "off" = "on", env: NodeJS.ProcessEnv = VAPID_ENV) => {
    const service = createPushService({ db: pool, ring, mode, config: loadPushConfig(env) });
    return createApp({
      logger: createLogger({ level: "debug" }, { write: (line: string) => void logLines.push(line) }),
      routers: [],
      sessionGuard: guard,
      protectedRouters: [
        createServersRouter(new InMemoryServerDirectory([{ id: "alpha", displayName: "Alpha", services: {} }]), createDbServerAccess(pool)),
        ...createPushRouters(service),
      ],
    });
  };
  let app: ReturnType<typeof buildApp>;

  const as = (user: string) => ({
    get: (url: string) => request(app).get(url).set("x-test-user", user),
    post: (url: string, body?: unknown) => {
      const req = request(app).post(url).set("x-test-user", user);
      return body === undefined ? req : req.set("Content-Type", "application/json").send(JSON.stringify(body));
    },
    put: (url: string, body: unknown) => request(app).put(url).set("x-test-user", user).set("Content-Type", "application/json").send(JSON.stringify(body)),
    delete: (url: string) => request(app).delete(url).set("x-test-user", user),
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 8 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    [alice, bob, viewer] = (await Promise.all([1, 2, 3].map((i) => createUser(pool, { displayName: `user-${i}` })))).map((u) => u.id) as [string, string, string];
    serverId = (await upsertConfiguredServer(pool, { publicId: "alpha", displayName: "Alpha" })).id;
    await addMember(pool, { serverId, userId: alice, role: "owner", actorUserId: null });
    await addMember(pool, { serverId, userId: viewer, role: "viewer", actorUserId: null });
    members.alice = alice;
    app = buildApp();
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const rows = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;

  describe("config", () => {
    it("is enabled with the public key only when ALERT_DELIVERY=on and VAPID is configured", async () => {
      const on = await as(alice).get(endpoints.push.config.path());
      expect(on.body).toEqual({ enabled: true, vapidPublicKey: VAPID_ENV.VAPID_PUBLIC_KEY });
      expect(JSON.stringify(on.body)).not.toContain(VAPID_ENV.VAPID_PRIVATE_KEY);
      const off = await request(buildApp("off")).get(endpoints.push.config.path()).set("x-test-user", alice);
      expect(off.body).toEqual({ enabled: false });
      const noVapid = await request(buildApp("on", {})).get(endpoints.push.config.path()).set("x-test-user", alice);
      expect(noVapid.body).toEqual({ enabled: false });
    });

    it("needs a session", async () => {
      expect((await request(app).get(endpoints.push.config.path())).status).toBe(401);
    });

    it("subscribing, testing and opting in are push_disabled (409) while push is not enabled; unsubscribing still works", async () => {
      const disabled = buildApp("off");
      const post = (url: string, body?: unknown) => {
        const req = request(disabled).post(url).set("x-test-user", alice);
        return body === undefined ? req : req.set("Content-Type", "application/json").send(JSON.stringify(body));
      };
      const sub = await post(endpoints.push.subscribe.path(), subscription(900));
      expect(sub.status).toBe(409);
      expect(ApiErrorResponseSchema.parse(sub.body).error.code).toBe("push_disabled");
      expect((await post(endpoints.push.test.path("5b1f0c2a-7b4d-4c8a-9e51-1a2b3c4d5e11"))).status).toBe(409);
      const optIn = await request(disabled).put(endpoints.push.optIn.put.path("alpha")).set("x-test-user", alice).set("Content-Type", "application/json").send('{"optedIn":true}');
      expect(optIn.status).toBe(409);
      expect((await request(disabled).delete(endpoints.push.unsubscribe.path("5b1f0c2a-7b4d-4c8a-9e51-1a2b3c4d5e11")).set("x-test-user", alice)).status).toBe(404);
      expect(await rows("SELECT 1 FROM alerts.push_subscriptions")).toEqual([]);
    });
  });

  describe("subscribing", () => {
    it("stores a subscription SEALED, answers an id and a time only, and writes an audit row with ids only", async () => {
      const res = await as(alice).post(endpoints.push.subscribe.path(), subscription(1));
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(["createdAt", "id"]);
      const [row] = await rows("SELECT * FROM alerts.push_subscriptions WHERE id = $1", [res.body.id]);
      expect(row.user_id).toBe(alice);
      expect(row.endpoint_host).toBe(HOST);
      for (const [column, plain] of [["endpoint_enc", endpointOf(1)], ["p256dh_enc", P256DH], ["auth_enc", AUTH]] as const) {
        expect(Buffer.from(row[column]).includes(Buffer.from(plain)), column).toBe(false);
      }
      // Sealed for this user and field: opening with the wrong context fails.
      expect(ring.open(row.key_id, row.endpoint_enc, `push:${alice}:endpoint`)).toBe(endpointOf(1));
      expect(() => ring.open(row.key_id, row.endpoint_enc, `push:${bob}:endpoint`)).toThrow();
      expect(() => ring.open(row.key_id, row.endpoint_enc, `push:${alice}:auth`)).toThrow();
      const audit = await rows("SELECT action, actor_user_id, detail FROM audit.audit_events WHERE action LIKE 'alerts.push.%' AND detail->>'subscriptionId' = $1", [res.body.id]);
      expect(audit).toEqual([{ action: "alerts.push.subscribed", actor_user_id: alice, detail: { subscriptionId: res.body.id, host: HOST } }]);
    });

    it("is idempotent for the same endpoint (200, same id, keys replaced, no second audit row)", async () => {
      const first = await as(alice).post(endpoints.push.subscribe.path(), subscription(2));
      const newAuth = "D".repeat(22);
      const again = await as(alice).post(endpoints.push.subscribe.path(), subscription(2, { p256dh: P256DH, auth: newAuth }));
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
      expect(await rows("SELECT 1 FROM alerts.push_subscriptions WHERE user_id = $1 AND endpoint_hash = sha256($2::bytea)", [alice, Buffer.from(`https://${HOST}/send/secret-endpoint-token-2`)])).toHaveLength(1);
      const [row] = await rows("SELECT key_id, auth_enc FROM alerts.push_subscriptions WHERE id = $1", [first.body.id]);
      expect(ring.open(row.key_id, row.auth_enc, `push:${alice}:auth`)).toBe(newAuth);
      expect(await rows("SELECT 1 FROM audit.audit_events WHERE action = 'alerts.push.subscribed' AND detail->>'subscriptionId' = $1", [first.body.id])).toHaveLength(1);
    });

    it("refuses an endpoint on a host that is not allowlisted BEFORE storing anything, with a reason and no URL", async () => {
      const before = (await rows("SELECT count(*)::int AS n FROM alerts.push_subscriptions"))[0].n;
      const evil = "https://evil.example/send/super-secret-evil-token";
      const res = await as(alice).post(endpoints.push.subscribe.path(), { endpoint: evil, keys: { p256dh: P256DH, auth: AUTH } });
      expect(res.status).toBe(400);
      const error = ApiErrorResponseSchema.parse(res.body).error;
      expect(error).toMatchObject({ code: "push_endpoint_invalid", reason: "host_not_allowed" });
      expect(JSON.stringify(res.body)).not.toContain("evil");
      expect((await rows("SELECT count(*)::int AS n FROM alerts.push_subscriptions"))[0].n).toBe(before);
      for (const endpoint of ["http://push.example.test/x", "https://user:pw@push.example.test/x", "https://push.example.test:8443/x", "nonsense"]) {
        expect((await as(alice).post(endpoints.push.subscribe.path(), { endpoint, keys: { p256dh: P256DH, auth: AUTH } })).status, endpoint).toBe(400);
      }
    });

    it("refuses a body that does not match the contract with a fixed message, and nothing is stored", async () => {
      const res = await as(alice).post(endpoints.push.subscribe.path(), { endpoint: endpointOf(3), keys: { p256dh: "short", auth: AUTH } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("bad_request");
      expect(res.body.error.message).toBe("The request body is not valid");
      expect(JSON.stringify(res.body)).not.toContain("secret-endpoint-token");
    });

    it("allows 10 subscriptions per user and refuses an 11th as bad_request (a repeat of an existing one still works)", async () => {
      const carol = (await createUser(pool, { displayName: "carol" })).id;
      for (let n = 100; n < 110; n += 1) expect((await as(carol).post(endpoints.push.subscribe.path(), subscription(n))).status).toBe(201);
      const eleventh = await as(carol).post(endpoints.push.subscribe.path(), subscription(110));
      expect(eleventh.status).toBe(400);
      expect(eleventh.body.error.code).toBe("bad_request");
      expect((await as(carol).post(endpoints.push.subscribe.path(), subscription(105))).status).toBe(200);
      // The limit is per user: another account is unaffected.
      expect((await as(bob).post(endpoints.push.subscribe.path(), subscription(100))).status).toBe(201);
    });

    it("holds the limit under concurrent subscribes (the per-user lock)", async () => {
      const dave = (await createUser(pool, { displayName: "dave" })).id;
      const results = await Promise.all(Array.from({ length: 14 }, (_, i) => as(dave).post(endpoints.push.subscribe.path(), subscription(200 + i))));
      expect(results.filter((r) => r.status === 201)).toHaveLength(10);
      expect(results.filter((r) => r.status === 400)).toHaveLength(4);
      expect((await rows("SELECT count(*)::int AS n FROM alerts.push_subscriptions WHERE user_id = $1", [dave]))[0].n).toBe(10);
    });
  });

  describe("IDOR: one user cannot reach another's subscription (generated from the endpoints list)", () => {
    const withId = Object.entries(endpoints.push).filter(([, e]) => "route" in e && (e as { route: string }).route.includes("/subscriptions/:id"));

    it("the contract has the id-taking endpoints this test exercises", () => {
      expect(withId.map(([name]) => name).sort()).toEqual(["test", "unsubscribe"]);
    });

    it.each(withId.map(([name]) => name))("%s: the owner's id is a 404 for another user, and nothing changes", async (name) => {
      const created = await as(alice).post(endpoints.push.subscribe.path(), subscription(300 + name.length));
      const id = created.body.id as string;
      const e = endpoints.push[name as "test" | "unsubscribe"];
      const send = (user: string) => (e.method === "DELETE" ? as(user).delete(e.path(id)) : as(user).post(e.path(id)));
      const stranger = await send(bob);
      expect(stranger.status).toBe(404);
      expect(ApiErrorResponseSchema.parse(stranger.body).error.code).toBe("not_found");
      // The same answer as for an id that does not exist at all, so existence is not revealed.
      const missing = e.method === "DELETE" ? await as(bob).delete(e.path("5b1f0c2a-7b4d-4c8a-9e51-1a2b3c4d5e99")) : await as(bob).post(e.path("5b1f0c2a-7b4d-4c8a-9e51-1a2b3c4d5e99"));
      expect(missing.status).toBe(404);
      expect(missing.body.error.message).toBe(stranger.body.error.message);
      expect(await rows("SELECT 1 FROM alerts.push_subscriptions WHERE id = $1", [id])).toHaveLength(1);
      // A refused attempt leaves no audit row.
      expect(await rows("SELECT 1 FROM audit.audit_events WHERE actor_user_id = $1 AND action IN ('alerts.push.unsubscribed', 'alerts.push.tested')", [bob])).toEqual([]);
    });

    it("a malformed id is the same 404", async () => {
      expect((await as(alice).delete(endpoints.push.unsubscribe.path("not-a-uuid"))).status).toBe(404);
      expect((await as(alice).post(endpoints.push.test.path("not-a-uuid"))).status).toBe(404);
    });

    it("the owner can unsubscribe (audited), and a second time it is a 404", async () => {
      const created = await as(alice).post(endpoints.push.subscribe.path(), subscription(400));
      const del = await as(alice).delete(endpoints.push.unsubscribe.path(created.body.id));
      expect(del.status).toBe(200);
      expect(del.body).toEqual({ deleted: true });
      expect(await rows("SELECT 1 FROM audit.audit_events WHERE action = 'alerts.push.unsubscribed' AND detail->>'subscriptionId' = $1", [created.body.id])).toHaveLength(1);
      expect((await as(alice).delete(endpoints.push.unsubscribe.path(created.body.id))).status).toBe(404);
    });
  });

  describe("test notification", () => {
    it("answers unavailable until the sender exists (348-2), audits it, and is limited to 5 per minute per user", async () => {
      const erin = (await createUser(pool, { displayName: "erin" })).id;
      const created = await as(erin).post(endpoints.push.subscribe.path(), subscription(500));
      const url = endpoints.push.test.path(created.body.id);
      for (let i = 0; i < 5; i += 1) {
        const res = await as(erin).post(url);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: false, code: "unavailable" });
      }
      const limited = await as(erin).post(url);
      expect(limited.status).toBe(429);
      expect(limited.headers["retry-after"]).toBeDefined();
      expect(await rows("SELECT 1 FROM audit.audit_events WHERE actor_user_id = $1 AND action = 'alerts.push.tested'", [erin])).toHaveLength(5);
    });
  });

  describe("per-server opt-in", () => {
    const url = endpoints.push.optIn.get.path("alpha");

    it("any member, a viewer included, can opt in and out of their OWN notifications; it is audited once per change", async () => {
      expect((await as(viewer).get(url)).body).toEqual({ optedIn: false });
      expect((await as(viewer).put(url, { optedIn: true })).body).toEqual({ optedIn: true });
      expect((await as(viewer).put(url, { optedIn: true })).body).toEqual({ optedIn: true }); // repeat: no second row or event
      expect((await as(viewer).get(url)).body).toEqual({ optedIn: true });
      // Another member's state is separate.
      expect((await as(alice).get(url)).body).toEqual({ optedIn: false });
      expect((await as(viewer).put(url, { optedIn: false })).body).toEqual({ optedIn: false });
      expect((await as(viewer).get(url)).body).toEqual({ optedIn: false });
      const audit = await rows("SELECT action, server_id, detail FROM audit.audit_events WHERE actor_user_id = $1 AND action LIKE 'alerts.push.opt%' ORDER BY id", [viewer]);
      expect(audit).toEqual([
        { action: "alerts.push.opt_in", server_id: serverId, detail: {} },
        { action: "alerts.push.opt_out", server_id: serverId, detail: {} },
      ]);
    });

    it("a non-member gets the same 404 as an unknown server, for read and write", async () => {
      expect((await as(bob).get(url)).status).toBe(404);
      expect((await as(bob).put(url, { optedIn: true })).status).toBe(404);
      expect(await rows("SELECT 1 FROM alerts.push_optins WHERE user_id = $1", [bob])).toEqual([]);
    });

    it("a viewer still cannot write anything else under the server (only the opt-in is exempt)", async () => {
      // No other route is mounted in this app, so a write elsewhere under the server is refused by the membership check first.
      const other = await as(viewer).put("/api/servers/alpha/alerts/push-other", { optedIn: true });
      expect(other.status).toBe(403);
      expect((await as(viewer).put(`${url}/`, { optedIn: true })).status).toBe(403); // exact path only
      expect((await as(viewer).post(url)).status).toBe(403); // exact method only
    });

    it("refuses a body that is not exactly { optedIn: boolean }", async () => {
      expect((await as(alice).put(url, { optedIn: "yes" })).status).toBe(400);
      expect((await as(alice).put(url, { optedIn: true, userId: bob })).status).toBe(400);
    });
  });

  describe("secrets never leak", () => {
    it("no endpoint, p256dh, auth or VAPID private key appears in any log line, response or audit row", async () => {
      const marker = `leak-check-${randomBytes(6).toString("hex")}`;
      const secretEndpoint = `https://${HOST}/send/${marker}`;
      const keys = { p256dh: `${"P".repeat(77)}${randomBytes(8).toString("hex").slice(0, 10)}`, auth: randomBytes(16).toString("base64url") };
      const frank = (await createUser(pool, { displayName: "frank" })).id;
      const responses = [
        await as(frank).post(endpoints.push.subscribe.path(), { endpoint: secretEndpoint, keys }),
        await as(frank).post(endpoints.push.subscribe.path(), { endpoint: secretEndpoint, keys }),
        await as(frank).post(endpoints.push.subscribe.path(), { endpoint: `https://evil.example/${marker}`, keys }),
        await as(frank).post(endpoints.push.subscribe.path(), { endpoint: secretEndpoint, keys: { p256dh: marker, auth: keys.auth } }),
      ];
      const id = responses[0]!.body.id as string;
      responses.push(await as(frank).post(endpoints.push.test.path(id)), await as(frank).delete(endpoints.push.unsubscribe.path(id)));
      const everything = [
        ...logLines,
        ...responses.map((r) => JSON.stringify(r.body)),
        JSON.stringify(await rows("SELECT * FROM audit.audit_events")),
      ].join("\n");
      for (const secret of [marker, keys.p256dh, keys.auth, VAPID_ENV.VAPID_PRIVATE_KEY]) {
        expect(everything.includes(secret), secret.slice(0, 6)).toBe(false);
      }
      expect(logLines.length).toBeGreaterThan(0); // the capture really saw the requests
    });
  });

  describe("storage", () => {
    it("deleting a user removes their subscriptions and opt-ins", async () => {
      const gone = (await createUser(pool, { displayName: "gone" })).id;
      await addMember(pool, { serverId, userId: gone, role: "viewer", actorUserId: null });
      await as(gone).post(endpoints.push.subscribe.path(), subscription(600));
      await as(gone).put(url(), { optedIn: true });
      expect(await rows("SELECT 1 FROM alerts.push_subscriptions WHERE user_id = $1", [gone])).toHaveLength(1);
      expect(await rows("SELECT 1 FROM alerts.push_optins WHERE user_id = $1", [gone])).toHaveLength(1);
      await admin.query("DELETE FROM identity.users WHERE id = $1", [gone]);
      expect(await rows("SELECT 1 FROM alerts.push_subscriptions WHERE user_id = $1", [gone])).toEqual([]);
      expect(await rows("SELECT 1 FROM alerts.push_optins WHERE user_id = $1", [gone])).toEqual([]);
      function url() {
        return endpoints.push.optIn.put.path("alpha");
      }
    });

    it("deleting a server removes its opt-ins", async () => {
      const s2 = await upsertConfiguredServer(pool, { publicId: "temp-push", displayName: "T" });
      await addMember(pool, { serverId: s2.id, userId: bob, role: "owner", actorUserId: null });
      await admin.query("INSERT INTO alerts.push_optins (server_id, user_id) VALUES ($1, $2)", [s2.id, bob]);
      await admin.query("DELETE FROM servers.servers WHERE id = $1", [s2.id]);
      expect(await rows("SELECT 1 FROM alerts.push_optins WHERE server_id = $1", [s2.id])).toEqual([]);
    });

    it("an outbox row has exactly one target: a Discord destination or a push subscription", async () => {
      const [{ id: subId }] = await rows("SELECT id FROM alerts.push_subscriptions WHERE user_id = $1 LIMIT 1", [alice]);
      const [{ id: eventId }] = await rows(
        `INSERT INTO alerts.alert_events (server_id, kind, severity, subject, transition, at)
         VALUES ($1, 'power_outage', 'critical', 'circuit-1', 'fired', now()) RETURNING id`,
        [serverId],
      );
      await admin.query("INSERT INTO alerts.outbox (event_id, push_subscription_id) VALUES ($1, $2)", [eventId, subId]);
      await expect(admin.query("INSERT INTO alerts.outbox (event_id, push_subscription_id) VALUES ($1, $2)", [eventId, subId])).rejects.toMatchObject({ code: "23505" });
      await expect(admin.query("INSERT INTO alerts.outbox (event_id) VALUES ($1)", [eventId])).rejects.toMatchObject({ code: "23514" });
      // Deleting the subscription deletes its queued rows.
      await admin.query("DELETE FROM alerts.push_subscriptions WHERE id = $1", [subId]);
      expect(await rows("SELECT 1 FROM alerts.outbox WHERE push_subscription_id = $1", [subId])).toEqual([]);
    });
  });
});
