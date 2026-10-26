import { afterEach, describe, expect, it, vi } from "vitest";
import { orderedShutdown } from "./shutdown.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("orderedShutdown (ADR-0054 D3.10)", () => {
  it("releases the leader lock only after the HTTP server has closed, and closes the database last", async () => {
    const order: string[] = [];
    let closeHttp!: () => void;
    const httpClosed = new Promise<void>((resolve) => (closeHttp = resolve)).then(() => order.push("http closed"));
    const done = orderedShutdown({
      stopWorkers: async () => void order.push("workers stopped"),
      httpClosed,
      releaseLeaderLock: async () => void order.push("lock released"),
      closeDatabase: async () => void order.push("database closed"),
      timeoutMs: 10_000,
    });
    // A request is still draining: the lock must still be held.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["workers stopped"]);
    closeHttp();
    await done;
    expect(order).toEqual(["workers stopped", "http closed", "lock released", "database closed"]);
  });

  it("a step that fails never stops the next: the lock is still released and the database still closed", async () => {
    const releaseLeaderLock = vi.fn(async () => undefined);
    const closeDatabase = vi.fn(async () => undefined);
    await orderedShutdown({
      stopWorkers: () => {
        throw new Error("a worker would not stop");
      },
      httpClosed: Promise.reject(new Error("close failed")),
      releaseLeaderLock,
      closeDatabase,
      timeoutMs: 10_000,
    });
    expect(releaseLeaderLock).toHaveBeenCalledTimes(1);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
  });

  it("resolves at the time limit when the HTTP server never closes", async () => {
    vi.useFakeTimers();
    const releaseLeaderLock = vi.fn(async () => undefined);
    const done = orderedShutdown({
      stopWorkers: async () => undefined,
      httpClosed: new Promise(() => undefined),
      releaseLeaderLock,
      closeDatabase: async () => undefined,
      timeoutMs: 8_000,
    });
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(done).resolves.toBeUndefined();
    // Never released early: the process exit frees the session-scoped lock.
    expect(releaseLeaderLock).not.toHaveBeenCalled();
  });
});
