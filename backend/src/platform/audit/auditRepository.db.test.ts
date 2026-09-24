import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { listRecentAuditEvents, recordAuditEvent } from "./auditRepository.js";

const available = dbTestsAvailable();

describe.skipIf(!available)("audit repository against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 3 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const SERVER_A = "11111111-1111-4111-8111-111111111111";
  const SERVER_B = "22222222-2222-4222-8222-222222222222";
  const USER = "33333333-3333-4333-8333-333333333333";

  it("records an event with its actor, server and detail, and returns it", async () => {
    const event = await recordAuditEvent(pool, { action: "revoke_all", actorUserId: USER, serverId: SERVER_A, detail: { count: 3 } });
    expect(event).toMatchObject({ action: "revoke_all", actorUserId: USER, serverId: SERVER_A, detail: { count: 3 } });
    expect(event.id).toBeGreaterThan(0);
    expect(event.at).toBeInstanceOf(Date);
  });

  it("the actor, server and detail are optional", async () => {
    expect(await recordAuditEvent(pool, { action: "login" })).toMatchObject({ actorUserId: null, serverId: null, detail: {} });
  });

  it("refuses a malformed action (a CHECK) and never interpolates the detail into SQL", async () => {
    await expect(recordAuditEvent(pool, { action: "Not Valid" })).rejects.toMatchObject({ code: "23514" });
    const nasty = { note: "'); DROP TABLE audit.audit_events; --" };
    const event = await recordAuditEvent(pool, { action: "note_added", detail: nasty });
    expect(event.detail).toEqual(nasty);
    expect((await listRecentAuditEvents(pool, { limit: 500 })).length).toBeGreaterThan(0); // the table is still there
  });

  it("lists newest first, optionally for one server, with a clamped limit", async () => {
    const stamp = `list_${Date.now().toString(36)}`;
    for (let i = 0; i < 5; i++) {
      await recordAuditEvent(pool, { action: stamp, serverId: i % 2 === 0 ? SERVER_B : SERVER_A, detail: { i } });
    }
    const forB = await listRecentAuditEvents(pool, { serverId: SERVER_B, limit: 100 });
    const ours = forB.filter((e) => e.action === stamp);
    expect(ours.map((e) => e.detail.i)).toEqual([4, 2, 0]); // newest first
    expect(forB.every((e) => e.serverId === SERVER_B)).toBe(true);
    expect(await listRecentAuditEvents(pool, { limit: 2 })).toHaveLength(2);
    expect(await listRecentAuditEvents(pool, { limit: 0 })).toHaveLength(1); // clamped up to 1
    expect((await listRecentAuditEvents(pool, { limit: 10_000 })).length).toBeLessThanOrEqual(500);
  });

  it("is append-only for the runtime role: the trail cannot be rewritten through the app", async () => {
    const event = await recordAuditEvent(pool, { action: "immutable" });
    await expect(pool.query("UPDATE audit.audit_events SET action = 'edited' WHERE id = $1", [event.id])).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("DELETE FROM audit.audit_events WHERE id = $1", [event.id])).rejects.toMatchObject({ code: "42501" });
  });
});
