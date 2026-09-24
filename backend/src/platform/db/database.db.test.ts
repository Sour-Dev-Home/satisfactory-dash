import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { Database } from "./database.js";
import { classifyStartupError, DatabaseSetupError, isUniqueViolation } from "./errors.js";
import { LATEST_MIGRATION } from "./latestMigration.js";
import { withTransaction } from "./transaction.js";
import { migrateUp } from "./admin.js";
import { createReadinessRouter } from "../health.js";
import express from "express";
import request from "supertest";

// ADR-0025: these run against a REAL Postgres 18 (Testcontainers), cloned per file from a template
// that the harness provisioned (roles, builtin C.UTF-8 locale) and migrated once. They are skipped
// only on a local run without Docker; in CI a missing Docker fails the whole run (harnessPolicy).
const available = dbTestsAvailable();
const logger = { warn: () => {}, error: () => {}, info: () => {} };
const fastBackoff = { sleep: async () => {}, now: () => 0 };

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe.skipIf(!available)("against a real Postgres", () => {
  let db: TestDatabase;
  const pools: pg.Pool[] = [];

  beforeAll(async () => {
    db = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
    await db?.drop();
  });

  const config = () => ({ url: db.appUrl, poolMax: 3, statementTimeoutMs: 5000, connectionTimeoutMs: 3000 });
  const newDatabase = () => {
    const database = new Database(config(), logger, fastBackoff);
    pools.push(database.pool);
    return database;
  };

  it("uses the builtin C.UTF-8 locale, like every environment (ADR-0025 decision 1)", async () => {
    const rows = await withClient(db.adminUrl, (c) =>
      c.query("SELECT datlocprovider, datlocale, pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = current_database()"),
    );
    expect(rows.rows[0]).toMatchObject({ datlocprovider: "b", datlocale: "C.UTF-8", encoding: "UTF8" });
  });

  it("has the three module schemas, owned by the migrator", async () => {
    const rows = await withClient(db.adminUrl, (c) =>
      c.query("SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname IN ('identity','servers','audit') ORDER BY 1"),
    );
    expect(rows.rows).toEqual([
      { nspname: "audit", owner: "satis_migrator" },
      { nspname: "identity", owner: "satis_migrator" },
      { nspname: "servers", owner: "satis_migrator" },
    ]);
  });

  it("recorded the bundled newest migration, and running the migrations again is a no-op", async () => {
    const applied = () => withClient(db.adminUrl, (c) => c.query("SELECT name FROM pgmigrations ORDER BY name"));
    const before = (await applied()).rows.map((r) => r.name);
    expect(before).toContain(LATEST_MIGRATION);
    await migrateUp(db.migratorUrl);
    expect((await applied()).rows.map((r) => r.name)).toEqual(before);
  });

  it("satis_app has DML on the module schemas but no DDL, and no rights on public", async () => {
    await withClient(db.migratorUrl, async (migrator) => {
      await migrator.query("CREATE TABLE identity.probe (id integer PRIMARY KEY, note text)");
    });
    await withClient(db.appUrl, async (app) => {
      await app.query("INSERT INTO identity.probe VALUES (1, 'x')");
      await app.query("UPDATE identity.probe SET note = 'y' WHERE id = 1");
      expect((await app.query("SELECT note FROM identity.probe")).rows).toEqual([{ note: "y" }]);
      await app.query("DELETE FROM identity.probe WHERE id = 1");
      await expect(app.query("CREATE TABLE identity.evil (id int)")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("DROP TABLE identity.probe")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("CREATE TABLE public.evil (id int)")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("CREATE SCHEMA evil")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("DELETE FROM pgmigrations")).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("Database.start() succeeds on a migrated database and reports ready; the pool answers", async () => {
    const database = newDatabase();
    await database.start();
    await expect(database.isReady()).resolves.toBe(true);
    expect((await database.pool.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);
  });

  it("serves /api/health/ready 200 through the real pool", async () => {
    const database = newDatabase();
    await database.start();
    const app = express().use("/api", createReadinessRouter(() => database.isReady()));
    const res = await request(app).get("/api/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("refuses to start, saying to run db:migrate, when the newest migration is not applied", async () => {
    const behind = await createTestDatabase();
    try {
      await withClient(behind.adminUrl, (c) => c.query("DELETE FROM pgmigrations WHERE name = $1", [LATEST_MIGRATION]));
      const database = new Database({ ...config(), url: behind.appUrl }, logger, fastBackoff);
      pools.push(database.pool);
      await expect(database.start()).rejects.toThrow(/behind this build.*npm run db:migrate/);
      await expect(database.start()).rejects.toBeInstanceOf(DatabaseSetupError);
      await expect(database.isReady()).resolves.toBe(false);
    } finally {
      await behind.drop();
    }
  });

  it("refuses to start with no schema at all (nothing migrated)", async () => {
    const empty = await createTestDatabase();
    try {
      await withClient(empty.adminUrl, (c) => c.query("DROP TABLE pgmigrations"));
      const database = new Database({ ...config(), url: empty.appUrl }, logger, fastBackoff);
      pools.push(database.pool);
      await expect(database.start()).rejects.toThrow(/no schema yet.*npm run db:migrate/);
    } finally {
      await empty.drop();
    }
  });

  it("classifies REAL driver errors: bad password and missing database are fatal, a refused port is transient", async () => {
    const wrongPassword = new URL(db.appUrl);
    wrongPassword.password = "not-the-password";
    const missing = new URL(db.appUrl);
    missing.pathname = "/no_such_database";
    const closed = new URL(db.appUrl);
    closed.port = "1"; // nothing listens there
    const errorFor = async (url: URL) => {
      const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 2000 });
      try {
        await client.connect();
      } catch (err) {
        return err;
      } finally {
        await client.end().catch(() => {});
      }
      throw new Error("expected the connection to fail");
    };
    expect(classifyStartupError(await errorFor(wrongPassword))).toMatchObject({ kind: "fatal", reason: expect.stringMatching(/credentials/) });
    expect(classifyStartupError(await errorFor(missing))).toMatchObject({ kind: "fatal", reason: expect.stringMatching(/does not exist/) });
    expect(classifyStartupError(await errorFor(closed)).kind).toBe("transient");
  });

  it("Database.isReady() is false, quickly, when the server is unreachable", async () => {
    const closed = new URL(db.appUrl);
    closed.port = "1";
    const database = new Database({ ...config(), url: closed.toString(), connectionTimeoutMs: 500 }, logger, fastBackoff);
    pools.push(database.pool);
    const started = Date.now();
    await expect(database.isReady()).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(2500);
  });

  describe("withTransaction on the real pool", () => {
    let pool: pg.Pool;
    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: db.migratorUrl, max: 3 });
      pools.push(pool);
      await pool.query("CREATE TABLE IF NOT EXISTS servers.tx_probe (id integer PRIMARY KEY, owner_id integer)");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS tx_probe_one_owner ON servers.tx_probe (owner_id) WHERE owner_id IS NOT NULL");
    });

    const count = async () => Number((await pool.query("SELECT count(*) AS n FROM servers.tx_probe")).rows[0].n);

    it("commits what fn wrote", async () => {
      await withTransaction(pool, (c) => c.query("INSERT INTO servers.tx_probe (id) VALUES (1)"));
      expect(await count()).toBe(1);
    });

    it("rolls everything back when fn throws, and returns the connection to the pool", async () => {
      await expect(
        withTransaction(pool, async (c) => {
          await c.query("INSERT INTO servers.tx_probe (id) VALUES (2)");
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect(await count()).toBe(1);
      expect(pool.idleCount + pool.waitingCount).toBeGreaterThan(0);
    });

    it("maps a unique-index violation to 23505 and rolls the whole transaction back", async () => {
      await pool.query("INSERT INTO servers.tx_probe (id, owner_id) VALUES (10, 7)");
      let error: unknown;
      try {
        await withTransaction(pool, async (c) => {
          await c.query("INSERT INTO servers.tx_probe (id) VALUES (11)");
          await c.query("INSERT INTO servers.tx_probe (id, owner_id) VALUES (12, 7)");
        });
      } catch (err) {
        error = err;
      }
      expect(isUniqueViolation(error)).toBe(true);
      expect((await pool.query("SELECT id FROM servers.tx_probe WHERE id IN (11, 12)")).rows).toEqual([]);
    });

    it("is safe under concurrency: parallel transactions all finish and only guarded rows win", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) =>
          withTransaction(pool, (c) => c.query("INSERT INTO servers.tx_probe (id, owner_id) VALUES ($1, 99)", [100 + i])),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const result of results) {
        if (result.status === "rejected") {
          expect(isUniqueViolation(result.reason)).toBe(true);
        }
      }
    });
  });
});
