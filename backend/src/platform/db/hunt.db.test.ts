import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { Database } from "./database.js";
import { withTransaction } from "./transaction.js";
import { connectWithBackoff } from "./startup.js";

// Independent hunt (fresh eyes) for ADR-0025 PR 2.
const logger = { warn: () => {}, error: () => {}, info: () => {} };

describe("startup: a hung attempt", () => {
  it("still gives up at the deadline when a single attempt never settles", async () => {
    const started = Date.now();
    await expect(
      connectWithBackoff(() => new Promise<never>(() => {}), { logger, deadlineMs: 100, initialDelayMs: 10 }),
    ).rejects.toThrow(/Cannot start/);
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 5_000);
});

describe("shutdown vs. startup retry", () => {
  it("a start() that is retrying when close() is called does not turn into a fatal 'unexpected error'", async () => {
    const database = new Database(
      { url: "postgres://u:p@127.0.0.1:1/x", poolMax: 1, statementTimeoutMs: 1000, connectionTimeoutMs: 500 },
      logger,
      { initialDelayMs: 50, deadlineMs: 60_000 },
    );
    const outcome = database.start().then(() => "resolved", (err: Error) => err.message);
    await new Promise((r) => setTimeout(r, 20)); // first attempt fails, now sleeping
    await database.close();
    // server.ts turns any rejection into process.exit(1), racing the graceful exit(0).
    expect(await outcome).not.toMatch(/unexpected database error/);
  }, 10_000);
});

describe.skipIf(!dbTestsAvailable())("withTransaction against a real Postgres", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  }, 60_000);
  afterAll(async () => {
    await db?.drop();
  });

  it("guards the checked-out client against an 'error' event (backend killed mid-transaction)", async () => {
    const pool = new pg.Pool({ connectionString: db.appUrl, max: 2 });
    pool.on("error", () => {});
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      let listeners = -1;
      await withTransaction(pool, async (client) => {
        listeners = client.listenerCount("error");
        return 1;
      });
      // pg-pool removes its idle listener on checkout; without one, a dropped connection
      // between statements is an uncaught exception that crashes the whole backend.
      expect(listeners).toBeGreaterThan(0);
    } finally {
      await admin.end();
      await pool.end();
    }
  }, 20_000);

  it("survives its backend being killed while fn is between statements", async () => {
    const pool = new pg.Pool({ connectionString: db.appUrl, max: 2 });
    pool.on("error", () => {});
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    const uncaught: unknown[] = [];
    const record = (e: unknown) => void uncaught.push(e);
    const saved = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    process.on("uncaughtException", record);
    try {
      const err = await withTransaction(pool, async (client) => {
        const { rows } = await client.query("SELECT pg_backend_pid() AS pid");
        await admin.query("SELECT pg_terminate_backend($1)", [rows[0].pid]);
        await new Promise((r) => setTimeout(r, 300));
        return 1;
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(uncaught).toEqual([]);
    } finally {
      process.removeListener("uncaughtException", record);
      for (const l of saved) process.on("uncaughtException", l);
      await admin.end();
      await pool.end();
    }
  }, 20_000);
});
