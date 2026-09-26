import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { RAW_RETENTION_MS } from "../repositories/historyRepository.js";
import { HistoryMaintenanceWorker } from "./historyMaintenanceWorker.js";

const logger = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) as unknown as Logger & { warn: ReturnType<typeof vi.fn> };

function fakeDb(fail = false) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (fail) throw new Error("db down");
      calls.push({ sql, params });
      // Purges read a `deleted` count; report "nothing to delete" so each loop ends at once.
      return { rows: sql.includes("count(*)") ? [{ deleted: 0 }] : [] };
    }),
  } as unknown as Queryable;
  return { db, calls };
}

const NOW = Date.UTC(2026, 8, 25, 12, 0, 30);
const rollups = (calls: { sql: string; params: unknown[] }[]) =>
  calls.filter((call) => call.sql.includes("_rollups") && !call.sql.includes("DELETE"));
const purges = (calls: { sql: string }[]) => calls.filter((call) => call.sql.includes("DELETE"));

describe("HistoryMaintenanceWorker.runOnce", () => {
  it("catches up over the whole raw window on the first run, then only the recent overlap", async () => {
    const { db, calls } = fakeDb();
    let now = NOW;
    const worker = new HistoryMaintenanceWorker(db, { logger: logger(), now: () => now });
    await worker.runOnce();
    const first = rollups(calls)[0]?.params[0] as string;
    expect(new Date(first).getTime()).toBe(Math.floor((NOW - RAW_RETENTION_MS) / 60_000) * 60_000);
    calls.length = 0;
    now += 60_000;
    await worker.runOnce();
    const second = rollups(calls)[0]?.params[0] as string;
    // Only the recent overlap (5 minutes), floored to a whole minute: far after the 48 h catch-up start.
    expect(new Date(second).getTime()).toBe(Math.floor((now - 5 * 60_000) / 60_000) * 60_000);
  });

  it("purges on the first run and then only when the interval has passed", async () => {
    const { db, calls } = fakeDb();
    let now = NOW;
    const worker = new HistoryMaintenanceWorker(db, { logger: logger(), now: () => now });
    await worker.runOnce();
    expect(purges(calls).length).toBeGreaterThan(0);
    calls.length = 0;
    now += 60_000;
    await worker.runOnce();
    expect(purges(calls)).toHaveLength(0);
    now += 10 * 60_000;
    await worker.runOnce();
    expect(purges(calls).length).toBeGreaterThan(0);
  });

  it("never throws, logs the first failure only, and keeps the catch-up until a run succeeds", async () => {
    const { db } = fakeDb(true);
    const log = logger();
    const worker = new HistoryMaintenanceWorker(db, { logger: log, now: () => NOW });
    await expect(worker.runOnce()).resolves.toBeUndefined();
    await worker.runOnce();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("stop() before start() keeps it stopped", async () => {
    const { db } = fakeDb();
    const worker = new HistoryMaintenanceWorker(db, { logger: logger() });
    await worker.stop();
    worker.start();
    expect(db.query).not.toHaveBeenCalled();
  });
});
