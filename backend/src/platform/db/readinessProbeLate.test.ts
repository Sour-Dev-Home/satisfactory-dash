import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { Database } from "./database.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Gaps the main probe suite leaves: an acquire that never settles, and a probe that fails AFTER the
// budget already expired (the late rejection must be swallowed and the connection destroyed once).
function setup(mode: "never" | "lateQueryFail") {
  const released: unknown[] = [];
  const warns: object[] = [];
  const logger = { warn: (o: object) => warns.push(o), error: vi.fn(), info: vi.fn() };
  let healthy = false;
  const pool = {
    connect: async () => {
      if (healthy && mode === "never") {
        return new Promise(() => {});
      }
      return {
        query: async () => {
          if (healthy) {
            await delay(160);
            throw new Error("secret connection detail");
          }
          return { rows: [{}] };
        },
        release: (a?: unknown) => released.push(a),
      };
    },
    query: async () => ({ rows: [{}] }),
    end: async () => {},
    on: () => {},
  } as unknown as Pool;
  const config = { url: "postgres://u:p@h/d", poolMax: 2, statementTimeoutMs: 1000, connectionTimeoutMs: 100, readinessTimeoutMs: 100 };
  const database = new Database(config, logger, { sleep: async () => {}, now: () => 0 }, pool);
  return { database, released, warns, go: () => (healthy = true) };
}

describe("readiness probe late paths", () => {
  it("connect() that never settles: false, one warn, nothing to release", async () => {
    const s = setup("never");
    await s.database.start();
    s.go();
    expect(await s.database.isReady()).toBe(false);
    expect(s.warns).toHaveLength(1);
    expect(s.released).toHaveLength(0);
  });

  it("query fails after the budget: one warn, late rejection swallowed, connection destroyed exactly once", async () => {
    const s = setup("lateQueryFail");
    await s.database.start();
    s.go();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    // Budget 100 ms; the query fails at 160 ms, after the budget already gave up.
    expect(await s.database.isReady()).toBe(false);
    await delay(250);
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(s.warns).toHaveLength(1);
    expect(JSON.stringify(s.warns)).not.toContain("secret");
    expect(s.released).toHaveLength(1);
    expect(s.released[0]).toBeInstanceOf(Error);
  });
});
