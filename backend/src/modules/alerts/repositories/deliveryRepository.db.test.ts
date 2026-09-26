import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { softDeleteServer, upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { listRules, purgeExpiredEvents, seedPresetRules, writeEvaluation, ALERT_EVENT_RETENTION_MS } from "./alertRepository.js";
import {
  claimDueDeliveries,
  disableDestination,
  getDestinationSummary,
  markDeliveryDead,
  markDeliverySent,
  openServerWebhook,
  rescheduleDelivery,
  saveDiscordDestination,
} from "./deliveryRepository.js";

const available = dbTestsAvailable();

const ID = "1234567890123456789";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const URL_A = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;
const URL_B = `https://discordapp.com/api/webhooks/9876543210987654321/${"Zy9876543210_-".repeat(5)}`;
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));

// ADR-0027 decision 5 against a real Postgres (the migration is applied by createTestDatabase; the repository runs as
// satis_app, fixtures the app never writes go in as the admin).
describe.skipIf(!available)("alert delivery repository against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let counter = 0;

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

  const NOW = Date.now();
  const newServer = async () => {
    const server = await upsertConfiguredServer(pool, { publicId: `dl-${++counter}`, displayName: "Delivery" });
    await seedPresetRules(pool, server.publicId);
    const outage = (await listRules(pool)).find((rule) => rule.server_public_id === server.publicId && rule.kind === "power_outage")!;
    return { ...server, outageRuleId: outage.id };
  };
  const count = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  const fire = (ruleId: string, subject = "circuit:1", deliver = true) =>
    writeEvaluation(pool, {
      nowMs: NOW,
      deliver,
      writes: [],
      events: [{ ruleId, kind: "power_outage", severity: "critical", subject, transition: "fired", summary: { circuit: 1 } }],
    });
  const outboxOf = async (serverId: string) =>
    (await admin.query("SELECT o.id::text AS id, o.status, o.attempts FROM alerts.outbox o JOIN alerts.alert_events e ON e.id = o.event_id WHERE e.server_id = $1 ORDER BY o.id", [serverId])).rows as {
      id: string;
      status: string;
      attempts: number;
    }[];

  describe("the encrypted destination", () => {
    it("stores the webhook sealed: the bytes hold neither the URL nor the token, and only the last 4 characters are readable", async () => {
      const server = await newServer();
      const saved = await saveDiscordDestination(pool, ring, server.publicId, URL_A);
      expect(saved).toMatchObject({ ok: true, last4: TOKEN.slice(-4) });
      const row = (await admin.query("SELECT webhook_enc, key_id, last4, enabled FROM alerts.destinations WHERE server_id = $1", [server.id])).rows[0];
      expect(Buffer.from(row.webhook_enc).includes(Buffer.from(TOKEN))).toBe(false);
      expect(Buffer.from(row.webhook_enc).includes(Buffer.from("discord.com"))).toBe(false);
      expect(row).toMatchObject({ key_id: "k1", last4: TOKEN.slice(-4), enabled: true });
      expect(await getDestinationSummary(pool, server.publicId)).toEqual({ id: expect.any(String), enabled: true, last4: TOKEN.slice(-4), disabledReason: null });
      expect((await openServerWebhook(pool, ring, server.publicId))?.url).toBe(URL_A);
    });

    it("refuses a URL that fails the allowlist (nothing stored) and an unknown server", async () => {
      const server = await newServer();
      expect(await saveDiscordDestination(pool, ring, server.publicId, "https://evil.example/api/webhooks/1/x")).toEqual({ ok: false, code: "host_not_allowed" });
      expect(await saveDiscordDestination(pool, ring, server.publicId, `http://discord.com/api/webhooks/${ID}/${TOKEN}`)).toEqual({ ok: false, code: "not_https" });
      expect(await getDestinationSummary(pool, server.publicId)).toBeUndefined();
      expect(await saveDiscordDestination(pool, ring, "no-such-server", URL_A)).toEqual({ ok: false, code: "server_not_found" });
    });

    it("saving again replaces the webhook and re-enables a disabled destination (one destination per server)", async () => {
      const server = await newServer();
      const first = await saveDiscordDestination(pool, ring, server.publicId, URL_A);
      await disableDestination(pool, (first as { destinationId: string }).destinationId, "webhook_gone");
      expect(await getDestinationSummary(pool, server.publicId)).toMatchObject({ enabled: false, disabledReason: "webhook_gone" });
      await saveDiscordDestination(pool, ring, server.publicId, URL_B);
      expect(await count("SELECT count(*) AS n FROM alerts.destinations WHERE server_id = $1", [server.id])).toBe(1);
      expect(await getDestinationSummary(pool, server.publicId)).toMatchObject({ enabled: true, disabledReason: null });
      expect((await openServerWebhook(pool, ring, server.publicId))?.url).toBe(URL_B);
    });

    it("a sealed value copied to another server's row does not open (it is bound to its server)", async () => {
      const a = await newServer();
      const b = await newServer();
      await saveDiscordDestination(pool, ring, a.publicId, URL_A);
      await saveDiscordDestination(pool, ring, b.publicId, URL_B);
      await admin.query(
        "UPDATE alerts.destinations SET webhook_enc = (SELECT webhook_enc FROM alerts.destinations WHERE server_id = $1) WHERE server_id = $2",
        [a.id, b.id],
      );
      expect(await openServerWebhook(pool, ring, b.publicId)).toBeUndefined(); // the copied ciphertext fails to open
      expect((await openServerWebhook(pool, ring, a.publicId))?.url).toBe(URL_A);
    });

    it("the table refuses a disabled destination without a reason, and a webhook that is too short to be sealed", async () => {
      const server = await newServer();
      await expect(
        admin.query("INSERT INTO alerts.destinations (server_id, kind, webhook_enc, key_id, last4, enabled) VALUES ($1, 'discord', $2, 'k1', 'abcd', false)", [server.id, Buffer.alloc(40)]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        admin.query("INSERT INTO alerts.destinations (server_id, kind, webhook_enc, key_id, last4) VALUES ($1, 'discord', $2, 'k1', 'abcd')", [server.id, Buffer.alloc(3)]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("the transactional outbox", () => {
    it("queues a row for each new event and each ENABLED destination, in the same transaction as the event", async () => {
      const server = await newServer();
      await saveDiscordDestination(pool, ring, server.publicId, URL_A);
      await fire(server.outageRuleId);
      const rows = await outboxOf(server.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "pending", attempts: 0 });
      expect(await count("SELECT count(*) AS n FROM alerts.alert_events WHERE server_id = $1", [server.id])).toBe(1);
    });

    it("queues NOTHING while delivery is off (deliver false), and nothing for a server without a destination", async () => {
      const server = await newServer();
      await saveDiscordDestination(pool, ring, server.publicId, URL_A);
      await fire(server.outageRuleId, "circuit:1", false);
      expect(await outboxOf(server.id)).toEqual([]);
      const bare = await newServer();
      await fire(bare.outageRuleId);
      expect(await outboxOf(bare.id)).toEqual([]);
      expect(await count("SELECT count(*) AS n FROM alerts.alert_events WHERE server_id = $1", [bare.id])).toBe(1); // still logged
    });

    it("queues nothing for a disabled destination", async () => {
      const server = await newServer();
      const saved = await saveDiscordDestination(pool, ring, server.publicId, URL_A);
      await disableDestination(pool, (saved as { destinationId: string }).destinationId, "manual");
      await fire(server.outageRuleId);
      expect(await outboxOf(server.id)).toEqual([]);
    });

    it("a failing write leaves nothing behind: no event, no state and no outbox row (one transaction)", async () => {
      const server = await newServer();
      await saveDiscordDestination(pool, ring, server.publicId, URL_A);
      // A bad transition violates the events CHECK. (The worker test proves the same atomicity for a failing outbox insert.)
      await expect(
        writeEvaluation(pool, {
          nowMs: NOW,
          deliver: true,
          writes: [],
          events: [{ ruleId: server.outageRuleId, kind: "power_outage", severity: "critical", subject: "circuit:9", transition: "bogus" as never, summary: {} }],
        }),
      ).rejects.toMatchObject({ code: "23514" });
      expect(await outboxOf(server.id)).toEqual([]);
      expect(await count("SELECT count(*) AS n FROM alerts.alert_events WHERE server_id = $1", [server.id])).toBe(0);
    });

    it("(event, destination) is unique: the same pair can never be queued twice", async () => {
      const server = await newServer();
      await saveDiscordDestination(pool, ring, server.publicId, URL_A);
      await fire(server.outageRuleId);
      const pair = (await admin.query("SELECT event_id, destination_id FROM alerts.outbox o JOIN alerts.alert_events e ON e.id = o.event_id WHERE e.server_id = $1", [server.id])).rows[0];
      await expect(admin.query("INSERT INTO alerts.outbox (event_id, destination_id) VALUES ($1, $2)", [pair.event_id, pair.destination_id])).rejects.toMatchObject({ code: "23505" });
    });
  });

  describe("claiming and finishing deliveries", () => {
    const queue = async (n: number) => {
      // Lease everything left over from earlier tests for an hour, so each test claims only its own rows.
      await claimDueDeliveries(pool, 100_000, 3600);
      const server = await newServer();
      await saveDiscordDestination(pool, ring, server.publicId, URL_A);
      for (let i = 0; i < n; i++) await fire(server.outageRuleId, `circuit:${i + 1}`);
      return server;
    };

    it("claims due rows of enabled destinations, counts the attempt, leases them, and returns everything the sender needs", async () => {
      const server = await queue(3);
      const claimed = await claimDueDeliveries(pool, 10, 120);
      const mine = claimed.filter((c) => c.serverPublicId === server.publicId);
      expect(mine).toHaveLength(3);
      expect(mine[0]).toMatchObject({ attempts: 1, serverName: "Delivery", serverId: server.id, keyId: "k1" });
      expect(mine[0]!.event).toMatchObject({ kind: "power_outage", severity: "critical", transition: "fired", summary: { circuit: 1 } });
      expect(mine[0]!.webhookEnc).toBeInstanceOf(Buffer);
      // Leased: a second claim right away does not return them.
      expect((await claimDueDeliveries(pool, 10, 120)).filter((c) => c.serverPublicId === server.publicId)).toEqual([]);
    });

    it("two senders claiming at once never take the same row (FOR UPDATE SKIP LOCKED)", async () => {
      const server = await queue(20);
      const [a, b] = await Promise.all([claimDueDeliveries(pool, 10, 120), claimDueDeliveries(pool, 10, 120)]);
      const ids = [...a, ...b].filter((c) => c.serverPublicId === server.publicId).map((c) => c.outboxId);
      expect(new Set(ids).size).toBe(ids.length); // no duplicates
      expect(ids.length).toBeGreaterThan(0);
      // Everything queued is claimed by exactly one of them, or by the next call.
      const rest = (await claimDueDeliveries(pool, 50, 120)).filter((c) => c.serverPublicId === server.publicId).map((c) => c.outboxId);
      expect(new Set([...ids, ...rest]).size).toBe(20);
      expect(rest.filter((id) => ids.includes(id))).toEqual([]);
    });

    it("an expired lease makes the row due again (a crashed sender's delivery is retried: at-least-once)", async () => {
      const server = await queue(1);
      const first = (await claimDueDeliveries(pool, 10, 1)).filter((c) => c.serverPublicId === server.publicId);
      expect(first).toHaveLength(1);
      await admin.query("UPDATE alerts.outbox SET next_attempt_at = now() - interval '1 second' WHERE id = $1::bigint", [first[0]!.outboxId]);
      const again = (await claimDueDeliveries(pool, 10, 120)).filter((c) => c.serverPublicId === server.publicId);
      expect(again).toHaveLength(1);
      expect(again[0]!.attempts).toBe(2);
    });

    it("sent, dead and rescheduled rows: only pending rows change, and only due rows are claimed", async () => {
      const server = await queue(3);
      const claimed = (await claimDueDeliveries(pool, 10, 120)).filter((c) => c.serverPublicId === server.publicId);
      const [one, two, three] = claimed;
      await markDeliverySent(pool, one!.outboxId);
      await markDeliveryDead(pool, two!.outboxId, "bad_request");
      await rescheduleDelivery(pool, three!.outboxId, Date.now() + 3_600_000, "rate_limited");
      const rows = await admin.query("SELECT id::text AS id, status, last_error, sent_at IS NOT NULL AS sent FROM alerts.outbox WHERE id = ANY($1::bigint[]) ORDER BY id", [claimed.map((c) => c.outboxId)]);
      expect(rows.rows.map((r) => [r.status, r.last_error, r.sent])).toEqual([["sent", null, true], ["dead", "bad_request", false], ["pending", "rate_limited", false]]);
      // Finishing an already finished row is a no-op.
      await markDeliveryDead(pool, one!.outboxId, "late");
      expect((await admin.query("SELECT status FROM alerts.outbox WHERE id = $1::bigint", [one!.outboxId])).rows[0].status).toBe("sent");
      // None of the three is due now (sent, dead, and one rescheduled an hour out).
      expect((await claimDueDeliveries(pool, 10, 120)).filter((c) => c.serverPublicId === server.publicId)).toEqual([]);
    });

    it("never claims a row of a disabled destination", async () => {
      const server = await queue(2);
      const summary = await getDestinationSummary(pool, server.publicId);
      await admin.query("UPDATE alerts.destinations SET enabled = false, disabled_reason = 'manual' WHERE id = $1::uuid", [summary!.id]);
      expect((await claimDueDeliveries(pool, 10, 120)).filter((c) => c.serverPublicId === server.publicId)).toEqual([]);
    });

    it("disabling a destination gives up on its pending rows (dead), leaves sent ones and other servers alone", async () => {
      const a = await queue(2);
      const b = await queue(1);
      const claimed = (await claimDueDeliveries(pool, 10, 120)).filter((c) => c.serverPublicId === a.publicId);
      await markDeliverySent(pool, claimed[0]!.outboxId);
      await disableDestination(pool, claimed[0]!.destinationId, "webhook_gone");
      expect((await outboxOf(a.id)).map((r) => r.status).sort()).toEqual(["dead", "sent"]);
      expect((await outboxOf(b.id)).map((r) => r.status)).toEqual(["pending"]);
      expect(await getDestinationSummary(pool, a.publicId)).toMatchObject({ enabled: false, disabledReason: "webhook_gone" });
    });
  });

  describe("retention and removal", () => {
    it("purging old alert events cascades to their outbox rows", async () => {
      const server = await newServer();
      await saveDiscordDestination(pool, ring, server.publicId, URL_A);
      await fire(server.outageRuleId);
      await admin.query("UPDATE alerts.alert_events SET at = $2 WHERE server_id = $1", [server.id, new Date(Date.now() - ALERT_EVENT_RETENTION_MS - 86_400_000)]);
      expect(await purgeExpiredEvents(pool, Date.now())).toBeGreaterThanOrEqual(1);
      expect(await outboxOf(server.id)).toEqual([]);
    });

    it("a soft delete removes the destination (the encrypted webhook) and its outbox, so a revived id starts clean", async () => {
      const server = await newServer();
      await saveDiscordDestination(pool, ring, server.publicId, URL_A);
      await fire(server.outageRuleId);
      expect(await softDeleteServer(pool, server.publicId)).toBe(true);
      expect(await count("SELECT count(*) AS n FROM alerts.destinations WHERE server_id = $1", [server.id])).toBe(0);
      expect(await outboxOf(server.id)).toEqual([]);
    });
  });
});
