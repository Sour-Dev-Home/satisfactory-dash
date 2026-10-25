import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { PAIRING_RETENTION_AFTER_EXPIRY_HOURS } from "../repositories/pairingRepository.js";
import { PAIRING_SWEEP_INTERVAL_MS, PairingSweeper } from "./pairingSweeper.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(rows: () => { unused: boolean }[] = () => []) {
  const statements: { text: string; values: unknown[] }[] = [];
  const db: Queryable = {
    async query(text, values = []) {
      statements.push({ text, values });
      return { rows: rows() };
    },
  };
  const lines: { level: string; obj: unknown; msg: string }[] = [];
  const log = (level: string) => (obj: unknown, msg?: string) => lines.push({ level, obj: typeof obj === "string" ? {} : obj, msg: typeof obj === "string" ? obj : (msg ?? "") });
  const logger = { info: log("info"), warn: log("warn") } as unknown as Logger;
  const counters: [string, Record<string, string>, number | undefined][] = [];
  const metrics = { recordHistogram: () => undefined, recordCounter: (m: string, l: Record<string, string>, n?: number) => void counters.push([m, l, n]) };
  return { statements, lines, counters, sweeper: new PairingSweeper(db, { logger, metrics: metrics as never }) };
}

describe("PairingSweeper", () => {
  it("deletes only rows past expiry plus the retention hour (the privacy page's promise)", async () => {
    const { sweeper, statements } = setup();
    await sweeper.sweep();
    expect(statements).toHaveLength(1);
    expect(statements[0]!.text).toContain("DELETE FROM agents.pairings");
    expect(statements[0]!.text).toContain("expires_at < now() - make_interval(hours => $1)");
    expect(statements[0]!.values).toEqual([PAIRING_RETENTION_AFTER_EXPIRY_HOURS]);
    expect(PAIRING_RETENTION_AFTER_EXPIRY_HOURS).toBe(1);
  });

  it("counts the pairings that were never collected as expired, and logs only counts", async () => {
    const { sweeper, counters, lines } = setup(() => [{ unused: true }, { unused: true }, { unused: false }]);
    await sweeper.sweep();
    expect(counters).toEqual([["satis.pairing.events", { event: "expired" }, 2]]);
    expect(lines).toEqual([{ level: "info", obj: { deleted: 3 }, msg: "expired agent pairings deleted" }]);
  });

  it("records and logs nothing when nothing was deleted, or only spent pairings", async () => {
    const none = setup();
    await none.sweeper.sweep();
    expect(none.counters).toEqual([]);
    expect(none.lines).toEqual([]);
    const spent = setup(() => [{ unused: false }]);
    await spent.sweeper.sweep();
    expect(spent.counters).toEqual([]);
  });

  it("a failing sweep is logged once per run of failures, never thrown, and a recovery is logged", async () => {
    let failing = true;
    const { sweeper, lines } = setup(() => {
      if (failing) throw new Error("db down");
      return [];
    });
    await expect(sweeper.sweep()).resolves.toBeUndefined();
    await sweeper.sweep();
    expect(lines.filter((l) => l.level === "warn")).toHaveLength(1);
    failing = false;
    await sweeper.sweep();
    expect(lines.map((l) => l.msg)).toEqual(["sweeping agent pairings failed; trying again", "pairing sweeping recovered"]);
  });

  it("runs every minute once started, and stop() ends it for good", async () => {
    const { sweeper, statements } = setup();
    sweeper.start();
    sweeper.start();
    expect(statements).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(PAIRING_SWEEP_INTERVAL_MS);
    expect(statements).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PAIRING_SWEEP_INTERVAL_MS);
    expect(statements).toHaveLength(2);
    await sweeper.stop();
    await vi.advanceTimersByTimeAsync(PAIRING_SWEEP_INTERVAL_MS * 3);
    expect(statements).toHaveLength(2);
    sweeper.start();
    await vi.advanceTimersByTimeAsync(PAIRING_SWEEP_INTERVAL_MS * 2);
    expect(statements).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
