import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { createPendingServerSweeper } from "./pendingServerSweeper.js";
import type { PendingServerSweeperDeps } from "./pendingServerSweeper.js";

/** #526 (ADR-0046 C4): the sweeper's own behaviour with a fake database. The SQL and the removal run against Postgres in
 *  selfServeOwner.db.test.ts. */
function fakeLogger() {
  const lines: { level: string; obj: unknown; msg?: string }[] = [];
  const at = (level: string) => (obj: unknown, msg?: string) => lines.push({ level, obj, msg });
  return { logger: { info: at("info"), warn: at("warn"), error: at("error") } as unknown as Logger, lines };
}

/** A database whose candidate list is `candidates`, whose lock finds each one, and which runs `connect` transactions. */
function fakeDb(candidates: string[], options: { failList?: () => boolean } = {}) {
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      if (/FOR NO KEY UPDATE/.test(text)) return { rows: [{ id: `uuid-${String(values?.[0])}` }] };
      if (/UPDATE servers\.servers\s+SET deleted_at/.test(text)) return { rows: [{ id: `uuid-${String(values?.[0])}` }] };
      if (/INSERT INTO audit\.audit_events/.test(text)) {
        return { rows: [{ id: "1", at: new Date(), actor_user_id: null, server_id: values?.[1], action: values?.[2], detail: {} }] };
      }
      return { rows: [] };
    }),
    release: () => {},
    on: () => {},
    removeListener: () => {},
  };
  return {
    query: vi.fn(async () => {
      if (options.failList?.()) throw Object.assign(new Error("boom"), { code: "ECONNREFUSED" });
      return { rows: candidates.map((public_id) => ({ public_id })) };
    }),
    connect: async () => client,
    client,
  };
}

function sweeper(db: ReturnType<typeof fakeDb>, extra: Partial<PendingServerSweeperDeps> = {}) {
  const { logger, lines } = fakeLogger();
  const counters: unknown[][] = [];
  const removed: string[] = [];
  const sweep = createPendingServerSweeper({
    db: db as unknown as PendingServerSweeperDeps["db"],
    logger,
    ttlHours: 24,
    enrolledServerIds: async () => new Set(),
    removeRuntime: async (id) => removed.push(id),
    metrics: { recordHistogram: () => {}, recordCounter: (...args: unknown[]) => counters.push(args) },
    ...extra,
  });
  return { sweep, lines, counters, removed };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PendingServerSweeper", () => {
  it("removes each candidate, then logs and counts the total once, counts only", async () => {
    const { sweep, lines, counters, removed } = sweeper(fakeDb(["aaa", "bbb"]));
    await expect(sweep.sweep()).resolves.toEqual({ swept: 2, skipped: 0 });
    expect(removed).toEqual(["aaa", "bbb"]);
    expect(counters).toEqual([["satis.servers.pending_swept", {}, 2]]);
    expect(lines).toEqual([{ level: "info", obj: { swept: 2, skipped: 0 }, msg: "removed self-serve servers that never enrolled" }]);
    expect(JSON.stringify(lines)).not.toMatch(/aaa|bbb/);
  });

  it("skips a candidate that has enrolled meanwhile, and says nothing when nothing was removed", async () => {
    const { sweep, lines, counters, removed } = sweeper(fakeDb(["aaa"]), { enrolledServerIds: async (_db, ids) => new Set(ids) });
    await expect(sweep.sweep()).resolves.toEqual({ swept: 0, skipped: 1 });
    expect(removed).toEqual([]);
    expect(counters).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("never throws: a failing run is logged once per run of failures, and the recovery once", async () => {
    let failing = true;
    const { sweep, lines } = sweeper(fakeDb([], { failList: () => failing }));
    await expect(sweep.sweep()).resolves.toEqual({ swept: 0, skipped: 0 });
    await sweep.sweep();
    expect(lines.filter((l) => l.level === "warn")).toHaveLength(1);
    failing = false;
    await sweep.sweep();
    expect(lines.filter((l) => l.level === "info").map((l) => l.obj)).toEqual(["pending self-serve server sweep recovered"]);
  });

  it("runs on its interval once started, one run at a time, and stops", async () => {
    vi.useFakeTimers();
    const db = fakeDb([]);
    const { sweep } = sweeper(db, { intervalMs: 1000 });
    sweep.start();
    sweep.start(); // idempotent
    expect(db.query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(db.query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(db.query).toHaveBeenCalledTimes(2);
    await sweep.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
