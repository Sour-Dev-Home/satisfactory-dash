import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaderLock } from "./leaderLock.js";
import type { LeaderLockClient } from "./leaderLock.js";

class Srv {
  holder: Cl | undefined;
  clients: Cl[] = [];
  connectGate: Promise<void> | undefined;
  connectFail: Error | undefined;
}
class Cl implements LeaderLockClient {
  ended = false;
  private l: ((e: Error) => void) | undefined;
  constructor(private readonly s: Srv) {
    s.clients.push(this);
  }
  async connect(): Promise<void> {
    if (this.s.connectGate) await this.s.connectGate;
    if (this.s.connectFail) throw this.s.connectFail;
  }
  async query(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    if (this.ended) throw new Error("closed");
    if (sql.includes("pg_try_advisory_lock")) {
      if (this.s.holder === undefined || this.s.holder === this) {
        this.s.holder = this;
        return { rows: [{ locked: true }] };
      }
      return { rows: [{ locked: false }] };
    }
    if (sql.includes("pg_advisory_unlock")) {
      if (this.s.holder === this) this.s.holder = undefined;
      return { rows: [{ unlocked: true }] };
    }
    return { rows: [{}] };
  }
  async end(): Promise<void> {
    this.ended = true;
    if (this.s.holder === this) this.s.holder = undefined;
  }
  on(_e: "error", l: (e: Error) => void): void {
    this.l = l;
  }
  emitError(): void {
    this.l?.(new Error("boom"));
  }
}
const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("LeaderLock transition races", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stop while connect() is in flight: nothing acquired, client closed, no timer left", async () => {
    const s = new Srv();
    let open!: () => void;
    s.connectGate = new Promise<void>((r) => (open = r));
    const events: string[] = [];
    const lock = new LeaderLock({ createClient: () => new Cl(s), logger: log(), onAcquired: () => void events.push("a"), onLost: () => void events.push("l") });
    lock.start();
    await advance(0);
    const stopped = lock.stop();
    open();
    await stopped;
    await advance(30_000);
    expect(events).toEqual([]);
    expect(s.holder).toBeUndefined();
    expect(s.clients).toHaveLength(1);
    expect(s.clients[0]!.ended).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop while connect() is failing: client closed, no retry afterwards", async () => {
    const s = new Srv();
    let open!: () => void;
    s.connectGate = new Promise<void>((r) => (open = r));
    s.connectFail = new Error("refused");
    const lock = new LeaderLock({ createClient: () => new Cl(s), logger: log(), onAcquired: () => undefined, onLost: () => undefined });
    lock.start();
    await advance(0);
    const stopped = lock.stop();
    open();
    await stopped;
    await advance(30_000);
    expect(s.clients).toHaveLength(1);
    expect(s.clients[0]!.ended).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop while onAcquired is running: waits for it, then onLost, then releases the lock", async () => {
    const s = new Srv();
    const events: string[] = [];
    let finish!: () => void;
    const lock = new LeaderLock({
      createClient: () => new Cl(s),
      logger: log(),
      onAcquired: async () => {
        events.push("a-start");
        await new Promise<void>((r) => (finish = r));
        events.push("a-end");
      },
      onLost: () => void events.push("lost"),
    });
    lock.start();
    await advance(0);
    const stopped = lock.stop();
    await advance(10);
    expect(events).toEqual(["a-start"]);
    finish();
    await stopped;
    expect(events).toEqual(["a-start", "a-end", "lost"]);
    expect(s.holder).toBeUndefined();
    expect(lock.isLeader()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an 'error' event while onAcquired runs, then stop: acquired, lost once, lock free", async () => {
    const s = new Srv();
    const events: string[] = [];
    let finish!: () => void;
    const lock = new LeaderLock({
      createClient: () => new Cl(s),
      logger: log(),
      onAcquired: async () => {
        events.push("a");
        await new Promise<void>((r) => (finish = r));
      },
      onLost: () => void events.push("l"),
    });
    lock.start();
    await advance(0);
    s.clients[0]!.emitError();
    const stopped = lock.stop();
    finish();
    await stopped;
    await advance(30_000);
    expect(events).toEqual(["a", "l"]);
    expect(s.holder).toBeUndefined();
    expect(s.clients.every((c) => c.ended)).toBe(true);
  });

  it("an error event on a client after stop() is harmless (no callbacks, no throw)", async () => {
    const s = new Srv();
    const events: string[] = [];
    const lock = new LeaderLock({ createClient: () => new Cl(s), logger: log(), onAcquired: () => void events.push("a"), onLost: () => void events.push("l") });
    lock.start();
    await advance(0);
    await lock.stop();
    s.clients[0]!.emitError();
    await advance(10_000);
    expect(events).toEqual(["a", "l"]);
  });

  it("a stale client's error never demotes the new leader", async () => {
    const s = new Srv();
    const events: string[] = [];
    const lock = new LeaderLock({ createClient: () => new Cl(s), logger: log(), onAcquired: () => void events.push("a"), onLost: () => void events.push("l") });
    lock.start();
    await advance(0);
    s.clients[0]!.emitError();
    await advance(5_000);
    expect(lock.isLeader()).toBe(true);
    s.clients[0]!.emitError();
    s.clients[0]!.emitError();
    await advance(0);
    expect(events).toEqual(["a", "l", "a"]);
    await lock.stop();
  });

  it("rapid repeated errors on the live client give one onLost", async () => {
    const s = new Srv();
    const events: string[] = [];
    const lock = new LeaderLock({ createClient: () => new Cl(s), logger: log(), onAcquired: () => void events.push("a"), onLost: () => void events.push("l") });
    lock.start();
    await advance(0);
    for (let i = 0; i < 5; i++) s.clients[0]!.emitError();
    await advance(0);
    expect(events).toEqual(["a", "l"]);
    await lock.stop();
  });

  it("an error while a follower does not call onLost", async () => {
    const s = new Srv();
    s.holder = new Cl(s);
    const events: string[] = [];
    const lock = new LeaderLock({ createClient: () => new Cl(s), logger: log(), onAcquired: () => void events.push("a"), onLost: () => void events.push("l") });
    lock.start();
    await advance(0);
    s.clients[1]!.emitError();
    await advance(0);
    expect(events).toEqual([]);
    await lock.stop();
  });
});
