import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { createLogger } from "../../../platform/logger.js";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { createUser } from "../../identity/repositories/userRepository.js";
import { addMember, removeMember } from "../../servers/repositories/memberRepository.js";
import { upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { loadPushConfig } from "../pushConfig.js";
import { listRules, seedPresetRules, writeEvaluation } from "../repositories/alertRepository.js";
import { claimDueDeliveries, rescheduleDelivery, saveDiscordDestination } from "../repositories/deliveryRepository.js";
import { AlertDeliveryWorker } from "./alertDeliveryWorker.js";
import { createPushService } from "./pushService.js";
import { BASE_DELAY_MS } from "./retryPolicy.js";

// ADR-0044, task 348-2: the push fan-out, the shared outbox and the sender against a real Postgres. The push service is
// a fake fetch; the browser is a real P-256 key pair, so the test decrypts what the sender sent.
const available = dbTestsAvailable();
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
const HOST = "push.example.test";
const vapidPair = createECDH("prime256v1");
vapidPair.generateKeys();
const ENV = {
  VAPID_PUBLIC_KEY: vapidPair.getPublicKey().toString("base64url"),
  VAPID_PRIVATE_KEY: vapidPair.getPrivateKey().toString("base64url"),
  VAPID_SUBJECT: "mailto:ops@example.test",
  PUSH_ENDPOINT_HOSTS: HOST,
};
const config = loadPushConfig(ENV);
const RLO = String.fromCodePoint(0x202e); // a bidi override: game text must never carry it into a notification

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

interface Browser {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  open(body: Buffer): Record<string, unknown>;
}

/** A browser: a subscription and a decryption of RFC 8291 bodies written straight from the RFC. */
function browser(n: number): Browser {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  return {
    endpoint: `https://${HOST}/send/endpoint-secret-${n}-${randomBytes(4).toString("hex")}`,
    keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    open(body) {
      const salt = body.subarray(0, 16);
      const sender = body.subarray(21, 86);
      const ikm = hmac(hmac(auth, ua.computeSecret(sender)), Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), sender, Buffer.from([1])]));
      const prk = hmac(salt, ikm);
      const decipher = createDecipheriv(
        "aes-128-gcm",
        hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16),
        hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12),
      );
      const record = body.subarray(86);
      decipher.setAuthTag(record.subarray(record.length - 16));
      const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
      return JSON.parse(plain.subarray(0, -1).toString("utf8")) as Record<string, unknown>;
    },
  };
}

