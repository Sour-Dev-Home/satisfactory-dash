import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { BufferedHistoryRecorder, sessionKey } from "./historyRecorder.js";
import { createMetricsAggregator, type MetricsSink } from "../../../platform/metrics/index.js";

const logger = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) as unknown as Logger & { warn: ReturnType<typeof vi.fn> };

const powerRow = (atMs: number) => ({
  session: 1,
  circuit: 1,
  atMs,
  productionMW: 10,
  consumptionMW: 5,
  capacityMW: 20,
  batteryPercent: 0,
  fuseTripped: false,
});

function fakeDb(fail = false) {
  const calls: unknown[][] = [];
  const db: Queryable = {
    query: vi.fn(async (_sql: string, params?: unknown[]) => {
      if (fail) throw new Error("db down");
      calls.push(params ?? []);
      return { rows: [] };
    }),
  } as unknown as Queryable;
  return { db, calls };
}

describe("sessionKey", () => {
  it("is stable, 32-bit and differs between names", () => {
    expect(sessionKey("Alpha")).toBe(sessionKey("Alpha"));
    expect(sessionKey("Alpha")).not.toBe(sessionKey("Beta"));
    expect(Number.isInteger(sessionKey("Alpha"))).toBe(true);
    expect(Math.abs(sessionKey("a fairly long session name"))).toBeLessThanOrEqual(2 ** 31);
  });
});

