import { describe, it, expect, afterAll } from "vitest";
import { createDbPool } from "./pool.js";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";

// The readiness probe runs every few minutes, longer than the idle timeout: with min 1 the pool keeps
// one warm connection instead of closing them all and paying a fresh handshake for each probe.
const available = dbTestsAvailable();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!available)("pool min: 1 against a real Postgres", () => {
  let db: TestDatabase | undefined;
  afterAll(async () => {
    await db?.drop();
  });

  it("keeps exactly one connection after everything idles past the idle timeout, and closes the extra ones", async () => {
    db = await createTestDatabase();
    const pool = createDbPool(
      { url: db.appUrl, poolMax: 5, statementTimeoutMs: 5000, connectionTimeoutMs: 3000, idleTimeoutMs: 200 },
      { error: () => {} },
    );
    try {
      expect(pool.totalCount).toBe(0); // not pre-created
      await Promise.all([1, 2, 3].map(() => pool.query("SELECT pg_sleep(0.1)")));
      expect(pool.totalCount).toBeGreaterThanOrEqual(2); // a burst opened several
      await delay(1500); // well past the idle timeout
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(1);
      // ...and the surviving one still answers (a probe would reuse it, no new handshake).
      await expect(pool.query("SELECT 1 AS ok")).resolves.toMatchObject({ rows: [{ ok: 1 }] });
      expect(pool.totalCount).toBe(1);
    } finally {
      await pool.end();
    }
  }, 30_000);
});
