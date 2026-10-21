import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../test-support/testDb.js";
import type { TestDatabase } from "../../test-support/testDb.js";
import { upsertConfiguredServer } from "../modules/servers/repositories/serverRepository.js";
import { sweepRetention, topTableSizes } from "./retention.js";

// The retention sweeps run as the app role (satis_app), which has DELETE on the agents and alerts schemas.
const available = dbTestsAvailable();

describe.skipIf(!available)("retention sweeps", () => {
  let db: TestDatabase;
  let admin: pg.Pool;
  let app: pg.Pool;
  let serverId: string;
  let destinationId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    app = new pg.Pool({ connectionString: db.appUrl, max: 2 });
    serverId = (await upsertConfiguredServer(app, { publicId: "retention-s", displayName: "Retention" })).id;
    destinationId = (
      await admin.query(
        "INSERT INTO alerts.destinations (server_id, kind, webhook_enc, key_id, last4) VALUES ($1, 'discord', $2, 'k1', 'abcd') RETURNING id",
        [serverId, Buffer.alloc(40)],
      )
    ).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await admin?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await admin.query("TRUNCATE alerts.outbox, alerts.alert_events, alerts.server_mutes, agents.enrollment_codes");
  });

  it("deletes expired enrollment codes and keeps live ones", async () => {
    await admin.query(
      "INSERT INTO agents.enrollment_codes (server_id, code_hash, expires_at) VALUES ($1, decode(repeat('aa', 32), 'hex'), now() - interval '1 hour'), ($1, decode(repeat('bb', 32), 'hex'), now() + interval '1 hour')",
      [serverId],
    );
    expect((await sweepRetention(app)).enrollmentCodes).toBe(1);
    expect((await admin.query("SELECT count(*)::int AS n FROM agents.enrollment_codes")).rows[0].n).toBe(1);
  });

  it("deletes mutes whose time has passed and keeps active ones", async () => {
    await admin.query("INSERT INTO alerts.server_mutes (server_id, muted_until) VALUES ($1, now() - interval '1 minute')", [serverId]);
    expect((await sweepRetention(app)).serverMutes).toBe(1);
    await admin.query("INSERT INTO alerts.server_mutes (server_id, muted_until) VALUES ($1, now() + interval '1 hour')", [serverId]);
    expect((await sweepRetention(app)).serverMutes).toBe(0);
  });

  it("deletes sent and dead outbox rows older than 7 days, never pending or recent ones", async () => {
    const event = async (n: number) =>
      (
        await admin.query(
          "INSERT INTO alerts.alert_events (server_id, kind, severity, subject, transition, at) VALUES ($1, 'outage', 'critical', $2, 'fired', now()) RETURNING id",
          [serverId, `s${n}`],
        )
      ).rows[0].id as string;
    const row = async (n: number, status: string, createdDaysAgo: number, sentDaysAgo: number | null) =>
      (
        await admin.query(
          "INSERT INTO alerts.outbox (event_id, destination_id, status, created_at, sent_at) VALUES ($1, $2, $3, now() - make_interval(days => $4::int), CASE WHEN $5::int IS NULL THEN NULL ELSE now() - make_interval(days => $5::int) END) RETURNING id::text",
          [await event(n), destinationId, status, createdDaysAgo, sentDaysAgo],
        )
      ).rows[0].id as string;
    await row(1, "sent", 9, 8); // goes
    await row(2, "dead", 10, null); // goes
    await row(3, "sent", 9, 6); // delivered 6 days ago: stays
    await row(4, "dead", 3, null); // stays
    await row(5, "pending", 30, null); // stays, however old
    expect((await sweepRetention(app)).outbox).toBe(2);
    expect((await admin.query("SELECT status FROM alerts.outbox ORDER BY id")).rows.map((r) => r.status)).toEqual(["sent", "dead", "pending"]);
  });

  it("lists at most five tables by size, largest first, as the app role", async () => {
    const top = await topTableSizes(app);
    expect(top.length).toBeGreaterThan(0);
    expect(top.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < top.length; i++) expect(top[i - 1]!.mb).toBeGreaterThanOrEqual(top[i]!.mb);
  });
});
