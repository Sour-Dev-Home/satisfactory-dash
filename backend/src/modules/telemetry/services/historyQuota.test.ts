import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { createMetricsAggregator } from "../../../platform/metrics/index.js";
import { isCatalogedItem } from "../itemForms.js";
import type { ItemSampleRow, PowerSampleRow } from "../repositories/historyRepository.js";
import { BufferedHistoryRecorder, QUOTA_WARNING_INTERVAL_MS } from "./historyRecorder.js";
import { MAX_POWER_SAMPLE_CIRCUITS, MAX_UNCATALOGED_ITEMS_PER_SAMPLE, capItemSample, capPowerSample } from "./historyQuota.js";

const power = (circuit: number, atMs = 1): PowerSampleRow => ({
  session: 1,
  circuit,
  atMs,
  productionMW: 1,
  consumptionMW: 1,
  capacityMW: 2,
  batteryPercent: 0,
  fuseTripped: false,
});
const item = (name: string, atMs = 1): ItemSampleRow => ({ item: name, atMs, currentPerMinute: 1, maxPerMinute: 2 });
const madeUp = (n: number) => Array.from({ length: n }, (_, i) => item(`Desc_MadeUp${String(i).padStart(5, "0")}_C`));
/** A real slice of the catalog: every one of these is a game item. */
const REAL = ["Desc_IronPlate_C", "Desc_IronRod_C", "Desc_Cement_C", "Desc_Water_C"];

describe("capPowerSample (#515)", () => {
  it("keeps a sample at or under the cap whole, the same array", () => {
    const rows = Array.from({ length: MAX_POWER_SAMPLE_CIRCUITS }, (_, i) => power(i));
    expect(capPowerSample(rows)).toEqual({ kept: rows, dropped: 0 });
  });

  it("over the cap keeps the lowest circuit ids, in the snapshot's order, whatever order they come in", () => {
    const rows = [power(9), power(3), power(7), power(1), power(5)];
    expect(capPowerSample(rows, 3)).toEqual({ kept: [power(3), power(1), power(5)], dropped: 2 });
    expect(capPowerSample([...rows].reverse(), 3).kept.map((row) => row.circuit)).toEqual([5, 1, 3]);
  });

  it("a forged sample of 1,000 circuits (the schema's maximum) records only the cap", () => {
    const result = capPowerSample(Array.from({ length: 1000 }, (_, i) => power(1000 - i)));
    expect(result.kept).toHaveLength(MAX_POWER_SAMPLE_CIRCUITS);
    expect(result.dropped).toBe(1000 - MAX_POWER_SAMPLE_CIRCUITS);
    expect(Math.max(...result.kept.map((row) => row.circuit))).toBe(MAX_POWER_SAMPLE_CIRCUITS);
  });
});

describe("capItemSample (#515)", () => {
  it("checks names against the backend's real item catalog, own keys only", () => {
    for (const name of REAL) expect(isCatalogedItem(name), name).toBe(true);
    for (const name of ["Desc_MadeUp_C", "__proto__", "constructor", "toString", ""]) expect(isCatalogedItem(name), name).toBe(false);
  });

  it("records every catalog item however many, and up to the cap of unknown ones", () => {
    const rows = [...REAL.map((name) => item(name)), ...madeUp(MAX_UNCATALOGED_ITEMS_PER_SAMPLE)];
    expect(capItemSample(rows, isCatalogedItem)).toEqual({ kept: rows, dropped: 0 });
  });

  it("a forged sample of thousands of made-up items records the catalog items and only the cap of the rest", () => {
    const forged = madeUp(5000);
    const rows = [...forged.slice(0, 2500), ...REAL.map((name) => item(name)), ...forged.slice(2500)];
    const result = capItemSample(rows, isCatalogedItem);
    expect(result.dropped).toBe(5000 - MAX_UNCATALOGED_ITEMS_PER_SAMPLE);
    expect(result.kept.filter((row) => isCatalogedItem(row.item)).map((row) => row.item)).toEqual(REAL);
    // The unknown names kept are the first by name, so the same ones are kept sample after sample.
    expect(result.kept.filter((row) => !isCatalogedItem(row.item)).map((row) => row.item)).toEqual(forged.slice(0, MAX_UNCATALOGED_ITEMS_PER_SAMPLE).map((row) => row.item));
  });
});

