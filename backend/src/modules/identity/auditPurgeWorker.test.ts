import { describe, it, expect, vi } from "vitest";
import { AUDIT_PURGE_INTERVAL_MS, PURGE_INTERVAL_MS, createSessionPurgeWorker } from "./sessionPurge.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";

// The audit trail is kept one year (privacy policy). The worker calls the SECURITY DEFINER function once a
// day, logs the count, and a failure there never affects the session purge or a request.
function build(auditResult: () => { rows: unknown[] } | Error) {
  let auditCalls = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("audit.purge_expired_events")) {
      auditCalls++;
      const out = auditResult();
      if (out instanceof Error) {
        throw out;
      }
      return out;
    }
    return { rows: [] }; // sessions and login attempts: nothing to purge
  });
  const logger = { info: vi.fn(), warn: vi.fn() };
  let clock = 1_000_000;
  const worker = createSessionPurgeWorker({ query } as unknown as Queryable, logger, () => clock);
  return { worker, logger, calls: () => auditCalls, advance: (ms: number) => void (clock += ms) };
}

describe("audit purge in the purge worker", () => {
  it("runs at startup, logs the count when something was deleted, and stays silent when nothing was", async () => {
    vi.useFakeTimers();
    try {
      const h = build(() => ({ rows: [{ deleted: "42" }] }));
      h.worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.calls()).toBe(1);
      expect(h.logger.info).toHaveBeenCalledWith({ auditEvents: 42 }, "purged audit events older than one year");
      await h.worker.stop();
      const quiet = build(() => ({ rows: [{ deleted: "0" }] }));
      quiet.worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(quiet.logger.info).not.toHaveBeenCalled();
      await quiet.worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs at most once a day even though the worker ticks hourly", async () => {
    vi.useFakeTimers();
    try {
      const h = build(() => ({ rows: [{ deleted: "0" }] }));
      h.worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.calls()).toBe(1);
      for (let hour = 0; hour < 5; hour++) {
        h.advance(PURGE_INTERVAL_MS);
        await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS);
      }
      expect(h.calls()).toBe(1); // five hourly ticks later: still the same day
      h.advance(AUDIT_PURGE_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS);
      expect(h.calls()).toBe(2); // a day on: again
      await h.worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failing audit purge warns with no detail and is retried at the next tick, without breaking anything", async () => {
    vi.useFakeTimers();
    try {
      let fail = true;
      const h = build(() => (fail ? new Error("connect ECONNREFUSED 10.9.8.7 SECRETDETAIL") : { rows: [{ deleted: "3" }] }));
      h.worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.logger.warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain("SECRETDETAIL");
      fail = false;
      h.advance(PURGE_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS);
      expect(h.calls()).toBe(2); // a failed attempt does not start the 24 h wait
      expect(h.logger.info).toHaveBeenCalledWith({ auditEvents: 3 }, "purged audit events older than one year");
      await h.worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
