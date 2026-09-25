import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { APP_PASSWORD, BACKUP_PASSWORD, MIGRATOR_PASSWORD } from "../../../test-support/dbGlobalSetup.js";
import { provisionDatabase } from "./admin.js";

// ADR-0025 decision 7: the backup role reads everything (so a pg_dump is complete by construction)
// and changes nothing, and it never borrows the app's or the migrator's credentials.
const available = dbTestsAvailable();

describe.skipIf(!available)("the satis_backup role", () => {
  let db: TestDatabase;
  let admin: pg.Pool;
  let backup: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    backup = new pg.Pool({ connectionString: db.backupUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await backup?.end();
    await admin?.end();
    await db?.drop();
  });

  it("can connect and read every application table, the migrations table and the audit sequence", async () => {
    for (const table of [
      "identity.users",
      "identity.auth_identities",
      "identity.sessions",
      "identity.login_attempts",
      "servers.servers",
      "servers.server_members",
      "audit.audit_events",
      "public.pgmigrations",
    ]) {
      await expect(backup.query(`SELECT count(*) FROM ${table}`)).resolves.toBeDefined();
    }
    // pg_dump reads a sequence's state too; the identity column's sequence is the case that matters.
    const sequence = await admin.query("SELECT pg_get_serial_sequence('audit.audit_events', 'id') AS name");
    const name = sequence.rows[0].name as string | null;
    if (name !== null) {
      await expect(backup.query(`SELECT last_value FROM ${name}`)).resolves.toBeDefined();
    }
  });

  it("reads a table created after the role was, because pg_read_all_data covers future tables", async () => {
    await admin.query("CREATE TABLE audit.later_table (id int)");
    await expect(backup.query("SELECT * FROM audit.later_table")).resolves.toBeDefined();
  });

  it("cannot write or change anything: no insert, update, delete, DDL or truncate", async () => {
    const readOnlyOrDenied = { code: expect.stringMatching(/^(42501|25006)$/) };
    for (const sql of [
      "INSERT INTO identity.users (display_name) VALUES ('x')",
      "UPDATE identity.users SET display_name = 'y'",
      "DELETE FROM identity.users",
      "TRUNCATE identity.users",
      "CREATE TABLE public.nope (id int)",
      "DROP TABLE identity.users",
    ]) {
      await expect(backup.query(sql), sql).rejects.toMatchObject(readOnlyOrDenied);
    }
  });

  it("is read-only by default, even inside a transaction it opens", async () => {
    expect((await backup.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only).toBe("on");
    const client = await backup.connect();
    try {
      await client.query("BEGIN");
      await expect(client.query("INSERT INTO identity.users (display_name) VALUES ('x')")).rejects.toBeDefined();
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("is a member of nothing but pg_read_all_data: not the app role, not the migrator, no superuser or create rights", async () => {
    const row = (
      await admin.query(
        `SELECT pg_has_role('satis_backup', 'satis_app', 'member') AS app,
                pg_has_role('satis_backup', 'satis_migrator', 'member') AS migrator,
                pg_has_role('satis_backup', 'pg_read_all_data', 'member') AS reader,
                r.rolsuper, r.rolcreatedb, r.rolcreaterole
         FROM pg_roles r WHERE r.rolname = 'satis_backup'`,
      )
    ).rows[0];
    expect(row).toEqual({ app: false, migrator: false, reader: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false });
  });

  it("db:init is idempotent with the backup role: running it again resets nothing it shouldn't and keeps the grants", async () => {
    const options = {
      adminUrl: db.adminUrl,
      database: db.name,
      migratorPassword: MIGRATOR_PASSWORD,
      appPassword: APP_PASSWORD,
      backupPassword: BACKUP_PASSWORD,
    };
    await provisionDatabase(options);
    await provisionDatabase(options);
    await expect(backup.query("SELECT count(*) FROM identity.users")).resolves.toBeDefined();
    // A fresh connection after the re-run (the old pooled ones would mask a lost grant).
    const fresh = new pg.Pool({ connectionString: db.backupUrl, max: 1 });
    try {
      await expect(fresh.query("SELECT count(*) FROM audit.audit_events")).resolves.toBeDefined();
    } finally {
      await fresh.end();
    }
  });
});