describe.skipIf(!available)("web push delivery against a real Postgres (ADR-0044, 348-2)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let counter = 0;
  const logLines: string[] = [];
  const counters: { metric: string; labels: Record<string, string> }[] = [];
  const sent: { url: string; init: RequestInit }[] = [];
  let status = 201;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(null, { status, headers: status === 429 ? { "retry-after": "120" } : {} });
  }) as unknown as typeof fetch;

  const service = () => createPushService({ db: pool, ring, mode: "on", config, fetch: fakeFetch });
  const worker = (allowedHosts: readonly string[] = config.allowedHosts) =>
    new AlertDeliveryWorker(pool, ring, {
      logger: createLogger({ level: "debug" }, { write: (line: string) => void logLines.push(line) }),
      fetch: fakeFetch,
      push: { vapid: config.vapid!, allowedHosts },
      metrics: { recordCounter: (metric, labels) => void counters.push({ metric, labels: { ...labels } }), recordHistogram: () => {} },
    });

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

  beforeEach(async () => {
    // Every test starts from an empty queue (the claim is global).
    await admin.query("DELETE FROM alerts.outbox");
    sent.length = 0;
    counters.length = 0;
    status = 201;
  });

  const rows = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;

  /** A server, its owner, and `members` more members (viewers), each with one browser subscribed and opted in. */
  const setup = async (options: { members?: number; displayName?: string } = {}) => {
    const n = ++counter;
    const server = await upsertConfiguredServer(pool, { publicId: `push-${n}`, displayName: options.displayName ?? "Push base" });
    await seedPresetRules(pool, server.publicId);
    const ruleId = (await listRules(pool)).find((rule) => rule.server_public_id === server.publicId && rule.kind === "power_outage")!.id;
    const owner = (await createUser(pool, { displayName: `owner-${n}` })).id;
    await addMember(pool, { serverId: server.id, userId: owner, role: "owner", actorUserId: null });
    const people: { userId: string; browser: Browser; subscriptionId: string }[] = [];
    for (let i = 0; i <= (options.members ?? 0); i += 1) {
      const userId = i === 0 ? owner : (await createUser(pool, { displayName: `member-${n}-${i}` })).id;
      if (i > 0) await addMember(pool, { serverId: server.id, userId, role: "viewer", actorUserId: null });
      const b = browser(n * 100 + i);
      const sub = await service().subscribe(userId, { endpoint: b.endpoint, keys: b.keys });
      await service().setOptIn(server.publicId, userId, true);
      people.push({ userId, browser: b, subscriptionId: sub.subscription.id });
    }
    const fire = (deliverPush = true, transition: "fired" | "resolved" = "fired") =>
      writeEvaluation(pool, {
        nowMs: Date.now(),
        deliver: true,
        deliverPush,
        writes: [],
        events: [{ ruleId, kind: "power_outage", severity: "critical", subject: "circuit:1", transition, summary: { circuit: 7 } }],
      });
    return { server, ruleId, people, fire };
  };

  const pushRows = async (serverId: string) =>
    (await rows(
      `SELECT o.push_subscription_id::text AS sub, o.status, o.last_error, o.attempts
       FROM alerts.outbox o JOIN alerts.alert_events e ON e.id = o.event_id
       WHERE e.server_id = $1 AND o.push_subscription_id IS NOT NULL ORDER BY o.id`,
      [serverId],
    )) as { sub: string; status: string; last_error: string | null; attempts: number }[];

  describe("fan-out", () => {
    it("queues one row per opted-in member's subscription in the event's transaction, and none when push is off", async () => {
      const { server, people, fire } = await setup({ members: 2 });
      // A member who did not opt in, and a user who opted in but is no longer a member, get nothing.
      const quiet = (await createUser(pool, { displayName: "quiet" })).id;
      await addMember(pool, { serverId: server.id, userId: quiet, role: "viewer", actorUserId: null });
      const qb = browser(9001);
      await service().subscribe(quiet, { endpoint: qb.endpoint, keys: qb.keys });
      const left = people[2]!;
      await removeMember(pool, { serverId: server.id, userId: left.userId, actorUserId: null });
      await admin.query("INSERT INTO alerts.push_optins (server_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [server.id, left.userId]);
      // A disabled account (#516) gets nothing either.
      const disabled = people[1]!;
      await admin.query("UPDATE identity.users SET status = 'disabled' WHERE id = $1", [disabled.userId]);

      await fire(false);
      expect(await pushRows(server.id)).toEqual([]);
      await fire(true);
      expect((await pushRows(server.id)).map((r) => r.sub)).toEqual([people[0]!.subscriptionId]);
      await admin.query("UPDATE identity.users SET status = 'active' WHERE id = $1", [disabled.userId]);
    });

    it("a member with two devices gets a row for each", async () => {
      const { people, fire, server } = await setup();
      const second = browser(9002);
      await service().subscribe(people[0]!.userId, { endpoint: second.endpoint, keys: second.keys });
      await fire();
      expect(await pushRows(server.id)).toHaveLength(2);
    });
  });

  describe("sending", () => {
    it("sends an RFC 8291 body the browser can decrypt, carrying the Discord message's words with game text cleaned", async () => {
      const { people, fire, server } = await setup({ displayName: `Base${RLO} *one* @everyone` });
      await fire();
      await worker().tick();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.url).toBe(people[0]!.browser.endpoint);
      expect(sent[0]!.init.redirect).toBe("manual");
      expect(sent[0]!.init.signal).toBeInstanceOf(AbortSignal); // a deadline
      const headers = sent[0]!.init.headers as Record<string, string>;
      expect(headers).toMatchObject({ "content-encoding": "aes128gcm", urgency: "high" });
      const payload = people[0]!.browser.open(Buffer.from(sent[0]!.init.body as Uint8Array));
      expect(payload).toMatchObject({ v: 1, title: "Power outage: circuit 7", serverId: server.publicId, kind: "power_outage", transition: "fired", severity: "critical" });
      expect(payload.body).toBe("Base *one* @everyone"); // the bidi override is gone; plain text needs no markdown escapes
      expect(JSON.stringify(payload)).not.toContain(RLO);
      expect((await pushRows(server.id))[0]).toMatchObject({ status: "sent" });
      expect((await rows("SELECT last_success_at FROM alerts.push_subscriptions WHERE id = $1", [people[0]!.subscriptionId]))[0]!.last_success_at).not.toBeNull();
    });

    it("drops the row without sending when the recipient is no longer a member (send-time recheck)", async () => {
      const { people, fire, server } = await setup({ members: 1 });
      await fire();
      await removeMember(pool, { serverId: server.id, userId: people[1]!.userId, actorUserId: null });
      await worker().tick();
      expect(sent.map((s) => s.url)).toEqual([people[0]!.browser.endpoint]);
      const byUser = new Map((await pushRows(server.id)).map((r) => [r.sub, r]));
      expect(byUser.get(people[1]!.subscriptionId)).toMatchObject({ status: "dead", last_error: "recipient_not_member" });
      expect(counters).toContainEqual({ metric: "satis.alerts.push.dropped", labels: { server: server.publicId, reason: "not_member" } });
    });

    it("drops the row without sending when the account was disabled after it was queued (#516)", async () => {
      const { people, fire, server } = await setup();
      await fire();
      await admin.query("UPDATE identity.users SET status = 'disabled' WHERE id = $1", [people[0]!.userId]);
      await worker().tick();
      expect(sent).toEqual([]);
      expect((await pushRows(server.id))[0]).toMatchObject({ status: "dead", last_error: "recipient_user_inactive" });
      expect(counters).toContainEqual({ metric: "satis.alerts.push.dropped", labels: { server: server.publicId, reason: "user_inactive" } });
    });

    it("drops the row when the member opted out after it was queued", async () => {
      const { people, fire, server } = await setup();
      await fire();
      await service().setOptIn(server.publicId, people[0]!.userId, false);
      await worker().tick();
      expect(sent).toEqual([]);
      expect((await pushRows(server.id))[0]).toMatchObject({ status: "dead", last_error: "recipient_opted_out" });
    });

    it("re-checks the endpoint against the allowlist at send time: a host no longer allowed is never fetched", async () => {
      const { fire, server } = await setup();
      await fire();
      await worker(["other.example.test"]).tick();
      expect(sent).toEqual([]);
      expect((await pushRows(server.id))[0]).toMatchObject({ status: "dead", last_error: "endpoint_refused" });
    });

    it("a 410 deletes the subscription, its pending rows with it, and audits it with ids only", async () => {
      const { people, fire, server } = await setup();
      await fire();
      await fire(true, "resolved");
      status = 410;
      await worker().tick();
      expect(sent).toHaveLength(1); // the second row is paused this tick, then gone with the subscription
      expect(await rows("SELECT 1 FROM alerts.push_subscriptions WHERE id = $1", [people[0]!.subscriptionId])).toEqual([]);
      expect(await pushRows(server.id)).toEqual([]);
      expect(await rows("SELECT actor_user_id, server_id, detail FROM audit.audit_events WHERE action = 'alerts.push.subscription_gone' AND server_id = $1", [server.id])).toEqual([
        { actor_user_id: null, server_id: server.id, detail: { subscriptionId: people[0]!.subscriptionId, status: 410 } },
      ]);
    });

    it("a 404 deletes the subscription too", async () => {
      const { people, fire } = await setup();
      await fire();
      status = 404;
      await worker().tick();
      expect(await rows("SELECT 1 FROM alerts.push_subscriptions WHERE id = $1", [people[0]!.subscriptionId])).toEqual([]);
    });

    it("a 5xx retries with the existing backoff; a 429 honours Retry-After; another 4xx is dropped", async () => {
      const { fire, server } = await setup();
      await fire();
      status = 503;
      const before = Date.now();
      await worker().tick();
      const [row] = (await rows(
        `SELECT o.status, o.last_error, o.attempts, floor(extract(epoch FROM o.next_attempt_at) * 1000)::float8 AS next_ms
         FROM alerts.outbox o JOIN alerts.alert_events e ON e.id = o.event_id WHERE e.server_id = $1`,
        [server.id],
      )) as { status: string; last_error: string; attempts: number; next_ms: number }[];
      expect(row).toMatchObject({ status: "pending", last_error: "server_error", attempts: 1 });
      expect(row!.next_ms).toBeGreaterThanOrEqual(before + BASE_DELAY_MS - 1000);

      // Due again: a 429 with Retry-After 120 s.
      await admin.query("UPDATE alerts.outbox SET next_attempt_at = now()");
      status = 429;
      await worker().tick();
      expect((await pushRows(server.id))[0]).toMatchObject({ status: "pending", last_error: "rate_limited", attempts: 2 });

      await admin.query("UPDATE alerts.outbox SET next_attempt_at = now()");
      status = 400;
      await worker().tick();
      expect((await pushRows(server.id))[0]).toMatchObject({ status: "dead", last_error: "bad_request" });
      expect(sent).toHaveLength(3);
    });
  });

  describe("fairness (#515)", () => {
    it("a server's push rows take turns with other servers' rows: one server's many subscribers do not fill the batch", async () => {
      const crowded = await setup({ members: 5 });
      const quiet = await setup();
      const URL = `https://discord.com/api/webhooks/1234567890123456789/${"Ab0_-".repeat(14)}`;
      await saveDiscordDestination(pool, ring, quiet.server.publicId, URL);
      // The quiet server's push opt-in is withdrawn: it has only its Discord row.
      await service().setOptIn(quiet.server.publicId, quiet.people[0]!.userId, false);
      await crowded.fire();
      await quiet.fire();
      const claimed = await claimDueDeliveries(pool, 2, 120);
      expect(claimed.map((c) => `${c.serverPublicId}:${c.channel}`).sort()).toEqual([`${crowded.server.publicId}:push`, `${quiet.server.publicId}:discord`].sort());
      // Give the rows back so the queue is clean for anything after.
      for (const c of claimed) await rescheduleDelivery(pool, c.outboxId, Date.now(), "test");
    });
  });

  describe("hunt: races and edges", () => {
    it("a user opted in on two servers gets each event's row only for the event's own server", async () => {
      const a = await setup();
      const b = await setup();
      const userId = a.people[0]!.userId;
      await addMember(pool, { serverId: b.server.id, userId, role: "viewer", actorUserId: null });
      await service().setOptIn(b.server.publicId, userId, true);
      await a.fire();
      expect(await pushRows(a.server.id)).toHaveLength(1);
      expect(await pushRows(b.server.id)).toEqual([]);
      await b.fire();
      // b's owner and the shared user: one row each, no duplicates
      expect(new Set((await pushRows(b.server.id)).map((r) => r.sub)).size).toBe(2);
      expect(await pushRows(b.server.id)).toHaveLength(2);
      expect(await pushRows(a.server.id)).toHaveLength(1);
    });

    it("a subscription deleted between the enqueue and the claim is never claimed or sent", async () => {
      const { people, fire, server } = await setup();
      await fire();
      await admin.query("DELETE FROM alerts.push_subscriptions WHERE id = $1", [people[0]!.subscriptionId]);
      expect(await claimDueDeliveries(pool, 10, 120)).toEqual([]);
      await worker().tick();
      expect(sent).toHaveLength(0);
      expect(await pushRows(server.id)).toEqual([]);
    });

    it("a push row is claimed while the server's Discord destination is disabled, and a disabled destination's row is not", async () => {
      const { people, fire, server } = await setup();
      const URL = `https://discord.com/api/webhooks/1234567890123456789/${"Ab0_-".repeat(14)}`;
      await saveDiscordDestination(pool, ring, server.publicId, URL);
      await admin.query("UPDATE alerts.destinations SET enabled = false, disabled_reason = 'manual'");
      await fire();
      const claimed = await claimDueDeliveries(pool, 10, 120);
      expect(claimed.map((c) => c.channel)).toEqual(["push"]);
      expect(claimed[0]).toMatchObject({ channel: "push", subscriptionId: people[0]!.subscriptionId });
    });

    it("keeps the event order within a server's push rows", async () => {
      const { fire } = await setup();
      await fire(true, "fired");
      await fire(true, "resolved");
      const claimed = await claimDueDeliveries(pool, 10, 120);
      expect(claimed.map((c) => c.event.transition)).toEqual(["fired", "resolved"]);
    });

    it("a 403 (VAPID refused) drops the row and keeps the subscription", async () => {
      const { fire, server, people } = await setup();
      await fire();
      status = 403;
      await worker().tick();
      expect((await pushRows(server.id))[0]).toMatchObject({ status: "dead", last_error: "vapid_rejected" });
      expect(await rows("SELECT 1 FROM alerts.push_subscriptions WHERE id = $1", [people[0]!.subscriptionId])).toHaveLength(1);
    });
  });

  it("no endpoint, key or payload text appears in any log line", async () => {
    const { people, fire } = await setup({ members: 1 });
    await fire();
    status = 410;
    await worker().tick();
    const everything = logLines.join("\n");
    expect(logLines.length).toBeGreaterThan(0);
    for (const person of people) {
      for (const secret of [person.browser.endpoint, new URL(person.browser.endpoint).pathname, person.browser.keys.p256dh, person.browser.keys.auth]) {
        expect(everything.includes(secret), secret.slice(0, 10)).toBe(false);
      }
    }
    expect(everything).not.toContain(HOST);
    expect(everything).not.toContain(ENV.VAPID_PRIVATE_KEY);
    expect(everything).not.toContain("Power outage");
  });
});
