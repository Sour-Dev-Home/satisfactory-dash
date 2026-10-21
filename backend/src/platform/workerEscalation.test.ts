import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { CommandSweeper } from "../modules/agents/services/commandSweeper.js";
import { HistoryMaintenanceWorker } from "../modules/telemetry/services/historyMaintenanceWorker.js";
import { createSessionPurgeWorker } from "../modules/identity/sessionPurge.js";

// #560: each worker that adopted FailureStreak escalates once at its N and recovers with a count (fresh-eyes gap tests).
const log = () => {
  const fn = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return fn;
};
const failingDb = { query: vi.fn(async () => { throw new Error("db down at secret-host"); }) };
const okDb = { query: vi.fn(async () => ({ rows: [{ deleted: 0 }], rowCount: 0 })) };
const errorCalls = (l: ReturnType<typeof log>) => l.error.mock.calls.filter(([, msg]) => msg === "background worker keeps failing");

describe("CommandSweeper escalation", () => {
  it("one error at the 20th failed sweep (5 min at 15 s), none before, none after; recovery carries the count", async () => {
    const l = log();
    const db = { query: vi.fn(async () => { throw new Error("x"); }) };
    const sweeper = new CommandSweeper(db, { logger: l as unknown as Logger });
    for (let i = 0; i < 19; i++) await sweeper.sweep();
    expect(l.error).not.toHaveBeenCalled();
    expect(l.warn).toHaveBeenCalledTimes(1);
    await sweeper.sweep();
    expect(errorCalls(l)).toHaveLength(1);
    expect(errorCalls(l)[0][0]).toMatchObject({ code: "WORKER_FAILING", job: "command-sweeper", failures: 20 });
    for (let i = 0; i < 10; i++) await sweeper.sweep();
    expect(errorCalls(l)).toHaveLength(1);
    db.query.mockImplementation((async () => ({ rows: [], rowCount: 0 })) as never);
    await sweeper.sweep();
    expect(l.info).toHaveBeenCalledWith({ failedSweeps: 30 }, "command sweeping recovered");
  });
});

describe("HistoryMaintenanceWorker escalation", () => {
  it("escalates once at the 5th failed run (60 s interval); one success in between restarts the streak", async () => {
    const l = log();
    const db = { query: vi.fn(async () => { throw new Error("x"); }) };
    const worker = new HistoryMaintenanceWorker(db, { logger: l as unknown as Logger });
    for (let i = 0; i < 4; i++) await worker.runOnce();
    expect(l.error).not.toHaveBeenCalled();
    db.query.mockImplementation((async () => ({ rows: [], rowCount: 0 })) as never);
    await worker.runOnce();
    expect(l.info).toHaveBeenCalledWith({ failedRuns: 4 }, "history maintenance recovered");
    db.query.mockImplementation((async () => { throw new Error("x"); }) as never);
    for (let i = 0; i < 4; i++) await worker.runOnce();
    expect(l.error).not.toHaveBeenCalled(); // interrupted by a success: the count restarted
    await worker.runOnce();
    expect(errorCalls(l)).toHaveLength(1);
  });
});

describe("session and audit purge escalation", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }));
  afterEach(() => vi.useRealTimers());

  it("escalates on the 2nd consecutive hourly failure, once each for the session purge, the retention sweep and the audit purge, with no error detail", async () => {
    const l = log();
    const worker = createSessionPurgeWorker(failingDb, l);
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    const jobs = errorCalls(l).map(([obj]) => (obj as { job: string }).job).sort();
    expect(jobs).toEqual(["audit-purge", "retention-sweep", "session-purge"]);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(errorCalls(l)).toHaveLength(3);
    expect(JSON.stringify([...l.warn.mock.calls, ...l.error.mock.calls])).not.toContain("secret-host");
    await worker.stop();
  });

  it("a healthy database never escalates and logs no recovery", async () => {
    const l = log();
    const worker = createSessionPurgeWorker(okDb, l);
    worker.start();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(l.error).not.toHaveBeenCalled();
    expect(l.warn).not.toHaveBeenCalled();
    await worker.stop();
  });
});
