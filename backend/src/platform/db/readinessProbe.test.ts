import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { Database } from "./database.js";
import { DEFAULT_READINESS_TIMEOUT_MS, loadDatabaseConfig } from "./config.js";
import { createDbPool } from "./pool.js";

// The readiness probe (ADR-0025 decision 6) after the two 503s on the busy game PC: it borrows a
// connection and runs SELECT 1 within a configurable budget, times the two phases apart, and on a
// miss writes ONE warn with a fixed code, numbers and the phase, never an error message.
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const config = (readinessTimeoutMs: number) => ({
  url: "postgres://u:p@127.0.0.1:1/d",
  poolMax: 2,
  statementTimeoutMs: 1000,
  connectionTimeoutMs: 100,
  readinessTimeoutMs,
});
const immediately = { sleep: async () => {}, now: () => 0 };

interface Fake {
  connect: () => Promise<{ query: (text: string) => Promise<{ rows: unknown[] }>; release: (arg?: unknown) => void }>;
}

/** A pool whose connection acquisition and queries can be slowed or failed, recording releases. */
function harness(options: { connectMs?: number; queryMs?: number; connectError?: unknown; queryError?: unknown } = {}) {
  const released: unknown[] = [];
  const warns: { obj: Record<string, unknown>; msg: string }[] = [];
  const logger = {
    warn: (obj: object, msg: string) => warns.push({ obj: obj as Record<string, unknown>, msg }),
    error: vi.fn(),
    info: vi.fn(),
  };
  let healthy = false; // start() (SELECT 1 and the schema check) must pass; the probe misbehaves after
  const fake: Fake = {
    connect: async () => {
      if (healthy) {
        if (options.connectMs) {
          await delay(options.connectMs);
        }
        if (options.connectError) {
          throw options.connectError;
        }
      }
      return {
        query: async () => {
          if (healthy) {
            if (options.queryMs) {
              await delay(options.queryMs);
            }
            if (options.queryError) {
              throw options.queryError;
            }
          }
          return { rows: [{}] };
        },
        release: (arg?: unknown) => {
          released.push(arg);
        },
      };
    },
  };
  const pool = {
    ...fake,
    query: async () => ({ rows: [{}] }),
    end: async () => {},
    on: () => {},
  } as unknown as Pool;
  return {
    make: async (budgetMs: number) => {
      const database = new Database(config(budgetMs), logger, immediately, pool);
      await database.start();
      healthy = true;
      return database;
    },
    released,
    warns,
  };
}