describe("BufferedHistoryRecorder applies the caps (#515)", () => {
  const logger = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) as unknown as Logger & { warn: ReturnType<typeof vi.fn> };
  /** Records how many rows each history insert carried (the repository unnests one array per column). */
  function countingDb() {
    const inserted: Record<string, number> = {};
    const db = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const table = /telemetry\.(\w+)/.exec(sql)?.[1] ?? "other";
        const firstArray = params.find(Array.isArray) as unknown[] | undefined;
        inserted[table] = (inserted[table] ?? 0) + (firstArray?.length ?? 0);
        return { rows: [] };
      }),
    } as unknown as Queryable;
    return { db, inserted };
  }
  const dropped = (metrics: ReturnType<typeof createMetricsAggregator>) =>
    metrics
      .drain()
      .filter((delta) => delta.metric === "satis.history.rows_dropped")
      .map((delta) => ({ ...delta.labels, sum: delta.sum }));

  it("writes only the capped rows of an over-cap sample, counts the rest per table, and warns without naming items", async () => {
    const { db, inserted } = countingDb();
    const metrics = createMetricsAggregator(() => 0);
    const log = logger();
    const recorder = new BufferedHistoryRecorder(db, "srv-a", { logger: log, metrics, now: () => 0 });
    recorder.recordPower(Array.from({ length: 1000 }, (_, i) => power(i)));
    recorder.recordItems([...REAL.map((name) => item(name)), ...madeUp(3000)]);
    await recorder.flush();
    expect(inserted.power_samples).toBe(MAX_POWER_SAMPLE_CIRCUITS);
    expect(inserted.item_samples).toBe(REAL.length + MAX_UNCATALOGED_ITEMS_PER_SAMPLE);
    expect(dropped(metrics)).toEqual(
      expect.arrayContaining([
        { server: "srv-a", table: "power_samples", sum: 1000 - MAX_POWER_SAMPLE_CIRCUITS },
        { server: "srv-a", table: "item_samples", sum: 3000 - MAX_UNCATALOGED_ITEMS_PER_SAMPLE },
      ]),
    );
    // One warning for the server (the second cap in the same hour is counted, not logged), with counts only.
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("MadeUp");
    expect(log.warn.mock.calls[0]![0]).toMatchObject({ code: "HISTORY_QUOTA_EXCEEDED", table: "power_samples", dropped: 1000 - MAX_POWER_SAMPLE_CIRCUITS });
  });

  it("warns at most once an hour per server, and again after the hour", () => {
    let now = 0;
    const log = logger();
    const recorder = new BufferedHistoryRecorder(countingDb().db, "srv-a", { logger: log, metrics: createMetricsAggregator(() => 0), now: () => now });
    const forged = () => recorder.recordPower(Array.from({ length: 200 }, (_, i) => power(i)));
    forged();
    now += QUOTA_WARNING_INTERVAL_MS - 1;
    forged();
    expect(log.warn).toHaveBeenCalledTimes(1);
    now += 1;
    forged();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("an honest factory (the measured one circuit, catalog items only) drops nothing and logs nothing", async () => {
    const { db, inserted } = countingDb();
    const metrics = createMetricsAggregator(() => 0);
    const log = logger();
    const recorder = new BufferedHistoryRecorder(db, "srv-b", { logger: log, metrics });
    recorder.recordPower([power(1)]);
    recorder.recordItems(REAL.map((name) => item(name)));
    await recorder.flush();
    expect(inserted).toMatchObject({ power_samples: 1, item_samples: REAL.length });
    expect(dropped(metrics)).toEqual([]);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
