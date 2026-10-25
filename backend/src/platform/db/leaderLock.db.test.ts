import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { LeaderLock, createLeaderLockClient } from "./leaderLock.js";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";

// ADR-0054 D3.2 against a real Postgres: two instances on one database, one leader, and failover within one interval
// (5 s) after the leader releases the lock or its connection drops. Real timers, the production interval.
const available = dbTestsAvailable();
const INTERVAL_MS = 5_000;
const silent = { info: () => {}, warn: () => {}, error: () => {} };

async function until(condition: () => boolean, timeoutMs: number): Promise<number> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return Date.now() - started;
}

describe.skipIf(!available)("LeaderLock against a real Postgres", () => {
  let db: TestDatabase;
  let admin: pg.Pool;
  const locks: LeaderLock[] = [];

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled(locks.map((lock) => lock.stop()));
    await admin?.end();
    await db?.drop();
  });

  function instance(key: string, options: { connections?: number } = {}) {
    const terms = { acquired: 0, lost: 0 };
    let connections = 0;
    const lock = new LeaderLock({
      createClient: () => {
        // `connections`: how many clients this instance may open (a dead task never reconnects).
        if (options.connections !== undefined && ++connections > options.connections) throw new Error("gone");
        return createLeaderLockClient({ url: db.appUrl, poolMax: 1, statementTimeoutMs: 5_000, connectionTimeoutMs: 3_000 });
      },
      logger: silent,
      key,
      intervalMs: INTERVAL_MS,
      onAcquired: () => void terms.acquired++,
      onLost: () => void terms.lost++,
    });
    locks.push(lock);
    return { lock, terms };
  }

  /** The backend pids holding the advisory lock `key` in this database. */
  async function holders(key: string): Promise<number[]> {
    const { rows } = await admin.query<{ pid: number }>(
      `SELECT pid FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND database = (SELECT oid FROM pg_database WHERE datname = $1)
          AND ((classid::bigint << 32) | objid::bigint) = $2::bigint`,
      [db.name, key],
    );
    return rows.map((row) => row.pid);
  }

  it("one leader among two; the follower takes over within one interval after the leader stops", async () => {
    const key = "1001";
    const a = instance(key);
    const b = instance(key);
    a.lock.start();
    await until(() => a.lock.isLeader(), 5_000);
    b.lock.start();
    // Two full intervals: b keeps trying and keeps failing while a holds the lock.
    await new Promise((resolve) => setTimeout(resolve, 2 * INTERVAL_MS + 500));
    expect(a.lock.isLeader()).toBe(true);
    expect(b.lock.isLeader()).toBe(false);
    expect(b.terms.acquired).toBe(0);
    expect(await holders(key)).toHaveLength(1);

    const stoppedAt = Date.now();
    await a.lock.stop();
    expect(a.terms).toEqual({ acquired: 1, lost: 1 });
    const failoverMs = await until(() => b.lock.isLeader(), INTERVAL_MS + 2_000);
    console.log(`leader-lock failover after stop: ${Date.now() - stoppedAt} ms`);
    expect(failoverMs).toBeLessThanOrEqual(INTERVAL_MS + 1_000);
    expect(await holders(key)).toHaveLength(1);
    await b.lock.stop();
    expect(await holders(key)).toHaveLength(0);
  }, 40_000);

  it("a dropped leader connection stops its workers at once, and the follower takes over within one interval", async () => {
    const key = "1002";
    const a = instance(key);
    const b = instance(key);
    a.lock.start();
    await until(() => a.lock.isLeader(), 5_000);
    b.lock.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(b.lock.isLeader()).toBe(false);
    const [leaderPid] = await holders(key);
    expect(leaderPid).toBeDefined();

    const droppedAt = Date.now();
    await admin.query("SELECT pg_terminate_backend($1)", [leaderPid]);
    // a notices through the client's 'error' event, without waiting for its next tick.
    const lossMs = await until(() => !a.lock.isLeader(), 2_000);
    expect(a.terms.lost).toBe(1);
    // Whichever instance ticks first takes the lock: b, or a itself on its reconnect. Either way exactly one leader.
    await until(() => a.lock.isLeader() || b.lock.isLeader(), INTERVAL_MS + 2_000);
    const failoverMs = Date.now() - droppedAt;
    console.log(
      `leader-lock: loss noticed after ${lossMs} ms, new leader (${b.lock.isLeader() ? "the follower" : "the old leader, reconnected"}) after a dropped connection: ${failoverMs} ms`,
    );
    expect(failoverMs).toBeLessThanOrEqual(INTERVAL_MS + 1_000);

    // Two more intervals: both keep trying, and there is still exactly one leader.
    await new Promise((resolve) => setTimeout(resolve, 2 * INTERVAL_MS));
    expect([a.lock.isLeader(), b.lock.isLeader()].filter(Boolean)).toHaveLength(1);
    expect(await holders(key)).toHaveLength(1);
    await Promise.all([a.lock.stop(), b.lock.stop()]);
    expect(await holders(key)).toHaveLength(0);
  }, 40_000);

  it("a leader whose connection drops and never comes back (a dead task): the follower leads within one interval", async () => {
    const key = "1003";
    const a = instance(key, { connections: 1 });
    const b = instance(key);
    a.lock.start();
    await until(() => a.lock.isLeader(), 5_000);
    b.lock.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const [leaderPid] = await holders(key);
    const droppedAt = Date.now();
    await admin.query("SELECT pg_terminate_backend($1)", [leaderPid]);
    await until(() => b.lock.isLeader(), INTERVAL_MS + 2_000);
    const failoverMs = Date.now() - droppedAt;
    console.log(`leader-lock failover to the follower after the leader's connection died: ${failoverMs} ms`);
    expect(failoverMs).toBeLessThanOrEqual(INTERVAL_MS + 1_000);
    expect(a.lock.isLeader()).toBe(false);
    expect(a.terms).toEqual({ acquired: 1, lost: 1 });
    await Promise.all([a.lock.stop(), b.lock.stop()]);
  }, 40_000);
});
