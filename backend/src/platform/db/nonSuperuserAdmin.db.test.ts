import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { dbTestsAvailable } from "../../../test-support/testDb.js";
import { APP_PASSWORD, BACKUP_PASSWORD, MIGRATOR_PASSWORD } from "../../../test-support/dbGlobalSetup.js";
import { provisionDatabase } from "./admin.js";

// Issue #421: on RDS the admin is a LOGIN CREATEROLE CREATEDB role, not a superuser. Since
// PostgreSQL 16 it holds the roles it created with ADMIN TRUE, INHERIT FALSE, SET FALSE, so it can
// neither make satis_migrator a database owner nor act as it without a (temporary) SET grant. And
// RDS creates the database itself (`db_name`), owned by the admin, before db:init ever runs.
// This file starts its own Postgres 18: the admin must create the satis roles itself (so it holds
// what a creator holds), and other files re-provision the shared harness's roles concurrently.
const available = dbTestsAvailable();

const ADMIN_ROLE = "rds_admin";
const ADMIN_PASSWORD = "rds-admin-test-password";

function withUser(base: string, user: string, password: string, database: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

async function oneShot<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  client.on("error", () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe.skipIf(!available)("provisionDatabase with a non-superuser CREATEROLE CREATEDB admin (RDS)", () => {
  let container: StartedPostgreSqlContainer;
  let superuser: pg.Pool;
  let adminUrl: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18").withUsername("postgres").withPassword("postgres").start();
    const base = container.getConnectionUri();
    superuser = new pg.Pool({ connectionString: withUser(base, "postgres", "postgres", "postgres"), max: 2 });
    adminUrl = withUser(base, ADMIN_ROLE, ADMIN_PASSWORD, "postgres");
    await superuser.query(`CREATE ROLE ${ADMIN_ROLE} LOGIN CREATEROLE CREATEDB PASSWORD '${ADMIN_PASSWORD}'`);
    // What the RDS master user holds on pg_read_all_data: it may grant it, but not act as it. The satis
    // roles it creates itself, in the first provisionDatabase, and so holds them the same way.
    await superuser.query(`GRANT pg_read_all_data TO ${ADMIN_ROLE} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
  }, 120_000);

  afterAll(async () => {
    await superuser?.end();
    await container?.stop();
  });

  function options(database: string) {
    return {
      adminUrl,
      database,
      migratorPassword: MIGRATOR_PASSWORD,
      appPassword: APP_PASSWORD,
      backupPassword: BACKUP_PASSWORD,
    };
  }

  async function memberships(member: string): Promise<{ role: string; admin: boolean; set: boolean; inherit: boolean }[]> {
    const rows = await superuser.query(
      `SELECT r.rolname AS role, m.admin_option AS admin, m.set_option AS set, m.inherit_option AS inherit
         FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
        WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
        ORDER BY r.rolname`,
      [member],
    );
    return rows.rows;
  }

  async function lastingSetOrInherit(): Promise<unknown[]> {
    return (await memberships(ADMIN_ROLE)).filter((m) => m.set || m.inherit);
  }

  async function expectProvisioned(database: string): Promise<void> {
    const owner = await superuser.query("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1", [
      database,
    ]);
    expect(owner.rows[0]?.owner).toBe("satis_migrator");

    await oneShot(withUser(adminUrl, "satis_migrator", MIGRATOR_PASSWORD, database), async (migrator) => {
      await migrator.query("CREATE TABLE public.later_table (id int)");
      await migrator.query("INSERT INTO public.later_table VALUES (1)");
    });
    await oneShot(withUser(adminUrl, "satis_app", APP_PASSWORD, database), async (app) => {
      expect((await app.query("SELECT id FROM public.later_table")).rows).toEqual([{ id: 1 }]);
    });

    const reader = await superuser.query("SELECT pg_has_role('satis_backup', 'pg_read_all_data', 'member') AS member");
    expect(reader.rows[0].member).toBe(true);
    expect(await lastingSetOrInherit()).toEqual([]);
  }

  it("(a) creates a new database owned by the migrator, twice, and keeps no membership", async () => {
    await provisionDatabase(options("satis_new"));
    await provisionDatabase(options("satis_new"));
    await expectProvisioned("satis_new");
    // The creator's own grants (PostgreSQL 16+): ADMIN, never SET or INHERIT.
    expect(await memberships(ADMIN_ROLE)).toEqual(
      ["pg_read_all_data", "satis_app", "satis_backup", "satis_migrator"].map((role) => ({
        role,
        admin: true,
        set: false,
        inherit: false,
      })),
    );
  });

  it("(b) takes over a database the admin created first (RDS db_name), twice, and keeps no membership", async () => {
    await oneShot(adminUrl, (admin) => admin.query("CREATE DATABASE satis_existing"));
    await provisionDatabase(options("satis_existing"));
    await provisionDatabase(options("satis_existing"));
    await expectProvisioned("satis_existing");
  });

  it("revokes the temporary grant when a step fails", async () => {
    // A database the admin neither owns nor may take over: ALTER DATABASE ... OWNER fails after the
    // SET grant was made.
    await superuser.query("CREATE DATABASE satis_foreign");
    await expect(provisionDatabase(options("satis_foreign"))).rejects.toMatchObject({ code: "42501" });
    expect(await lastingSetOrInherit()).toEqual([]);
  });

  it("edge: revokes the grant when the schema step on the second connection fails", async () => {
    // A table in public the migrator does not own: GRANT SELECT ON ALL TABLES fails as the migrator.
    await oneShot(adminUrl, (admin) => admin.query("CREATE DATABASE satis_schemafail"));
    await oneShot(withUser(adminUrl, "postgres", "postgres", "satis_schemafail"), (owner) =>
      owner.query("CREATE TABLE public.not_the_migrators (id int)"),
    );
    await expect(provisionDatabase(options("satis_schemafail"))).rejects.toMatchObject({ code: "42501" });
    expect(await lastingSetOrInherit()).toEqual([]);
  });

  it("edge: finishes the database the old db:init left half-done on RDS (admin-owned, PUBLIC already revoked)", async () => {
    await oneShot(adminUrl, (admin) => admin.query("CREATE DATABASE satis_halfdone"));
    await oneShot(adminUrl, (admin) => admin.query("REVOKE ALL ON DATABASE satis_halfdone FROM PUBLIC"));
    await provisionDatabase(options("satis_halfdone"));
    await expectProvisioned("satis_halfdone");
  });

  it("edge: a superuser admin makes no membership grant at all", async () => {
    const superUrl = withUser(adminUrl, "postgres", "postgres", "postgres");
    await provisionDatabase({ ...options("satis_super"), adminUrl: superUrl });
    await provisionDatabase({ ...options("satis_super"), adminUrl: superUrl });
    expect(await memberships("postgres")).toEqual([]);
    const owner = await superuser.query("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'satis_super'");
    expect(owner.rows[0]?.owner).toBe("satis_migrator");
  });

  it("edge: leaves an admin that already held SET on the migrator exactly as it was", async () => {
    const holder = "rds_holder";
    await superuser.query(`CREATE ROLE ${holder} LOGIN CREATEROLE CREATEDB PASSWORD '${ADMIN_PASSWORD}'`);
    await superuser.query(`GRANT satis_migrator TO ${holder} WITH ADMIN TRUE, INHERIT FALSE, SET TRUE`);
    await superuser.query(
      `GRANT satis_app, satis_backup, pg_read_all_data TO ${holder} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
    );
    await provisionDatabase({ ...options("satis_holder"), adminUrl: withUser(adminUrl, holder, ADMIN_PASSWORD, "postgres") });
    expect((await memberships(holder)).find((m) => m.role === "satis_migrator")).toEqual({
      role: "satis_migrator",
      admin: true,
      set: true,
      inherit: false,
    });
  });

  // Issue #427: a revoke that failed in an earlier run (the connection dropped between the steps)
  // leaves the admin's own SET grant behind, and the next run would see "already held" and keep it.
  async function leaveSelfGrant(url: string): Promise<void> {
    await oneShot(url, (admin) => admin.query("GRANT satis_migrator TO SESSION_USER WITH INHERIT FALSE, SET TRUE"));
  }

  it("removes a SET grant the admin left on itself in an earlier run", async () => {
    await provisionDatabase(options("satis_leftover"));
    await leaveSelfGrant(adminUrl);
    expect(await lastingSetOrInherit()).toHaveLength(1);
    await provisionDatabase(options("satis_leftover"));
    await expectProvisioned("satis_leftover");
  });

  it("edge: removes the leftover but keeps a SET membership someone else granted", async () => {
    const holder = "rds_holder_leftover";
    await superuser.query(`CREATE ROLE ${holder} LOGIN CREATEROLE CREATEDB PASSWORD '${ADMIN_PASSWORD}'`);
    await superuser.query(`GRANT satis_migrator TO ${holder} WITH ADMIN TRUE, INHERIT FALSE, SET TRUE`);
    await superuser.query(
      `GRANT satis_app, satis_backup, pg_read_all_data TO ${holder} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
    );
    const holderUrl = withUser(adminUrl, holder, ADMIN_PASSWORD, "postgres");
    await leaveSelfGrant(holderUrl);
    await provisionDatabase({ ...options("satis_holder_leftover"), adminUrl: holderUrl });
    const grants = await superuser.query(
      `SELECT pg_get_userbyid(m.grantor) AS grantor, m.set_option AS set
         FROM pg_auth_members m
        WHERE m.roleid = 'satis_migrator'::regrole AND m.member = $1::regrole`,
      [holder],
    );
    expect(grants.rows).toEqual([{ grantor: "postgres", set: true }]);
  });

  it("edge: fails naming the manual revoke when the leftover cannot be revoked", async () => {
    await provisionDatabase(options("satis_stuck"));
    await leaveSelfGrant(adminUrl);
    const real = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      if (typeof args[0] === "string" && args[0].startsWith("REVOKE satis_migrator")) {
        return Promise.reject(new Error("connection dropped"));
      }
      return (real as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    try {
      await expect(provisionDatabase(options("satis_stuck"))).rejects.toThrow('run REVOKE satis_migrator FROM "rds_admin" by hand');
    } finally {
      spy.mockRestore();
    }
    // Nothing ran past the check: the leftover is still there for the operator to revoke.
    expect(await lastingSetOrInherit()).toHaveLength(1);
    await oneShot(adminUrl, (admin) => admin.query("REVOKE satis_migrator FROM SESSION_USER"));
  });

  // Issue #427: CREATE/ALTER ROLE ... PASSWORD carries a SCRAM-SHA-256 verifier, never the password,
  // so a failing statement logged by the server (log_min_error_statement) cannot leak it.
  it("sends SCRAM verifiers, never a plaintext password, and the roles still log in", async () => {
    const real = pg.Client.prototype.query;
    const sent: string[] = [];
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      if (typeof args[0] === "string") sent.push(args[0]);
      return (real as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    try {
      await provisionDatabase(options("satis_scram"));
      await provisionDatabase(options("satis_scram"));
    } finally {
      spy.mockRestore();
    }
    const passwordStatements = sent.filter((text) => text.includes(" PASSWORD "));
    expect(passwordStatements).toHaveLength(6);
    for (const text of sent) {
      for (const password of [MIGRATOR_PASSWORD, APP_PASSWORD, BACKUP_PASSWORD]) {
        expect(text).not.toContain(password);
      }
    }

    const stored = await superuser.query(
      "SELECT rolname, rolpassword FROM pg_authid WHERE rolname IN ('satis_migrator', 'satis_app', 'satis_backup') ORDER BY rolname",
    );
    expect(stored.rows).toHaveLength(3);
    for (const row of stored.rows) {
      expect(row.rolpassword).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
    }
    for (const [role, password] of [
      ["satis_migrator", MIGRATOR_PASSWORD],
      ["satis_app", APP_PASSWORD],
      ["satis_backup", BACKUP_PASSWORD],
    ]) {
      await oneShot(withUser(adminUrl, role, password, "satis_scram"), async (client) => {
        expect((await client.query("SELECT current_user AS who")).rows).toEqual([{ who: role }]);
      });
    }
    // The server checks the password: a wrong one is refused.
    await expect(oneShot(withUser(adminUrl, "satis_app", "not-the-app-password", "satis_scram"), () => Promise.resolve())).rejects.toMatchObject({
      code: "28P01",
    });
  });

  it("edge: a password SASLprep changes (non-ASCII space, ligature) still logs in", async () => {
    const appPassword = "app passﬁword-­-test";
    await provisionDatabase({ ...options("satis_saslprep"), appPassword });
    await oneShot(withUser(adminUrl, "satis_app", appPassword, "satis_saslprep"), async (client) => {
      expect((await client.query("SELECT current_user AS who")).rows).toEqual([{ who: "satis_app" }]);
    });
    // Back to the shared password for the tests that follow.
    await provisionDatabase(options("satis_saslprep"));
  });
});
