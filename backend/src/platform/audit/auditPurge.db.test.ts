import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { purgeExpiredAuditEvents } from "./auditRepository.js";

// Audit retention: the trail is append-only for the runtime role, so expiry goes through one narrow
// SECURITY DEFINER function owned by the migrator. It deletes only events older than a year.
const available = dbTestsAvailable();

describe.skipIf(!available)("audit.purge_expired_events()", () => {
  let db: TestDatabase;
  let admin: pg.Pool;
  let app: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    app = new pg.Pool({ connectionString: db.appUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await admin?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await admin.query("TRUNCATE audit.audit_events");
    await admin.query("DROP SCHEMA IF EXISTS evil CASCADE");
  });

  const insertAt = (daysAgo: number, action = "login") =>
    admin.query("INSERT INTO audit.audit_events (at, action) VALUES (now() - make_interval(days => $1::int), $2)", [daysAgo, action]);
  const remaining = async () => (await admin.query("SELECT action FROM audit.audit_events ORDER BY at")).rows.map((r) => r.action as string);

  it("deletes only events older than a year, and returns how many", async () => {
    await insertAt(400, "old_a");
    await insertAt(366, "old_b");
    await insertAt(364, "keep_c");
    await insertAt(30, "keep_d");
    await insertAt(0, "keep_e");
    expect(await purgeExpiredAuditEvents(app)).toBe(2);
    expect(await remaining()).toEqual(["keep_c", "keep_d", "keep_e"]);
    expect(await purgeExpiredAuditEvents(app)).toBe(0);
  });

  it("does nothing on an empty trail", async () => {
    expect(await purgeExpiredAuditEvents(app)).toBe(0);
  });

  it("the runtime role still cannot DELETE or UPDATE the trail directly, and can EXECUTE the function", async () => {
    await insertAt(400);
    await expect(app.query("DELETE FROM audit.audit_events")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("UPDATE audit.audit_events SET action = 'x'")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("TRUNCATE audit.audit_events")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("SELECT audit.purge_expired_events() AS n")).resolves.toMatchObject({ rows: [{ n: "1" }] });
  });

  it("is SECURITY DEFINER, owned by the migrator, with a pinned search_path, and EXECUTE not open to PUBLIC", async () => {
    const row = (
      await admin.query(
        `SELECT p.prosecdef AS definer, r.rolname AS owner, p.proconfig AS config,
                has_function_privilege('satis_app', p.oid, 'EXECUTE') AS app,
                has_function_privilege('public', p.oid, 'EXECUTE') AS pub
         FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
         WHERE p.pronamespace = 'audit'::regnamespace AND p.proname = 'purge_expired_events'`,
      )
    ).rows[0];
    expect(row.definer).toBe(true);
    expect(row.owner).toBe("satis_migrator");
    expect(row.config).toEqual(["search_path=pg_catalog, audit"]);
    expect(row).toMatchObject({ app: true, pub: false });
  });

  it("cannot be hijacked through the caller's search_path: a same-named table elsewhere is never touched", async () => {
    await admin.query("CREATE SCHEMA evil");
    await admin.query("CREATE TABLE evil.audit_events (at timestamptz, action text)");
    await admin.query("INSERT INTO evil.audit_events VALUES (now() - interval '5 years', 'decoy')");
    await admin.query("GRANT USAGE ON SCHEMA evil TO satis_app");
    await admin.query("GRANT ALL ON evil.audit_events TO satis_app");
    await insertAt(400, "old_real");
    const client = await app.connect();
    try {
      await client.query("SET search_path = evil, public");
      const result = await client.query("SELECT audit.purge_expired_events() AS n");
      expect(result.rows[0].n).toBe("1"); // the real trail's old row
    } finally {
      client.release(true);
    }
    expect((await admin.query("SELECT action FROM evil.audit_events")).rows).toEqual([{ action: "decoy" }]);
    expect(await remaining()).toEqual([]);
  });

  it("the purge itself leaves no audit row (it deletes history, it does not make more)", async () => {
    await insertAt(500);
    await purgeExpiredAuditEvents(app);
    expect(await remaining()).toEqual([]);
  });
});
