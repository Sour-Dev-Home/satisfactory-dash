import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaderLock } from "./leaderLock.js";
import type { LeaderLockClient } from "./leaderLock.js";

/** One fake Postgres: who holds the lock, and every client created against it. */
class FakeServer {
  holder: FakeClient | undefined;
  clients: FakeClient[] = [];
  connectError: Error | undefined;
  /** When set, the next query on any client waits for this promise (a hung query). */
  hang: Promise<void> | undefined;
}

class FakeClient implements LeaderLockClient {
  ended = false;
  queries: string[] = [];
  queryError: Error | undefined;
  private errorListener: ((err: Error) => void) | undefined;

  constructor(private readonly server: FakeServer) {
    server.clients.push(this);
  }

  async connect(): Promise<void> {
    if (this.server.connectError) throw this.server.connectError;
  }

  async query(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push(sql);
    if (this.server.hang) await this.server.hang;
    if (this.ended) throw new Error("Client was closed and is not queryable");
    if (this.queryError) throw this.queryError;
    if (sql.includes("pg_try_advisory_lock")) {
      if (this.server.holder === undefined || this.server.holder === this) {
        this.server.holder = this;
        return { rows: [{ locked: true }] };
      }
      return { rows: [{ locked: false }] };
    }
    if (sql.includes("pg_advisory_unlock")) {
      const held = this.server.holder === this;
      if (held) this.server.holder = undefined;
      return { rows: [{ unlocked: held }] };
    }
    return { rows: [{ "?column?": 1 }] };
  }

  async end(): Promise<void> {
    this.ended = true;
    if (this.server.holder === this) this.server.holder = undefined; // a session lock dies with its connection
  }

  on(_event: "error", listener: (err: Error) => void): void {
    this.errorListener = listener;
  }

