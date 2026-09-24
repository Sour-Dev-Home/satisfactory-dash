import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import type { PoolClient } from "pg";
import { withTransaction } from "./transaction.js";

function fakePool(options: { failOn?: string; emitErrorDuring?: string } = {}) {
  const log: string[] = [];
  const emitter = new EventEmitter();
  const client = Object.assign(emitter, {
    async query(text: string) {
      log.push(text);
      if (text === options.emitErrorDuring) {
        emitter.emit("error", new Error("connection lost"));
      }
      if (text === options.failOn) {
        throw new Error(`${text} failed`);
      }
      return { rows: [] };
    },
    release(destroy?: boolean) {
      log.push(`release(${destroy ? "destroy" : ""})`);
    },
  }) as unknown as PoolClient;
  return { log, client, pool: { connect: async () => client } };
}

describe("withTransaction", () => {
  it("BEGIN, runs fn on the client, COMMIT, releases, and returns fn's value", async () => {
    const { pool, log } = fakePool();
    const value = await withTransaction(pool, async (client) => {
      await client.query("SELECT 1");
      return 42;
    });
    expect(value).toBe(42);
    expect(log).toEqual(["BEGIN", "SELECT 1", "COMMIT", "release()"]);
  });

  it("ROLLBACK, release and rethrow the ORIGINAL error when fn throws", async () => {
    const { pool, log } = fakePool();
    const original = new Error("nope");
    await expect(
      withTransaction(pool, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(log).toEqual(["BEGIN", "ROLLBACK", "release()"]);
  });

  it("rolls back when COMMIT itself fails", async () => {
    const { pool, log } = fakePool({ failOn: "COMMIT" });
    await expect(withTransaction(pool, async () => 1)).rejects.toThrow("COMMIT failed");
    expect(log).toEqual(["BEGIN", "COMMIT", "ROLLBACK", "release()"]);
  });

  it("destroys the connection (release(true)) when ROLLBACK fails, keeping the original error", async () => {
    const { pool, log } = fakePool({ failOn: "ROLLBACK" });
    const original = new Error("nope");
    await expect(
      withTransaction(pool, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(log).toEqual(["BEGIN", "ROLLBACK", "release(destroy)"]);
  });

  it("guards the checked-out client against an 'error' event and destroys a client that errored", async () => {
    const { pool, log, client } = fakePool({ emitErrorDuring: "SELECT 1" });
    // With no listener, EventEmitter would throw on 'error' (in pg: an uncaught exception).
    await expect(
      withTransaction(pool, async (c) => {
        await c.query("SELECT 1");
        return "done";
      }),
    ).resolves.toBe("done");
    expect(log.at(-1)).toBe("release(destroy)");
    expect(client.listenerCount("error")).toBe(0); // its own listener is removed again
  });

  it("releases even when BEGIN fails", async () => {
    const { pool, log } = fakePool({ failOn: "BEGIN" });
    await expect(withTransaction(pool, async () => 1)).rejects.toThrow("BEGIN failed");
    expect(log.at(-1)).toMatch(/^release/);
  });
});
