import { describe, it, expect, vi } from "vitest";
import { AUDIT_PURGE_INTERVAL_MS, PURGE_INTERVAL_MS, createSessionPurgeWorker } from "./sessionPurge.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";

// The hourly purge worker also sweeps tables with no cleanup of their own and, once a day, logs the top table sizes.
function build() {
  let sizeCalls = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("agents.enrollment_codes")) return { rows: [{ deleted: 3 }] };
    if (sql.includes("pg_class")) {
      sizeCalls++;
      return { rows: [{ table_name: "telemetry.power_rollups", mb: 12.5 }] };
    }
    return { rows: [{ deleted: 0 }] };
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let clock = 1_000_000;
  const worker = createSessionPurgeWorker({ query } as unknown as Queryable, logger, () => clock);
  return { worker, logger, sizeCalls: () => sizeCalls, advance: (ms: number) => void (clock += ms) };
}

describe("retention sweeps in the purge worker", () => {
  it("logs counts once per run (never per row) and the table sizes once a day", async () => {
    vi.useFakeTimers();
    try {
      const h = build();
      h.worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.logger.info).toHaveBeenCalledWith(
        { enrollmentCodes: 3, serverMutes: 0, outbox: 0 },
        "swept expired enrollment codes, passed mutes and finished alert deliveries",
      );
      expect(h.logger.info).toHaveBeenCalledWith({ tablesMb: { "telemetry.power_rollups": 12.5 } }, "top table sizes (MB)");
      for (let hour = 0; hour < 3; hour++) {
        h.advance(PURGE_INTERVAL_MS);
        await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS);
      }
      expect(h.sizeCalls()).toBe(1);
      h.advance(AUDIT_PURGE_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS);
      expect(h.sizeCalls()).toBe(2);
      await h.worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
