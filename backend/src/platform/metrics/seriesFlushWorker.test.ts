import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { Queryable } from "../db/schemaVersion.js";
import { createMetricsAggregator } from "./aggregator.js";
import { SeriesFlushWorker, FLUSH_INTERVAL_MS } from "./seriesFlushWorker.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(behaviour: { upsert?: () => unknown; purge?: () => unknown[] } = {}) {
  const statements: { text: string; values: unknown[] }[] = [];
  const db: Queryable = {
    async query(text, values = []) {
      statements.push({ text, values });
      if (text.includes("INSERT INTO metrics.series_hourly")) {
        if (behaviour.upsert) behaviour.upsert();
        return { rows: [] };
      }
      if (text.includes("DELETE FROM metrics.series_hourly")) return { rows: behaviour.purge?.() ?? [{ deleted: 0 }] };
      return { rows: [] };
    },
  };
  const lines: { level: string; obj: unknown; msg: string }[] = [];
  const log = (level: string) => (obj: unknown, msg?: string) =>
    lines.push({ level, obj: typeof obj === "string" ? {} : obj, msg: typeof obj === "string" ? obj : (msg ?? "") });
  const logger = { info: log("info"), warn: log("warn") } as unknown as Logger;
  const aggregator = createMetricsAggregator();
  return { statements, lines, aggregator, worker: new SeriesFlushWorker(db, aggregator, { logger }) };
}
const upserts = (statements: { text: string }[]) => statements.filter((s) => s.text.includes("INSERT INTO metrics.series_hourly"));
const purges = (statements: { text: string }[]) => statements.filter((s) => s.text.includes("DELETE FROM metrics.series_hourly"));

describe("SeriesFlushWorker", () => {
  it("writes nothing when the aggregator has nothing new (a flush with no recordings is a no-op query-wise)", async () => {
    const { worker, statements } = setup();
    await worker.flushOnce();
    expect(upserts(statements)).toHaveLength(0);
  });

  it("flushes what the aggregator accumulated, once per delta", async () => {
    const { worker, aggregator, statements } = setup();
    aggregator.recordHistogram("http.server.request.duration", { route: "/a", status_class: "2xx" }, 1);
    aggregator.recordHistogram("http.server.request.duration", { route: "/b", status_class: "2xx" }, 1);
    await worker.flushOnce();
    expect(upserts(statements)).toHaveLength(2);
  });

  it("is idempotent: flushing twice with nothing recorded in between writes the second delta only once (i.e. not at all)", async () => {
    const { worker, aggregator, statements } = setup();
    aggregator.recordHistogram("http.server.request.duration", { route: "/a", status_class: "2xx" }, 1);
    await worker.flushOnce();
    expect(upserts(statements)).toHaveLength(1);
    await worker.flushOnce(); // nothing recorded since the last flush
    expect(upserts(statements)).toHaveLength(1); // still just the one write; the DB row is unchanged
  });

  it("purges on the first flush and then about once an hour (every 60 flushes)", async () => {
    const { worker, statements } = setup();
    await worker.flushOnce();
    expect(purges(statements)).toHaveLength(1);
    for (let i = 0; i < 59; i++) await worker.flushOnce();
    expect(purges(statements)).toHaveLength(1);
    await worker.flushOnce(); // the 61st: one hour of 60 s flushes later
    expect(purges(statements)).toHaveLength(2);
  });

  it("logs how many series it purged, and nothing when it purged none", async () => {
    const some = setup({ purge: () => [{ deleted: 3 }] });
    await some.worker.flushOnce();
    expect(some.lines).toEqual([{ level: "info", obj: { purged: 3 }, msg: "expired metrics series purged" }]);
    const none = setup();
    await none.worker.flushOnce();
    expect(none.lines).toEqual([]);
  });

  it("a failing flush is logged once per run of failures, drops that interval's data, and never throws", async () => {
    let failing = true;
    const { worker, aggregator, lines } = setup({
      upsert: () => {
        if (failing) throw new Error("db down");
      },
    });
    aggregator.recordHistogram("http.server.request.duration", { route: "/a", status_class: "2xx" }, 1);
    await expect(worker.flushOnce()).resolves.toBeUndefined();
    aggregator.recordHistogram("http.server.request.duration", { route: "/a", status_class: "2xx" }, 1);
    await worker.flushOnce();
    expect(lines.filter((l) => l.level === "warn")).toHaveLength(1);
    failing = false;
    aggregator.recordHistogram("http.server.request.duration", { route: "/a", status_class: "2xx" }, 1);
    await worker.flushOnce();
    expect(lines.map((l) => l.msg)).toEqual([
      "metrics flush failed; the drained interval's data is lost, trying again next run",
      "metrics flush recovered",
    ]);
  });

  it("a mid-batch failure is a torn write, not an all-or-nothing one: earlier deltas in the same flush are already committed when a later one throws", async () => {
    // flushOnce's own comment says a failed write "drops that interval's deltas" (plural, read as
    // all of them); addSeriesDeltas actually awaits one INSERT per delta with no transaction, so a
    // failure partway through leaves the earlier ones durably written and only the rest lost. This
    // documents the actual (torn) behaviour rather than the all-or-nothing framing.
    let calls = 0;
    const { worker, aggregator, statements } = setup({
      upsert: () => {
        calls++;
        if (calls === 2) throw new Error("db down for this one delta");
      },
    });
    aggregator.recordHistogram("http.server.request.duration", { route: "/a", status_class: "2xx" }, 1);
    aggregator.recordHistogram("http.server.request.duration", { route: "/b", status_class: "2xx" }, 1);
    aggregator.recordHistogram("http.server.request.duration", { route: "/c", status_class: "2xx" }, 1);
    await worker.flushOnce();
    // All three deltas were attempted (the loop doesn't stop drained data from being iterated further
    // once queued)...
    expect(calls).toBe(2); // ...but the loop DOES stop as soon as one throws: /c's insert never even ran.
    expect(upserts(statements)).toHaveLength(2); // /a committed, /b's statement was sent (and failed), /c never sent
    expect(aggregator.drain()).toEqual([]); // /c is gone from the aggregator too: drain() already removed it, so it is not retried
  });

  it("runs every 60 s once started, and stop() ends it and waits for a flush in flight", async () => {
    const { worker } = setup();
    const flushOnce = vi.spyOn(worker, "flushOnce");
    worker.start();
    worker.start(); // idempotent
    expect(flushOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    expect(flushOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    expect(flushOnce).toHaveBeenCalledTimes(2);
    await worker.stop();
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS * 4);
    expect(flushOnce).toHaveBeenCalledTimes(2); // stop() ends the schedule; nothing further runs
    expect(vi.getTimerCount()).toBe(0);
  });
});