  /** The connection drops while idle: Postgres releases the lock and the driver emits 'error'. */
  drop(): void {
    this.ended = true;
    if (this.server.holder === this) this.server.holder = undefined;
    this.errorListener?.(Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" }));
  }
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function lockOn(server: FakeServer, overrides: { onAcquired?: () => Promise<void> | void; onLost?: () => Promise<void> | void } = {}) {
  const events: string[] = [];
  const log = logger();
  const lock = new LeaderLock({
    createClient: () => new FakeClient(server),
    logger: log,
    intervalMs: 5_000,
    onAcquired: overrides.onAcquired ?? (() => void events.push("acquired")),
    onLost: overrides.onLost ?? (() => void events.push("lost")),
  });
  return { lock, events, log };
}

/** Runs the timers for `ms` and lets the queued steps settle. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("LeaderLock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes the lock on its first tick and starts the leader workers once", async () => {
    const server = new FakeServer();
    const { lock, events, log } = lockOn(server);
    lock.start();
    lock.start(); // double start: one loop
    await advance(0);
    expect(lock.isLeader()).toBe(true);
    expect(events).toEqual(["acquired"]);
    expect(server.clients).toHaveLength(1);
    await advance(15_000);
    expect(events).toEqual(["acquired"]); // the leader only checks its connection
    expect(server.clients[0]!.queries.filter((q) => q === "SELECT 1")).toHaveLength(3);
    expect(log.info).toHaveBeenCalledWith({}, expect.stringContaining("now the leader"));
    await lock.stop();
  });

  it("only one of two instances leads; the other takes over within one interval of the first stopping", async () => {
    const server = new FakeServer();
    const a = lockOn(server);
    const b = lockOn(server);
    a.lock.start();
    await advance(0);
    b.lock.start();
    await advance(0);
    expect(a.lock.isLeader()).toBe(true);
    expect(b.lock.isLeader()).toBe(false);
    expect(b.log.info).toHaveBeenCalledWith({}, expect.stringContaining("follower"));
    await advance(1_000);
    await a.lock.stop();
    expect(a.events).toEqual(["acquired", "lost"]);
    expect(server.holder).toBeUndefined();
    expect(server.clients[0]!.ended).toBe(true);
    await advance(5_000);
    expect(b.lock.isLeader()).toBe(true);
    expect(b.events).toEqual(["acquired"]);
    await b.lock.stop();
  });

  it("a dropped connection stops the leader workers at once (before the next tick), then retries and re-acquires", async () => {
    const server = new FakeServer();
    const { lock, events, log } = lockOn(server);
    lock.start();
    await advance(0);
    server.clients[0]!.drop();
    await advance(0);
    expect(lock.isLeader()).toBe(false);
    expect(events).toEqual(["acquired", "lost"]);
    expect(log.warn).toHaveBeenCalledWith({ code: "ECONNRESET" }, expect.stringContaining("lost the leader lock"));
    await advance(5_000);
    expect(lock.isLeader()).toBe(true);
    expect(events).toEqual(["acquired", "lost", "acquired"]);
    expect(server.clients).toHaveLength(2);
    expect(log.info).toHaveBeenCalledWith({}, expect.stringContaining("restored"));
    await lock.stop();
  });

  it("a failed SELECT 1 ends leadership and drops the client", async () => {
    const server = new FakeServer();
    const { lock, events } = lockOn(server);
    lock.start();
    await advance(0);
    server.clients[0]!.queryError = Object.assign(new Error("timeout"), { code: "57014" });
    await advance(5_000);
    expect(events).toEqual(["acquired", "lost"]);
    expect(server.clients[0]!.ended).toBe(true);
    await lock.stop();
  });

  it("a failed check stops the workers BEFORE closing the client, so a live session keeps the lock until they stopped", async () => {
    const server = new FakeServer();
    let endedDuringLost: boolean | undefined;
    const { lock } = lockOn(server, { onLost: () => void (endedDuringLost = server.clients[0]!.ended) });
    lock.start();
    await advance(0);
    server.clients[0]!.queryError = Object.assign(new Error("timeout"), { code: "57014" });
    await advance(5_000);
    expect(endedDuringLost).toBe(false);
    expect(server.clients[0]!.ended).toBe(true);
    await lock.stop();
  });

  it("while the database is down it retries every interval and warns once per streak", async () => {
    const server = new FakeServer();
    server.connectError = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    const { lock, events, log } = lockOn(server);
    lock.start();
    await advance(20_000);
    expect(server.clients.length).toBe(5);
    expect(server.clients.every((client) => client.ended)).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    server.connectError = undefined;
    await advance(5_000);
    expect(lock.isLeader()).toBe(true);
    await lock.stop();
  });

  it("a late error from an already dropped client changes nothing", async () => {
    const server = new FakeServer();
    const { lock, events } = lockOn(server);
    lock.start();
    await advance(0);
    const first = server.clients[0]!;
    first.drop();
    await advance(5_000);
    expect(events).toEqual(["acquired", "lost", "acquired"]);
    first.drop(); // stale
    await advance(0);
    expect(events).toEqual(["acquired", "lost", "acquired"]);
    expect(lock.isLeader()).toBe(true);
    await lock.stop();
  });

  it("flapping: onAcquired and onLost always alternate and never overlap", async () => {
    const server = new FakeServer();
    let inside = 0;
    let overlapped = false;
    const events: string[] = [];
    const slow = (name: string) => async () => {
      inside++;
      if (inside > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      events.push(name);
      inside--;
    };
    const lock = new LeaderLock({ createClient: () => new FakeClient(server), logger: logger(), onAcquired: slow("acquired"), onLost: slow("lost") });
    lock.start();
    for (let i = 0; i < 4; i++) {
      await advance(100);
      server.clients.at(-1)!.drop(); // drops while onAcquired may still be running
      await advance(7_000);
    }
    const stopped = lock.stop();
    await advance(10_000); // the slow callbacks' timers
    await stopped;
    expect(overlapped).toBe(false);
    expect(events.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < events.length; i++) expect(events[i]).toBe(i % 2 === 0 ? "acquired" : "lost");
    expect(events.at(-1)).toBe("lost");
  });

  it("stop during acquisition: the lock taken mid-stop is released and no worker starts", async () => {
    const server = new FakeServer();
    let release!: () => void;
    server.hang = new Promise<void>((resolve) => (release = resolve));
    const { lock, events } = lockOn(server);
    lock.start();
    await advance(0); // the try-lock query is in flight
    const stopped = lock.stop();
    server.hang = undefined;
    release();
    await stopped;
    expect(events).toEqual([]);
    expect(lock.isLeader()).toBe(false);
    expect(server.holder).toBeUndefined();
    expect(server.clients[0]!.ended).toBe(true);
  });

  it("stop is idempotent, and a stopped lock never starts again", async () => {
    const server = new FakeServer();
    const { lock, events } = lockOn(server);
    lock.start();
    await advance(0);
    const first = lock.stop();
    expect(lock.stop()).toBe(first);
    await first;
    lock.start();
    await advance(10_000);
    expect(events).toEqual(["acquired", "lost"]);
    expect(server.clients).toHaveLength(1);
  });

  it("stop before the first tick creates no client", async () => {
    const server = new FakeServer();
    const { lock } = lockOn(server);
    lock.start();
    await lock.stop();
    await advance(10_000);
    expect(server.clients).toHaveLength(0);
  });

  it("a throwing callback is logged and the loop keeps going", async () => {
    const server = new FakeServer();
    const { lock, log } = lockOn(server, {
      onAcquired: () => {
        throw new TypeError("bad");
      },
    });
    lock.start();
    await advance(0);
    expect(log.error).toHaveBeenCalledWith({ callback: "onAcquired", error: "TypeError" }, expect.any(String));
    expect(lock.isLeader()).toBe(true);
    await advance(5_000);
    expect(server.clients[0]!.queries).toContain("SELECT 1");
    await lock.stop();
  });

  it("never logs a driver message (codes only)", async () => {
    const server = new FakeServer();
    server.connectError = Object.assign(new Error("password authentication failed for user secret"), { code: "28P01" });
    const { lock, log } = lockOn(server);
    lock.start();
    await advance(0);
    await lock.stop();
    expect(JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls])).not.toContain("secret");
  });
});
