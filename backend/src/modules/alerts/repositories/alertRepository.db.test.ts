import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { softDeleteServer, upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { PRESET_RULES } from "../services/rules.js";
import { stateKey } from "../services/serverAlertEvaluator.js";
import {
  ALERT_EVENT_RETENTION_MS,
  listRules,
  loadMutes,
  loadStates,
  purgeExpiredEvents,
  seedPresetRules,
  writeEvaluation,
} from "./alertRepository.js";

const available = dbTestsAvailable();

// ADR-0027 decisions 4 and 5 against a real Postgres (the migration is applied by createTestDatabase; the repository
// runs as satis_app, fixtures that the app never writes go in as the admin).
describe.skipIf(!available)("alert repository against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let counter = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const newServer = async () => upsertConfiguredServer(pool, { publicId: `al-${++counter}`, displayName: "Alerts" });
  const rulesOf = async (publicId: string) => (await listRules(pool)).filter((rule) => rule.server_public_id === publicId);
  const count = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
  const firing = { phase: "firing" as const, since: NOW - 300_000, clearSince: null, lastNotifiedAt: NOW, lastCondition: true };

  it("seeds the preset rules for a server, idempotently, and leaves other servers and unknown ids alone", async () => {
    const server = await newServer();
    const other = await newServer();
    await seedPresetRules(pool, server.publicId);
    await seedPresetRules(pool, server.publicId); // again: nothing changes
    const rules = await rulesOf(server.publicId);
    expect(rules.map((rule) => rule.kind).sort()).toEqual(PRESET_RULES.map((preset) => preset.kind).sort());
    expect(rules).toHaveLength(PRESET_RULES.length);
    const stopped = rules.find((rule) => rule.kind === "stopped_machines")!;
    expect(stopped).toMatchObject({ for_seconds: 300, clear_seconds: 120, repeat_seconds: 3600, severity: "warning", params: { stoppedBelowPercent: 5 } });
    expect(await rulesOf(other.publicId)).toEqual([]);
    await seedPresetRules(pool, "no-such-server");
    expect(await count("SELECT count(*) AS n FROM alerts.rules WHERE preset")).toBeGreaterThanOrEqual(PRESET_RULES.length);
    // fuse_trip is not a preset (it would duplicate power_outage).
    expect(rules.some((rule) => rule.kind === "fuse_trip")).toBe(false);
  });

  it("stores production_below_target rules (one per item, never a preset) and still refuses an unknown kind", async () => {
    const server = await newServer();
    const insert = (kind: string, params: object) =>
      admin.query(
        "INSERT INTO alerts.rules (server_id, kind, params, for_seconds, clear_seconds, repeat_seconds, severity) VALUES ($1, $2, $3, 600, 300, 3600, 'warning')",
        [server.id, kind, JSON.stringify(params)],
      );
    await insert("production_below_target", { item: "Desc_IronPlate_C", targetPerMinute: 100, windowMinutes: 10 });
    await insert("production_below_target", { item: "Desc_CopperIngot_C", targetPerMinute: 50, windowMinutes: 10 }); // a second item is allowed
    const rules = (await rulesOf(server.publicId)).filter((rule) => rule.kind === "production_below_target");
    expect(rules.map((rule) => (rule.params as { item: string }).item).sort()).toEqual(["Desc_CopperIngot_C", "Desc_IronPlate_C"]);
    expect(await count("SELECT count(*) AS n FROM alerts.rules WHERE server_id = $1 AND preset", [server.id])).toBe(0);
    await expect(insert("production_above_target", {})).rejects.toMatchObject({ code: "23514" });
  });

  it("does not list a disabled rule, or the rules of a removed server", async () => {
    const server = await newServer();
    await seedPresetRules(pool, server.publicId);
    await admin.query("UPDATE alerts.rules SET enabled = false WHERE server_id = $1 AND kind = 'power_outage'", [server.id]);
    expect((await rulesOf(server.publicId)).map((rule) => rule.kind)).not.toContain("power_outage");
    await softDeleteServer(pool, server.publicId);
    expect(await rulesOf(server.publicId)).toEqual([]);
  });

  it("writes the changed states AND the events in one transaction, and reads the states back exactly", async () => {
    const server = await newServer();
    await seedPresetRules(pool, server.publicId);
    const outage = (await rulesOf(server.publicId)).find((rule) => rule.kind === "power_outage")!;
    await writeEvaluation(pool, {
      nowMs: NOW,
      writes: [
        { ruleId: outage.id, subject: "circuit:1", state: firing },
        { ruleId: outage.id, subject: "circuit:2", state: { phase: "pending", since: NOW - 1000, clearSince: null, lastNotifiedAt: null, lastCondition: true } },
      ],
      events: [{ ruleId: outage.id, kind: "power_outage", severity: "critical", subject: "circuit:1", transition: "fired", summary: { circuit: 1 } }],
    });
    const states = await loadStates(pool, server.publicId);
    expect(states.get(stateKey(outage.id, "circuit:1"))).toEqual(firing);
    expect(states.get(stateKey(outage.id, "circuit:2"))).toEqual({ phase: "pending", since: NOW - 1000, clearSince: null, lastNotifiedAt: null, lastCondition: true });
    const events = (await admin.query("SELECT kind, severity, subject, transition, summary, extract(epoch FROM at) * 1000 AS at_ms FROM alerts.alert_events WHERE server_id = $1", [server.id])).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "power_outage", severity: "critical", subject: "circuit:1", transition: "fired", summary: { circuit: 1 } });
    expect(Number(events[0].at_ms)).toBe(NOW);
  });

  it("upserts: a later write replaces the state of the same (rule, subject)", async () => {
    const server = await newServer();
    await seedPresetRules(pool, server.publicId);
    const outage = (await rulesOf(server.publicId)).find((rule) => rule.kind === "power_outage")!;
    await writeEvaluation(pool, { nowMs: NOW, events: [], writes: [{ ruleId: outage.id, subject: "circuit:1", state: firing }] });
    const clearing = { ...firing, clearSince: NOW + 30_000, lastCondition: false };
    await writeEvaluation(pool, { nowMs: NOW + 30_000, events: [], writes: [{ ruleId: outage.id, subject: "circuit:1", state: clearing }] });
    const states = await loadStates(pool, server.publicId);
    expect(states.size).toBe(1);
    expect(states.get(stateKey(outage.id, "circuit:1"))).toEqual(clearing);
  });

  it("is ATOMIC: an event that the database refuses rolls the state changes back too", async () => {
    const server = await newServer();
    await seedPresetRules(pool, server.publicId);
    const outage = (await rulesOf(server.publicId)).find((rule) => rule.kind === "power_outage")!;
    await expect(
      writeEvaluation(pool, {
        nowMs: NOW,
        writes: [{ ruleId: outage.id, subject: "circuit:1", state: firing }],
        // 'bogus' violates the transition CHECK.
        events: [{ ruleId: outage.id, kind: "power_outage", severity: "critical", subject: "circuit:1", transition: "bogus" as never, summary: {} }],
      }),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await loadStates(pool, server.publicId)).size).toBe(0); // the state was NOT stored
    expect(await count("SELECT count(*) AS n FROM alerts.alert_events WHERE server_id = $1", [server.id])).toBe(0);
  });

  it("a state or event for a rule that was deleted meanwhile is skipped, not an error", async () => {
    const server = await newServer();
    await seedPresetRules(pool, server.publicId);
    const outage = (await rulesOf(server.publicId)).find((rule) => rule.kind === "power_outage")!;
    await admin.query("DELETE FROM alerts.rules WHERE id = $1", [outage.id]);
    await writeEvaluation(pool, {
      nowMs: NOW,
      writes: [{ ruleId: outage.id, subject: "circuit:1", state: firing }],
      events: [{ ruleId: outage.id, kind: "power_outage", severity: "critical", subject: "circuit:1", transition: "fired", summary: {} }],
    });
    expect((await loadStates(pool, server.publicId)).size).toBe(0);
    expect(await count("SELECT count(*) AS n FROM alerts.alert_events WHERE server_id = $1", [server.id])).toBe(0);
  });

  it("a rule deleted later keeps its log (the events outlive the rule)", async () => {
    const server = await newServer();
    await seedPresetRules(pool, server.publicId);
    const outage = (await rulesOf(server.publicId)).find((rule) => rule.kind === "power_outage")!;
    await writeEvaluation(pool, {
      nowMs: NOW,
      writes: [],
      events: [{ ruleId: outage.id, kind: "power_outage", severity: "critical", subject: "circuit:1", transition: "fired", summary: {} }],
    });
    await admin.query("DELETE FROM alerts.rules WHERE id = $1", [outage.id]);
    const rows = (await admin.query("SELECT rule_id, kind FROM alerts.alert_events WHERE server_id = $1", [server.id])).rows;
    expect(rows).toEqual([{ rule_id: null, kind: "power_outage" }]);
  });

  it("an empty evaluation writes nothing and does not open a transaction that could fail", async () => {
    await expect(writeEvaluation(pool, { nowMs: NOW, writes: [], events: [] })).resolves.toBeUndefined();
  });

  it("loads mutes only for live servers", async () => {
    const server = await newServer();
    const removed = await newServer();
    await admin.query("INSERT INTO alerts.server_mutes (server_id, muted_until) VALUES ($1, to_timestamp($2 / 1000.0))", [server.id, NOW + 3_600_000]);
    await admin.query("INSERT INTO alerts.server_mutes (server_id, muted_until) VALUES ($1, to_timestamp($2 / 1000.0))", [removed.id, NOW + 3_600_000]);
    await admin.query("UPDATE servers.servers SET deleted_at = now() WHERE id = $1", [removed.id]);
    const mutes = await loadMutes(pool);
    expect(mutes.get(server.publicId)).toBe(NOW + 3_600_000);
    expect(mutes.has(removed.publicId)).toBe(false);
  });

  it("purges alert events older than 90 days in batches, and keeps recent ones", async () => {
    const server = await newServer();
    const insert = (ageMs: number, n: number) =>
      admin.query(
        `INSERT INTO alerts.alert_events (server_id, kind, severity, subject, transition, at)
         SELECT $1::uuid, 'power_outage', 'critical', 'circuit:' || g, 'fired', to_timestamp(($2::float8 - $3::float8) / 1000.0)
         FROM generate_series(1, $4::int) AS g`,
        [server.id, NOW, ageMs, n],
      );
    await insert(ALERT_EVENT_RETENTION_MS + 86_400_000, 12); // 91 days old
    await insert(ALERT_EVENT_RETENTION_MS - 86_400_000, 3); // 89 days old
    const purged = await purgeExpiredEvents(pool, NOW, { batchSize: 5 });
    expect(purged).toBe(12);
    expect(await count("SELECT count(*) AS n FROM alerts.alert_events WHERE server_id = $1", [server.id])).toBe(3);
  });
});
