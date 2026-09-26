import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { ApiFailure, BadRequestError, RateLimitedError } from "../../../platform/errorResponse.js";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { softDeleteServer, upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { seedPresetRules } from "../repositories/alertRepository.js";
import { MAX_RULES_PER_SERVER, createAlertsService } from "./alertsService.js";
import type { AlertsService } from "./alertsService.js";

const available = dbTestsAvailable();

const ID = "1234567890123456789";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const URL_A = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;
const URL_B = `https://discordapp.com/api/webhooks/9876543210987654321/${"Zy9876543210_-".repeat(5)}`;
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
const ACTOR = randomUUID();

const production = (item: string, targetPerMinute = 100) =>
  ({ kind: "production_below_target", params: { item, targetPerMinute, windowMinutes: 10 }, severity: "warning", enabled: true, forSeconds: 600, clearSeconds: 300, repeatSeconds: 3600 }) as const;

/** The failure a call rejects with, or undefined if it resolved. */
async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return undefined;
  } catch (err) {
    return err;
  }
}
const codeOf = (err: unknown): string | undefined => (err instanceof ApiFailure ? err.code : err instanceof BadRequestError ? "bad_request" : undefined);

// ADR-0027 PR 7b against a real Postgres: the alerts API's SQL and transactions (the migration is applied by
// createTestDatabase; the service runs as satis_app, fixtures the app never writes go in as the admin).
describe.skipIf(!available)("the alerts API service against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let counter = 0;
  let service: AlertsService;
  let nowMs = Date.now();
  const sent: string[] = [];

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 8 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    service = createAlertsService({
      db: pool,
      ring,
      mode: "on",
      serverName: () => "Alpha",
      now: () => nowMs,
      testLimiter: new UserRateLimiter({ max: 1000, windowMs: 60_000 }),
      fetch: (async (url: unknown) => {
        sent.push(String(url));
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const newServer = async () => {
    const server = await upsertConfiguredServer(pool, { publicId: `api-${++counter}`, displayName: "Alerts API" });
    await seedPresetRules(pool, server.publicId);
    return server;
  };
  const rulesOf = async (publicId: string) => (await service.listRules(publicId)).rules;
  const auditActions = async (serverUuid: string) =>
    (await admin.query("SELECT action, detail::text AS detail FROM audit.audit_events WHERE server_id = $1 ORDER BY id", [serverUuid])).rows as { action: string; detail: string }[];

  describe("rules", () => {
    it("creates a production rule with the defaults, lists it after the presets, and audits it (ids and codes only)", async () => {
      const server = await newServer();
      const { rule } = await service.createRule(server.publicId, ACTOR, production("Desc_IronPlate_C", 120));
      expect(rule).toMatchObject({
        kind: "production_below_target",
        params: { item: "Desc_IronPlate_C", targetPerMinute: 120, windowMinutes: 10 },
        forSeconds: 600,
        clearSeconds: 300,
        repeatSeconds: 3600,
        severity: "warning",
        enabled: true,
        preset: false,
      });
      const rules = await rulesOf(server.publicId);
      expect(rules.map((r) => r.kind)).toEqual(["power_outage", "stopped_machines", "server_unreachable", "production_below_target"]);
      expect(rules.slice(0, 3).every((r) => r.preset)).toBe(true);
      const audit = await auditActions(server.id);
      expect(audit.map((a) => a.action)).toEqual(["alerts.rule.created"]);
      expect(JSON.parse(audit[0]!.detail)).toEqual({ ruleId: rule.id, kind: "production_below_target", item: "Desc_IronPlate_C" });
    });

    it("refuses a second rule for the same item on a server, but allows it on another server and for another item", async () => {
      const a = await newServer();
      const b = await newServer();
      await service.createRule(a.publicId, ACTOR, production("Desc_IronPlate_C"));
      expect(codeOf(await failureOf(service.createRule(a.publicId, ACTOR, production("Desc_IronPlate_C", 5))))).toBe("bad_request");
      await service.createRule(a.publicId, ACTOR, production("Desc_CopperIngot_C"));
      await service.createRule(b.publicId, ACTOR, production("Desc_IronPlate_C"));
      expect((await rulesOf(a.publicId)).filter((r) => !r.preset)).toHaveLength(2);
    });

    it("two creates for the same item at once: exactly one wins (the server row is locked)", async () => {
      const server = await newServer();
      const results = await Promise.allSettled([1, 2, 3, 4].map((n) => service.createRule(server.publicId, ACTOR, production("Desc_Wire_C", n))));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await rulesOf(server.publicId)).filter((r) => !r.preset)).toHaveLength(1);
    });

    it(`stops at ${MAX_RULES_PER_SERVER} rules per server (presets included)`, async () => {
      const server = await newServer();
      await admin.query(
        `INSERT INTO alerts.rules (server_id, kind, params, for_seconds, clear_seconds, repeat_seconds, severity)
         SELECT $1::uuid, 'production_below_target', jsonb_build_object('item', 'Filler_' || g, 'targetPerMinute', 1, 'windowMinutes', 10), 600, 300, 3600, 'warning'
         FROM generate_series(1, $2::int) g`,
        [server.id, MAX_RULES_PER_SERVER - 3 - 1],
      );
      expect(await rulesOf(server.publicId)).toHaveLength(MAX_RULES_PER_SERVER - 1);
      await service.createRule(server.publicId, ACTOR, production("Desc_Last_C")); // the 50th
      expect(codeOf(await failureOf(service.createRule(server.publicId, ACTOR, production("Desc_TooMany_C"))))).toBe("bad_request");
      expect(await rulesOf(server.publicId)).toHaveLength(MAX_RULES_PER_SERVER);
    });

    it("a PATCH changes the target and the window, keeps the persisted state, and audits the fields (not the values)", async () => {
      const server = await newServer();
      const { rule } = await service.createRule(server.publicId, ACTOR, production("Desc_IronPlate_C", 100));
      await admin.query("INSERT INTO alerts.alert_state (rule_id, subject, phase, since, last_condition) VALUES ($1, 'item', 'firing', now(), true)", [rule.id]);
      const { rule: updated } = await service.updateRule(server.publicId, ACTOR, rule.id, { params: { targetPerMinute: 80, windowMinutes: 20 }, severity: "critical", enabled: false });
      expect(updated).toMatchObject({ params: { item: "Desc_IronPlate_C", targetPerMinute: 80, windowMinutes: 20 }, severity: "critical", enabled: false });
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(rule.updatedAt).getTime());
      expect(Number((await admin.query("SELECT count(*) AS n FROM alerts.alert_state WHERE rule_id = $1 AND phase = 'firing'", [rule.id])).rows[0].n)).toBe(1);
      const audit = (await auditActions(server.id)).filter((a) => a.action === "alerts.rule.updated");
      expect(JSON.parse(audit[0]!.detail)).toEqual({ ruleId: rule.id, kind: "production_below_target", changed: ["params", "enabled", "severity"] });
    });

    it("`item` in a PATCH is rule_item_immutable, changes nothing, and an update with no valid change is a bad_request", async () => {
      const server = await newServer();
      const { rule } = await service.createRule(server.publicId, ACTOR, production("Desc_IronPlate_C"));
      expect(codeOf(await failureOf(service.updateRule(server.publicId, ACTOR, rule.id, { params: { item: "Desc_Other_C", targetPerMinute: 5 } })))).toBe("rule_item_immutable");
      expect(codeOf(await failureOf(service.updateRule(server.publicId, ACTOR, rule.id, { params: { windowMinutes: 61 } })))).toBe("bad_request");
      expect(codeOf(await failureOf(service.updateRule(server.publicId, ACTOR, rule.id, { params: { windowMinutes: 10.5 } })))).toBe("bad_request");
      expect(codeOf(await failureOf(service.updateRule(server.publicId, ACTOR, rule.id, { params: { targetPerMinute: -1 } })))).toBe("bad_request");
      expect(codeOf(await failureOf(service.updateRule(server.publicId, ACTOR, rule.id, { params: {} })))).toBe("bad_request");
      expect((await rulesOf(server.publicId)).find((r) => r.id === rule.id)?.params).toEqual({ item: "Desc_IronPlate_C", targetPerMinute: 100, windowMinutes: 10 });
    });

    it("presets can be disabled and tuned, never deleted; a rule with no parameters takes none", async () => {
      const server = await newServer();
      const [outage, stopped, unreachable] = await rulesOf(server.publicId);
      const disabled = await service.updateRule(server.publicId, ACTOR, outage!.id, { enabled: false });
      expect(disabled.rule).toMatchObject({ enabled: false, preset: true });
      expect((await service.updateRule(server.publicId, ACTOR, stopped!.id, { params: { stoppedBelowPercent: 10 } })).rule.params).toEqual({ stoppedBelowPercent: 10 });
      expect((await service.updateRule(server.publicId, ACTOR, unreachable!.id, { params: { failedPolls: 5 } })).rule.params).toEqual({ failedPolls: 5, minSeconds: 120 });
      expect(codeOf(await failureOf(service.updateRule(server.publicId, ACTOR, outage!.id, { params: { anything: 1 } })))).toBe("bad_request");
      expect(codeOf(await failureOf(service.updateRule(server.publicId, ACTOR, stopped!.id, { params: { stoppedBelowPercent: 101 } })))).toBe("bad_request");
      for (const preset of [outage!, stopped!, unreachable!]) {
        expect(codeOf(await failureOf(service.deleteRule(server.publicId, ACTOR, preset.id)))).toBe("preset_disable_only");
      }
      expect(await rulesOf(server.publicId)).toHaveLength(3);
    });

    it("deletes a non-preset rule (its states go with it) and audits it", async () => {
      const server = await newServer();
      const { rule } = await service.createRule(server.publicId, ACTOR, production("Desc_IronPlate_C"));
      await admin.query("INSERT INTO alerts.alert_state (rule_id, subject, phase, last_condition) VALUES ($1, 'item', 'pending', true)", [rule.id]);
      expect(await service.deleteRule(server.publicId, ACTOR, rule.id)).toEqual({ deleted: true });
      expect((await rulesOf(server.publicId)).some((r) => r.id === rule.id)).toBe(false);
      expect(Number((await admin.query("SELECT count(*) AS n FROM alerts.alert_state WHERE rule_id = $1", [rule.id])).rows[0].n)).toBe(0);
      expect((await auditActions(server.id)).map((a) => a.action)).toEqual(["alerts.rule.created", "alerts.rule.deleted"]);
      expect(codeOf(await failureOf(service.deleteRule(server.publicId, ACTOR, rule.id)))).toBe("rule_not_found");
    });

    it("IDOR: a rule id from ANOTHER server is not found on this one, for update and delete, and stays untouched", async () => {
      const a = await newServer();
      const b = await newServer();
      const { rule } = await service.createRule(a.publicId, ACTOR, production("Desc_IronPlate_C"));
      expect(codeOf(await failureOf(service.updateRule(b.publicId, ACTOR, rule.id, { enabled: false })))).toBe("rule_not_found");
      expect(codeOf(await failureOf(service.deleteRule(b.publicId, ACTOR, rule.id)))).toBe("rule_not_found");
      expect((await rulesOf(a.publicId)).find((r) => r.id === rule.id)).toMatchObject({ enabled: true });
      expect((await rulesOf(b.publicId)).some((r) => r.id === rule.id)).toBe(false);
      // A preset of another server, and a malformed id, are the same not-found.
      const presetOfA = (await rulesOf(a.publicId))[0]!;
      expect(codeOf(await failureOf(service.updateRule(b.publicId, ACTOR, presetOfA.id, { enabled: false })))).toBe("rule_not_found");
      expect(codeOf(await failureOf(service.updateRule(a.publicId, ACTOR, "not-a-uuid", { enabled: false })))).toBe("rule_not_found");
      expect(codeOf(await failureOf(service.deleteRule(a.publicId, ACTOR, "'; DROP TABLE alerts.rules; --")))).toBe("rule_not_found");
    });

    it("a deleted server has no rules to read or change", async () => {
      const server = await newServer();
      await softDeleteServer(pool, server.publicId);
      expect(await rulesOf(server.publicId)).toEqual([]);
      const failure = await failureOf(service.createRule(server.publicId, ACTOR, production("Desc_IronPlate_C")));
      expect((failure as Error).name).toBe("ServerNotFoundError");
    });
  });

  describe("the Discord destination", () => {
    it("PUT stores it encrypted, answers with the last 4 only, replaces it on a second PUT and re-enables it", async () => {
      const server = await newServer();
      const saved = await service.putDiscord(server.publicId, ACTOR, URL_A);
      expect(saved.discord).toMatchObject({ last4: TOKEN.slice(-4), enabled: true, disabledReason: null });
      expect(JSON.stringify(saved)).not.toContain(TOKEN);
      const stored = (await admin.query("SELECT webhook_enc FROM alerts.destinations WHERE server_id = $1", [server.id])).rows[0].webhook_enc as Buffer;
      expect(stored.toString("latin1")).not.toContain(TOKEN);
      await service.patchDiscord(server.publicId, ACTOR, false);
      const replaced = await service.putDiscord(server.publicId, ACTOR, URL_B);
      expect(replaced.discord).toMatchObject({ last4: URL_B.slice(-4), enabled: true, disabledReason: null });
      expect((await service.getDestinations(server.publicId)).discord?.last4).toBe(URL_B.slice(-4));
    });

    it("a refused URL is webhook_invalid with the parser's reason, stores nothing, and the URL is in no audit event", async () => {
      const server = await newServer();
      const failure = (await failureOf(service.putDiscord(server.publicId, ACTOR, `https://evil.example/api/webhooks/${ID}/${TOKEN}`))) as ApiFailure;
      expect([failure.code, failure.reason]).toEqual(["webhook_invalid", "host_not_allowed"]);
      expect(failure.message).not.toContain(TOKEN);
      expect((await service.getDestinations(server.publicId)).discord).toBeNull();
      await service.putDiscord(server.publicId, ACTOR, URL_A);
      for (const event of await auditActions(server.id)) {
        expect(event.detail).not.toContain(TOKEN);
        expect(event.detail).not.toContain("discord.com");
        expect(event.detail).not.toContain(TOKEN.slice(-4));
      }
    });

    it("GET is null with none; PATCH, DELETE and test with none are destination_not_configured", async () => {
      const server = await newServer();
      expect((await service.getDestinations(server.publicId)).discord).toBeNull();
      expect(codeOf(await failureOf(service.patchDiscord(server.publicId, ACTOR, true)))).toBe("destination_not_configured");
      expect(codeOf(await failureOf(service.removeDiscord(server.publicId, ACTOR)))).toBe("destination_not_configured");
      expect(codeOf(await failureOf(service.testDiscord(server.publicId, ACTOR)))).toBe("destination_not_configured");
    });

    it("PATCH enabled:false disables it ('manual') and gives up its pending deliveries; enabled:true clears the reason", async () => {
      const server = await newServer();
      await service.putDiscord(server.publicId, ACTOR, URL_A);
      const dest = (await admin.query("SELECT id FROM alerts.destinations WHERE server_id = $1", [server.id])).rows[0].id as string;
      const rule = (await admin.query("SELECT id FROM alerts.rules WHERE server_id = $1 AND kind = 'power_outage'", [server.id])).rows[0].id as string;
      const event = (await admin.query(
        "INSERT INTO alerts.alert_events (server_id, rule_id, kind, severity, subject, transition, summary) VALUES ($1, $2, 'power_outage', 'critical', 'circuit:1', 'fired', '{}') RETURNING id",
        [server.id, rule],
      )).rows[0].id;
      await admin.query("INSERT INTO alerts.outbox (event_id, destination_id) VALUES ($1, $2)", [event, dest]);
      const off = await service.patchDiscord(server.publicId, ACTOR, false);
      expect(off.discord).toMatchObject({ enabled: false, disabledReason: "manual" });
      expect((await admin.query("SELECT status FROM alerts.outbox WHERE destination_id = $1", [dest])).rows[0].status).toBe("dead");
      const on = await service.patchDiscord(server.publicId, ACTOR, true);
      expect(on.discord).toMatchObject({ enabled: true, disabledReason: null });
    });

    it("DELETE removes it and audits it; another server's destination is untouched", async () => {
      const a = await newServer();
      const b = await newServer();
      await service.putDiscord(a.publicId, ACTOR, URL_A);
      await service.putDiscord(b.publicId, ACTOR, URL_B);
      expect(await service.removeDiscord(a.publicId, ACTOR)).toEqual({ deleted: true });
      expect((await service.getDestinations(a.publicId)).discord).toBeNull();
      expect((await service.getDestinations(b.publicId)).discord).not.toBeNull();
      expect((await auditActions(a.id)).map((e) => e.action)).toEqual(["alerts.destination.set", "alerts.destination.removed"]);
    });

    it("test sends one message through the sender (the URL only ever goes to Discord) and audits the result code", async () => {
      const server = await newServer();
      await service.putDiscord(server.publicId, ACTOR, URL_A);
      sent.length = 0;
      expect(await service.testDiscord(server.publicId, ACTOR)).toEqual({ ok: true });
      expect(sent).toEqual([URL_A]);
      const tested = (await auditActions(server.id)).filter((e) => e.action === "alerts.destination.tested");
      expect(JSON.parse(tested[0]!.detail)).toEqual({ kind: "discord", code: "sent" });
    });

    it("test with the kill switch OFF is delivery_off and sends nothing", async () => {
      const off = createAlertsService({ db: pool, ring, mode: "off", serverName: () => "Alpha", fetch: (async () => Promise.reject(new Error("must not send"))) as typeof fetch });
      const server = await newServer();
      await service.putDiscord(server.publicId, ACTOR, URL_A);
      expect(codeOf(await failureOf(off.testDiscord(server.publicId, ACTOR)))).toBe("delivery_off");
    });

    it("test is rate-limited per user", async () => {
      const limited = createAlertsService({
        db: pool,
        ring,
        mode: "on",
        serverName: () => "Alpha",
        testLimiter: new UserRateLimiter({ max: 2, windowMs: 60_000 }),
        fetch: (async () => new Response(null, { status: 204 })) as typeof fetch,
      });
      const server = await newServer();
      await service.putDiscord(server.publicId, ACTOR, URL_A);
      await limited.testDiscord(server.publicId, "user-a");
      await limited.testDiscord(server.publicId, "user-a");
      expect(await failureOf(limited.testDiscord(server.publicId, "user-a"))).toBeInstanceOf(RateLimitedError);
      await limited.testDiscord(server.publicId, "user-b"); // another user has their own allowance
    });
  });

  describe("the alert log, status and mute", () => {
    const addEvent = async (serverUuid: string, ruleId: string | null, transition: string, subject = "circuit:1") =>
      String(
        (await admin.query(
          "INSERT INTO alerts.alert_events (server_id, rule_id, kind, severity, subject, transition, summary) VALUES ($1, $2, 'power_outage', 'critical', $3, $4, $5::jsonb) RETURNING id::text AS id",
          [serverUuid, ruleId, subject, transition, JSON.stringify({ circuit: 1 })],
        )).rows[0].id,
      );

    it("pages newest first with a cursor, and never shows another server's events", async () => {
      const a = await newServer();
      const b = await newServer();
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push(await addEvent(a.id, null, i % 2 === 0 ? "fired" : "resolved"));
      await addEvent(b.id, null, "fired");
      const first = await service.listEvents(a.publicId, { limit: 2 });
      expect(first.events.map((e) => e.id)).toEqual([ids[4], ids[3]]);
      expect(first.nextBefore).toBe(ids[3]);
      const second = await service.listEvents(a.publicId, { limit: 2, before: first.nextBefore! });
      expect(second.events.map((e) => e.id)).toEqual([ids[2], ids[1]]);
      const last = await service.listEvents(a.publicId, { limit: 2, before: second.nextBefore! });
      expect(last.events.map((e) => e.id)).toEqual([ids[0]]);
      expect(last.nextBefore).toBeNull();
      expect((await service.listEvents(a.publicId, { limit: 100 })).events).toHaveLength(5);
      expect(first.events[0]).toMatchObject({ ruleId: null, kind: "power_outage", severity: "critical", subject: "circuit:1", summary: { circuit: 1 } });
      expect(typeof first.events[0]!.at).toBe("string");
      // A cursor far beyond any id is simply the whole log; the largest cursor the schema allows fits a bigint.
      expect((await service.listEvents(a.publicId, { limit: 100, before: "999999999999999999" })).events).toHaveLength(5);
    });

    it("status: firing states of enabled rules only, the mute, and the delivery switch", async () => {
      const server = await newServer();
      const [outage, stopped] = await rulesOf(server.publicId);
      await admin.query("INSERT INTO alerts.alert_state (rule_id, subject, phase, since, last_condition) VALUES ($1, 'circuit:3', 'firing', now() - interval '5 minutes', true)", [outage!.id]);
      await admin.query("INSERT INTO alerts.alert_state (rule_id, subject, phase, since, last_condition) VALUES ($1, 'group', 'pending', now(), true)", [stopped!.id]);
      const status = await service.getStatus(server.publicId);
      expect(status).toMatchObject({ deliveryEnabled: true, mutedUntil: null });
      expect(status.firing).toEqual([{ ruleId: outage!.id, kind: "power_outage", subject: "circuit:3", severity: "critical", since: expect.any(String) }]);
      await service.updateRule(server.publicId, ACTOR, outage!.id, { enabled: false });
      expect((await service.getStatus(server.publicId)).firing).toEqual([]);
    });

    it("mute: a time in the future within 7 days is stored and shown; the past, the far future and nonsense are mute_invalid", async () => {
      const server = await newServer();
      nowMs = Date.now();
      const until = new Date(nowMs + 3_600_000).toISOString();
      expect(await service.setMute(server.publicId, ACTOR, until)).toEqual({ mutedUntil: until });
      expect((await service.getStatus(server.publicId)).mutedUntil).toBe(until);
      for (const bad of [new Date(nowMs - 1000).toISOString(), new Date(nowMs).toISOString(), new Date(nowMs + 7 * 86_400_000 + 1000).toISOString(), "tomorrow", ""]) {
        expect(codeOf(await failureOf(service.setMute(server.publicId, ACTOR, bad))), bad).toBe("mute_invalid");
      }
      expect((await service.getStatus(server.publicId)).mutedUntil).toBe(until); // unchanged
      expect(await service.clearMute(server.publicId, ACTOR)).toEqual({ mutedUntil: null });
      expect((await service.getStatus(server.publicId)).mutedUntil).toBeNull();
      expect((await auditActions(server.id)).map((e) => e.action)).toEqual(["alerts.muted", "alerts.unmuted"]);
    });

    it("a mute that has passed is no mute, and another server's mute is not shown", async () => {
      const a = await newServer();
      const b = await newServer();
      await admin.query("INSERT INTO alerts.server_mutes (server_id, muted_until) VALUES ($1, now() - interval '1 minute')", [a.id]);
      await service.setMute(b.publicId, ACTOR, new Date(Date.now() + 3_600_000).toISOString());
      expect((await service.getStatus(a.publicId)).mutedUntil).toBeNull();
      expect((await service.getStatus(b.publicId)).mutedUntil).not.toBeNull();
    });
  });
});
