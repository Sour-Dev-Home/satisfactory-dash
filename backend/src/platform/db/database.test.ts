import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { Database, READINESS_TIMEOUT_MS } from "./database.js";
import { DatabaseSetupError } from "./errors.js";

const config = { url: "postgres://u:p@127.0.0.1:1/d", poolMax: 2, statementTimeoutMs: 1000, connectionTimeoutMs: 100 };
const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
const immediately = { sleep: async () => {}, now: () => 0 };

const fakePool = (query: (text: string) => Promise<{ rows: unknown[] }>) =>
  ({ query, end: async () => {}, on: () => {} }) as unknown as Pool;

describe("Database", () => {
  it("is not ready before start(), whatever the pool says", async () => {
    const database = new Database(config, logger, immediately, fakePool(async () => ({ rows: [{}] })));
    await expect(database.isReady()).resolves.toBe(false);
  });

  it("start() pings, checks the schema and then reports ready", async () => {
    const seen: string[] = [];
    const database = new Database(
      config,
      logger,
      immediately,
      fakePool(async (text) => {
        seen.push(text);
        return { rows: [{}] };
      }),
    );
    await database.start();
    expect(seen).toEqual(["SELECT 1", "SELECT 1 FROM pgmigrations WHERE name = $1"]);
    await expect(database.isReady()).resolves.toBe(true);
  });

  it("start() rejects with the schema message when the schema is behind, and stays not ready", async () => {
    const database = new Database(
      config,
      logger,
      immediately,
      fakePool(async (text) => ({ rows: text === "SELECT 1" ? [{}] : [] })),
    );
    await expect(database.start()).rejects.toBeInstanceOf(DatabaseSetupError);
    await expect(database.isReady()).resolves.toBe(false);
  });

  it("retries a refused connection during start() and then succeeds", async () => {
    let calls = 0;
    const database = new Database(
      config,
      logger,
      immediately,
      fakePool(async (text) => {
        if (text === "SELECT 1" && calls++ < 2) {
          throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
        }
        return { rows: [{}] };
      }),
    );
    await database.start();
    expect(calls).toBe(3);
    await expect(database.isReady()).resolves.toBe(true);
  });

  it("a close() that lands while start() is succeeding leaves it not started and silent", async () => {
    const info = vi.fn();
    let database: Database;
    database = new Database(
      config,
      { warn: vi.fn(), error: vi.fn(), info },
      immediately,
      fakePool(async () => {
        await database.close(); // the shutdown arrives during the attempt
        return { rows: [{}] };
      }),
    );
    await expect(database.start()).resolves.toBeUndefined();
    expect(info).not.toHaveBeenCalled();
    await expect(database.isReady()).resolves.toBe(false);
  });

  it("isReady() is false when SELECT 1 fails after startup, and never throws", async () => {
    let healthy = true;
    const database = new Database(
      config,
      logger,
      immediately,
      fakePool(async () => {
        if (!healthy) {
          throw new Error("down");
        }
        return { rows: [{}] };
      }),
    );
    await database.start();
    healthy = false;
    await expect(database.isReady()).resolves.toBe(false);
  });

  it("isReady() gives up after the 1 s readiness timeout when SELECT 1 hangs", async () => {
    vi.useFakeTimers();
    try {
      let hang = false;
      const database = new Database(
        config,
        logger,
        immediately,
        fakePool(async () => (hang ? new Promise<never>(() => {}) : { rows: [{}] })),
      );
      await database.start();
      hang = true;
      const pending = database.isReady();
      await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS + 10);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
