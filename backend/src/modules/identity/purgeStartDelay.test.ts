import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ConfigError } from "../../platform/errors.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { DEFAULT_PURGE_START_DELAY_MS, PURGE_INTERVAL_MS, createSessionPurgeWorker, loadPurgeStartDelayMs } from "./sessionPurge.js";

// Issue #153: on the Windows host a new process's first connections can time out, so the purge worker starts only
// after the database startup check has succeeded (server.ts) and then waits before its first run.
function build(delayMs: number) {
  const query = vi.fn(async () => ({ rows: [{ deleted: "0" }] }));
  const logger = { info: vi.fn(), warn: vi.fn() };
  const worker = createSessionPurgeWorker({ query } as unknown as Queryable, logger, Date.now, { initialDelayMs: delayMs });
  return { worker, query, logger };
}

describe("purge worker start delay", () => {
  it("does nothing when created, and nothing at start() until the delay has passed; then runs once", async () => {
    vi.useFakeTimers();
    try {
      const { worker, query } = build(30_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(query).not.toHaveBeenCalled(); // created but not started: no database use at all
      worker.start();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(query).not.toHaveBeenCalled(); // still inside the delay
      await vi.advanceTimersByTimeAsync(1);
      const firstRun = query.mock.calls.length;
      expect(firstRun).toBeGreaterThan(0); // the first run happened
      await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS - 1);
      expect(query.mock.calls.length).toBe(firstRun); // and only once until the next hourly tick
      await worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starting twice does not run twice or double the timers", async () => {
    vi.useFakeTimers();
    try {
      const once = build(1000);
      const twice = build(1000);
      once.worker.start();
      twice.worker.start();
      twice.worker.start(); // must change nothing
      await vi.advanceTimersByTimeAsync(1000 + PURGE_INTERVAL_MS * 2);
      expect(twice.query.mock.calls.length).toBe(once.query.mock.calls.length);
      expect(once.query.mock.calls.length).toBeGreaterThan(0);
      await once.worker.stop();
      await twice.worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() during the delay means it never runs", async () => {
    vi.useFakeTimers();
    try {
      const { worker, query } = build(30_000);
      worker.start();
      await vi.advanceTimersByTimeAsync(10_000);
      await worker.stop();
      await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS * 3);
      expect(query).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() then start() during the delay restarts the delay once; the old timer never fires", async () => {
    vi.useFakeTimers();
    try {
      const { worker, query } = build(30_000);
      worker.start();
      await vi.advanceTimersByTimeAsync(20_000);
      await worker.stop();
      worker.start();
      await vi.advanceTimersByTimeAsync(20_000); // the old timer would have fired at 30 s
      expect(query).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(query).toHaveBeenCalled();
      await worker.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a delay of 0 runs immediately (the old behaviour)", async () => {
    vi.useFakeTimers();
    try {
      const { worker, query } = build(0);
      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(query).toHaveBeenCalled();
      await worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a real failure after the delay still warns exactly as before", async () => {
    vi.useFakeTimers();
    try {
      const query = vi.fn(async () => {
        throw new Error("connect ECONNREFUSED SECRETDETAIL");
      });
      const logger = { info: vi.fn(), warn: vi.fn() };
      const worker = createSessionPurgeWorker({ query } as unknown as Queryable, logger, Date.now, { initialDelayMs: 5000 });
      worker.start();
      await vi.advanceTimersByTimeAsync(5000);
      expect(logger.warn).toHaveBeenCalledTimes(2); // the session purge and the audit purge, as today
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("SECRETDETAIL");
      await worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PURGE_START_DELAY_MS", () => {
  it("defaults to 30 s when unset or blank and accepts 0-600000", () => {
    expect(DEFAULT_PURGE_START_DELAY_MS).toBe(30_000);
    expect(loadPurgeStartDelayMs({})).toBe(30_000);
    expect(loadPurgeStartDelayMs({ PURGE_START_DELAY_MS: "  " })).toBe(30_000);
    expect(loadPurgeStartDelayMs({ PURGE_START_DELAY_MS: "0" })).toBe(0);
    expect(loadPurgeStartDelayMs({ PURGE_START_DELAY_MS: "600000" })).toBe(600_000);
  });

  it.each(["600001", "-1", "1.5", "soon", "1e3", "0x10"])("rejects %s with a ConfigError naming the variable", (value) => {
    expect(() => loadPurgeStartDelayMs({ PURGE_START_DELAY_MS: value })).toThrow(ConfigError);
    expect(() => loadPurgeStartDelayMs({ PURGE_START_DELAY_MS: value })).toThrow(/PURGE_START_DELAY_MS/);
  });
});

// The ordering itself lives in the composition root, which tests cannot start (NODE_ENV=test skips listen), so
// this pins its shape: the identity workers are NOT in the list started at boot, and they are started inside the
// database startup success path.
describe("server.ts ordering (issue #153)", () => {
  const source = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");

  it("does not start the identity workers at boot", () => {
    expect(source).not.toMatch(/workers\.push\(\s*\.\.\.identity\.workers\s*\)/);
  });

  it("starts them only after the database check succeeded and the servers were registered (the sequencing is platform/bootSequence.ts, whose own tests pin the order; server.ts hands it the workers)", () => {
    const sequence = readFileSync(new URL("../../platform/bootSequence.ts", import.meta.url), "utf8");
    const databaseStartAt = sequence.indexOf("deps.database\n    .start()");
    const loadAt = sequence.indexOf(".then(() => deps.loadServers())");
    const workersAt = sequence.indexOf("for (const worker of deps.databaseWorkers)");
    expect(databaseStartAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(databaseStartAt);
    expect(workersAt).toBeGreaterThan(loadAt);
    expect(source).toMatch(/bootSequence\(\{[\s\S]*databaseWorkers,/); // server.ts passes the database workers to it
    expect(source).toContain('logger.info({ registered }, "configured servers registered")'); // the load step registers the configured servers
    expect(source).not.toContain("for (const worker of databaseWorkers)"); // and no longer starts them itself
  });

  it("stops them on shutdown with the other workers", () => {
    expect(source).toMatch(/\[\.\.\.workers, \.\.\.databaseWorkers\]\.map\(\(worker\) => worker\.stop\(\)\)/);
  });
});