describe("BufferedHistoryRecorder", () => {
  it("writes buffered rows in one statement per kind on flush, and nothing when empty", async () => {
    const { db, calls } = fakeDb();
    const recorder = new BufferedHistoryRecorder(db, "srv", { logger: logger() });
    await recorder.flush();
    expect(calls).toHaveLength(0);
    recorder.recordPower([powerRow(1), powerRow(2)]);
    await recorder.flush();
    expect(calls).toHaveLength(1);
    await recorder.flush();
    expect(calls).toHaveLength(1); // buffer was emptied
  });

  it("keeps rows after a failed flush, retries them, and logs only the first failure", async () => {
    const failing = fakeDb(true);
    const log = logger();
    const recorder = new BufferedHistoryRecorder(failing.db, "srv", { logger: log });
    recorder.recordPower([powerRow(1)]);
    await recorder.flush();
    await recorder.flush();
    expect(failing.db.query).toHaveBeenCalledTimes(2); // the row was retried
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("drops the oldest rows beyond the bound", async () => {
    const failing = fakeDb(true);
    const recorder = new BufferedHistoryRecorder(failing.db, "srv", { logger: logger(), maxBuffered: 3 });
    recorder.recordPower([powerRow(1), powerRow(2), powerRow(3), powerRow(4), powerRow(5)]);
    await recorder.flush();
    const ok = fakeDb();
    // Swap in a working db by constructing a recorder that shares nothing: assert via the failed call's params instead.
    const params = (failing.db.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as unknown[][];
    expect(params[3]).toEqual([3, 4, 5]); // the at_ms column: only the newest three were written
    expect(ok.calls).toHaveLength(0);
  });

  it("stop() while a timer flush is in flight still writes rows recorded meanwhile", async () => {
    const writes: number[][] = [];
    let release: (() => void) | undefined;
    let first = true;
    const db = {
      query: vi.fn(async (_sql: string, params?: unknown[][]) => {
        if (first) {
          first = false;
          await new Promise<void>((resolve) => (release = resolve));
        }
        writes.push(params?.[3] as number[]);
        return { rows: [] };
      }),
    } as unknown as Queryable;
    const recorder = new BufferedHistoryRecorder(db, "srv", { logger: logger() });
    recorder.recordPower([powerRow(1)]);
    const inFlight = recorder.flush();
    recorder.recordPower([powerRow(2)]); // arrives while the first write is pending
    const stopping = recorder.stop();
    release?.();
    await Promise.all([inFlight, stopping]);
    expect(writes.flat()).toEqual([1, 2]);
  });

  it("does not store a transition batch in several statements (a half-failed retry would duplicate events)", async () => {
    const { db, calls } = fakeDb();
    const recorder = new BufferedHistoryRecorder(db, "srv", { logger: logger() });
    recorder.recordTransitions(
      Array.from({ length: 12_000 }, (_, i) => ({ atMs: i, buildingId: `b${i}`, className: "c", fromState: null, toState: "working" })),
    );
    await recorder.flush();
    expect(calls).toHaveLength(1);
  });

  it("never rejects, and stop() does a final flush", async () => {
    const { db, calls } = fakeDb();
    const recorder = new BufferedHistoryRecorder(db, "srv", { logger: logger() });
    recorder.start();
    recorder.recordPower([powerRow(1)]);
    await expect(recorder.stop()).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    recorder.recordPower([powerRow(2)]); // after stop: ignored
    await recorder.flush();
    expect(calls).toHaveLength(1);
  });
});

describe("BufferedHistoryRecorder metrics (ADR-0037 build step 3)", () => {
  const itemRow = (atMs: number) => ({ item: "Desc_IronPlate_C", atMs, currentPerMinute: 10, maxPerMinute: 20 });
  const transitionRow = (atMs: number) => ({ atMs, buildingId: "b1", className: "Build_Constructor_C", fromState: null, toState: "producing" });

  /** A database whose writes to one table can be made to fail. */
  function tableDb(failTable?: string) {
    return {
      query: vi.fn(async (sql: string) => {
        if (failTable !== undefined && sql.includes(`telemetry.${failTable}`)) throw new Error("db down");
        return { rows: [] };
      }),
    } as unknown as Queryable;
  }
  const written = (metrics: ReturnType<typeof createMetricsAggregator>) =>
    Object.fromEntries(
      metrics
        .drain()
        .filter((delta) => delta.metric === "satis.history.rows_written")
        .map((delta) => [delta.labels.table, delta.sum]),
    );

  it("counts the rows each table actually received, per table", async () => {
    const metrics = createMetricsAggregator(() => 0);
    const recorder = new BufferedHistoryRecorder(tableDb(), "srv", { logger: logger(), metrics });
    recorder.recordPower([powerRow(1), powerRow(2)]);
    recorder.recordItems([itemRow(1), itemRow(2), itemRow(3)]);
    recorder.recordTransitions([transitionRow(1)]);
    await recorder.flush();
    expect(written(metrics)).toEqual({ power_samples: 2, item_samples: 3, building_transitions: 1 });
  });

  it("counts nothing for a failed write (the rows are requeued, not written), and counts them when they land", async () => {
    const metrics = createMetricsAggregator(() => 0);
    let db = tableDb("item_samples");
    const recorder = new BufferedHistoryRecorder({ query: (...args: Parameters<Queryable["query"]>) => db.query(...args) } as Queryable, "srv", { logger: logger(), metrics });
    recorder.recordPower([powerRow(1)]);
    recorder.recordItems([itemRow(1), itemRow(2)]);
    await recorder.flush();
    expect(written(metrics)).toEqual({ power_samples: 1 });
    db = tableDb();
    await recorder.flush();
    expect(written(metrics)).toEqual({ item_samples: 2 });
  });

  it("counts nothing for an empty flush", async () => {
    const metrics = createMetricsAggregator(() => 0);
    await new BufferedHistoryRecorder(tableDb(), "srv", { logger: logger(), metrics }).flush();
    expect(metrics.drain()).toEqual([]);
  });

  it("a metrics sink that throws never reaches the writer: the rows are written once, not requeued, and it is logged once", async () => {
    const { db, calls } = fakeDb();
    const log = logger();
    const throwing: MetricsSink = {
      recordHistogram() {
        throw new Error("metrics broken");
      },
      recordCounter() {
        throw new Error("metrics broken");
      },
    };
    const recorder = new BufferedHistoryRecorder(db, "srv", { logger: log, metrics: throwing });
    recorder.recordPower([powerRow(1)]);
    await recorder.flush();
    recorder.recordPower([powerRow(2)]);
    await recorder.flush();
    await recorder.flush();
    expect(calls).toHaveLength(2); // two writes, no retry of rows that did land
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[1]).toBe("failed to record a metric; dropping it");
  });
});
