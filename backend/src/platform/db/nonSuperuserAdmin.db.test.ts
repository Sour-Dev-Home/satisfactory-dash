import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
});