describe("Database.isReady (readiness probe)", () => {
  it("is true, silent, and hands the connection back when both phases are fast", async () => {
    const h = harness();
    const database = await h.make(200);
    await expect(database.isReady()).resolves.toBe(true);
    await delay(20);
    expect(h.warns).toEqual([]);
    expect(h.released).toEqual([undefined]);
  });

  it("ACQUIRE phase slow: false, ONE warn readiness_probe_slow with phase acquire and the elapsed time; the late connection is still returned", async () => {
    const h = harness({ connectMs: 150 });
    const database = await h.make(40);
    await expect(database.isReady()).resolves.toBe(false);
    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]!.obj).toMatchObject({ code: "readiness_probe_slow", phase: "acquire", budget_ms: 40 });
    expect(h.warns[0]!.obj.elapsed_ms as number).toBeGreaterThanOrEqual(35);
    await delay(250); // the probe settles late; its connection must not leak a pool slot
    expect(h.released).toHaveLength(1);
  });

  it("QUERY phase slow: false, ONE warn readiness_probe_slow with phase query", async () => {
    const h = harness({ queryMs: 150 });
    const database = await h.make(40);
    await expect(database.isReady()).resolves.toBe(false);
    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]!.obj).toMatchObject({ code: "readiness_probe_slow", phase: "query" });
    await delay(250);
    expect(h.released).toHaveLength(1);
  });

  it("ACQUIRE fails: false, ONE warn readiness_probe_failed with the database error CODE only", async () => {
    const secret = "password authentication failed for user satis_app host 10.1.2.3 SECRETDETAIL";
    const h = harness({ connectError: Object.assign(new Error(secret), { code: "ECONNREFUSED" }) });
    const database = await h.make(200);
    await expect(database.isReady()).resolves.toBe(false);
    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]!.obj).toMatchObject({ code: "readiness_probe_failed", phase: "acquire", db_code: "ECONNREFUSED" });
    expect(JSON.stringify(h.warns)).not.toContain("SECRETDETAIL");
    expect(JSON.stringify(h.warns)).not.toContain("10.1.2.3");
  });

  it("QUERY fails: false, ONE warn readiness_probe_failed, and the broken connection is destroyed, not reused", async () => {
    const err = Object.assign(new Error("terminating connection due to administrator command SECRETDETAIL"), { code: "57P01" });
    const h = harness({ queryError: err });
    const database = await h.make(200);
    await expect(database.isReady()).resolves.toBe(false);
    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]!.obj).toMatchObject({ code: "readiness_probe_failed", phase: "query", db_code: "57P01" });
    expect(JSON.stringify(h.warns)).not.toContain("SECRETDETAIL");
    await delay(20);
    expect(h.released).toEqual([err]); // release(err) makes pg-pool close it
  });

  it("is false without a warn before start() (that is 'starting', not a probe miss)", async () => {
    const h = harness();
    const database = new Database(config(200), { warn: () => {}, error: () => {}, info: () => {} }, immediately, {
      connect: async () => {
        throw new Error("must not be called");
      },
      end: async () => {},
      on: () => {},
    } as unknown as Pool);
    await expect(database.isReady()).resolves.toBe(false);
    expect(h.warns).toEqual([]);
  });
});

describe("readiness budget and pool settings", () => {
  const URL_OK = "postgres://u:p@localhost:5432/satis";

  it("defaults to 3 s and is configurable between 100 ms and 10 s", () => {
    expect(DEFAULT_READINESS_TIMEOUT_MS).toBe(3000);
    expect(loadDatabaseConfig({ DATABASE_URL: URL_OK })?.readinessTimeoutMs).toBe(3000);
    expect(loadDatabaseConfig({ DATABASE_URL: URL_OK, DATABASE_READINESS_TIMEOUT_MS: "5000" })?.readinessTimeoutMs).toBe(5000);
    expect(loadDatabaseConfig({ DATABASE_URL: URL_OK, DATABASE_READINESS_TIMEOUT_MS: "100" })?.readinessTimeoutMs).toBe(100);
    expect(loadDatabaseConfig({ DATABASE_URL: URL_OK, DATABASE_READINESS_TIMEOUT_MS: "10000" })?.readinessTimeoutMs).toBe(10_000);
  });

  it.each(["99", "10001", "0", "-5", "fast", "1.5", ""])("rejects DATABASE_READINESS_TIMEOUT_MS=%s (blank means the default)", (value) => {
    const attempt = () => loadDatabaseConfig({ DATABASE_URL: URL_OK, DATABASE_READINESS_TIMEOUT_MS: value });
    if (value === "") {
      expect(attempt()?.readinessTimeoutMs).toBe(3000);
    } else {
      expect(attempt).toThrow(/DATABASE_READINESS_TIMEOUT_MS/);
    }
  });

  it("the pool keeps one connection (min 1) and is otherwise unchanged", async () => {
    const pool = createDbPool({ url: URL_OK, poolMax: 7, statementTimeoutMs: 1000, connectionTimeoutMs: 100 }, { error: () => {} });
    try {
      expect(pool.options).toMatchObject({ min: 1, max: 7, idleTimeoutMillis: 30_000 });
      expect(pool.totalCount).toBe(0); // not pre-created: the first use opens it
    } finally {
      await pool.end();
    }
  });
});
