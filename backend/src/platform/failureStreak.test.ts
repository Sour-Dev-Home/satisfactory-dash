import { describe, expect, it, vi } from "vitest";
import { FAILURE_ESCALATION_WINDOW_MS, FailureStreak, WORKER_FAILING_CODE, WORKER_FAILING_MSG, failuresForWindow } from "./failureStreak.js";

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const streak = (log: ReturnType<typeof logger>, escalateAfter = 3) =>
  new FailureStreak({ logger: log, job: "test-job", escalateAfter, failedMsg: "it failed", recoveredMsg: "it recovered" });

describe("failuresForWindow", () => {
  it("is about five minutes of attempts at the worker's interval, never fewer than 2", () => {
    expect(FAILURE_ESCALATION_WINDOW_MS).toBe(300_000);
    expect(failuresForWindow(10_000)).toBe(30);
    expect(failuresForWindow(15_000)).toBe(20);
    expect(failuresForWindow(30_000)).toBe(10);
    expect(failuresForWindow(60_000)).toBe(5);
    expect(failuresForWindow(70_000)).toBe(5); // rounds up
    expect(failuresForWindow(10 * 60_000)).toBe(2);
    expect(failuresForWindow(60 * 60_000)).toBe(2);
  });

  it("survives a nonsense interval", () => {
    expect(failuresForWindow(0)).toBe(300_000);
    expect(failuresForWindow(-5)).toBe(300_000);
    expect(failuresForWindow(Number.NaN)).toBe(300_000);
    expect(failuresForWindow(1000, 1000)).toBe(2);
  });
});

describe("FailureStreak", () => {
  it("below N: warns once with the worker's fields, and logs no error", () => {
    const log = logger();
    const s = streak(log);
    s.failure({ err: "boom" });
    s.failure({ err: "boom" });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith({ err: "boom" }, "it failed");
    expect(log.error).not.toHaveBeenCalled();
    expect(s.failures).toBe(2);
    expect(s.failing).toBe(true);
  });

  it("at N: one error line with the code, job and count; nothing more however long it lasts", () => {
    const log = logger();
    const s = streak(log);
    for (let i = 0; i < 10; i++) s.failure({ err: "boom", code: "OWN_CODE" });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith({ err: "boom", code: WORKER_FAILING_CODE, job: "test-job", failures: 3 }, WORKER_FAILING_MSG);
    expect(log.info).not.toHaveBeenCalled();
  });

  it("recovery: one info line with the streak length, then quiet while healthy", () => {
    const log = logger();
    const s = streak(log);
    s.failure();
    s.failure();
    s.failure();
    s.failure();
    s.success();
    s.success();
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith({ failures: 4 }, "it recovered");
    expect(s.failing).toBe(false);
    expect(s.failures).toBe(0);
  });

  it("a short streak recovers without ever escalating", () => {
    const log = logger();
    const s = streak(log);
    s.failure();
    s.success();
    expect(log.error).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith({ failures: 1 }, "it recovered");
  });

  it("a new streak after a recovery warns and escalates again", () => {
    const log = logger();
    const s = streak(log);
    for (let i = 0; i < 3; i++) s.failure();
    s.success();
    for (let i = 0; i < 3; i++) s.failure();
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it("success with no streak logs nothing", () => {
    const log = logger();
    streak(log).success();
    expect(log.info).not.toHaveBeenCalled();
  });

  it("uses the worker's own count field on the recovery line", () => {
    const log = logger();
    const s = new FailureStreak({ logger: log, job: "j", escalateAfter: 5, failedMsg: "f", recoveredMsg: "r", countField: "failedRuns" });
    s.failure();
    s.success();
    expect(log.info).toHaveBeenCalledWith({ failedRuns: 1 }, "r");
  });

  it("N = 1 escalates on the first failure, with no separate warning", () => {
    const log = logger();
    const s = streak(log, 1);
    s.failure();
    s.failure();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});
