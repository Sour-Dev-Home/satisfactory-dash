import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { createMetricsAggregator } from "../../../platform/metrics/index.js";
import { isCatalogedItem } from "../itemForms.js";
import type { ItemSampleRow, PowerSampleRow } from "../repositories/historyRepository.js";
import { BufferedHistoryRecorder, QUOTA_WARNING_INTERVAL_MS } from "./historyRecorder.js";
import { MAX_POWER_SAMPLE_CIRCUITS, MAX_UNCATALOGED_ITEMS_PER_SAMPLE, SeriesQuota, capItemSample, capPowerSample } from "./historyQuota.js";

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
    expect(capPowerSample(rows, undefined, 3)).toEqual({ kept: [power(3), power(1), power(5)], dropped: 2 });
    expect(capPowerSample([...rows].reverse(), undefined, 3).kept.map((row) => row.circuit)).toEqual([5, 1, 3]);
  });

  it("keeps one row per circuit: 1,000 copies of one circuit are one row, not 1,000 inserts", () => {
    const rows = Array.from({ length: 1000 }, () => power(7));
    expect(capPowerSample(rows)).toEqual({ kept: [rows[0]], dropped: 999 });
    expect(capPowerSample([power(1), power(2), power(1)]).kept).toHaveLength(2);
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

describe("SeriesQuota (#515): distinct series per server per UTC hour", () => {
  const HOUR = 3_600_000;
  const T = 1_800_000_000_000 - (1_800_000_000_000 % HOUR); // the start of a UTC hour

  it("admits up to the cap, always re-admits an admitted key, and starts over in the next hour", () => {
    const quota = new SeriesQuota(2);
    expect([quota.admit("a", T), quota.admit("b", T + 1), quota.admit("c", T + 2), quota.admit("a", T + 3)]).toEqual([true, true, false, true]);
    expect(quota.admit("c", T + HOUR)).toBe(true);
  });

  it("a reading stamped in the previous hour still finds that hour's set; an older one is refused", () => {
    const quota = new SeriesQuota(1);
    quota.admit("a", T + 10);
    quota.admit("b", T + HOUR); // the next hour begins
    expect(quota.admit("a", T + HOUR - 1)).toBe(true); // late, but its own hour admitted it
    expect(quota.admit("z", T + HOUR - 1)).toBe(false); // that hour is full
    quota.admit("c", T + 2 * HOUR);
    expect(quota.admit("a", T + 10)).toBe(false); // two hours back: gone
  });
});

describe("rotating identifiers cannot grow the rollups (#515, the per-series cap)", () => {
  const HOUR = 3_600_000;
  const T = 1_800_000_000_000 - (1_800_000_000_000 % HOUR);
  /** The rollups' keys: what one UTC minute / hour bucket holds a row for. */
  const bucketsOf = (rows: { atMs: number }[], key: (row: never) => string, size: number) => {
    const buckets = new Map<number, Set<string>>();
    for (const row of rows) {
      const bucket = Math.floor(row.atMs / size);
      buckets.set(bucket, (buckets.get(bucket) ?? new Set()).add(key(row as never)));
    }
    return Math.max(...[...buckets.values()].map((set) => set.size));
  };

  it("64 new circuit ids every 2.5 s for two hours: at most 64 power series in any minute or hour bucket", () => {
    const quota = new SeriesQuota(MAX_POWER_SAMPLE_CIRCUITS);
    const kept: PowerSampleRow[] = [];
    for (let sample = 0; sample < 2 * 1440; sample++) {
      const atMs = T + sample * 2500;
      kept.push(...capPowerSample(Array.from({ length: 64 }, (_, i) => power(sample * 64 + i, atMs)), quota).kept);
    }
    const series = (row: PowerSampleRow) => `${row.session}:${row.circuit}`;
    expect(bucketsOf(kept, series, HOUR)).toBe(MAX_POWER_SAMPLE_CIRCUITS);
    expect(bucketsOf(kept, series, 60_000)).toBeLessThanOrEqual(MAX_POWER_SAMPLE_CIRCUITS);
    expect(new Set(kept.map(series)).size).toBe(2 * MAX_POWER_SAMPLE_CIRCUITS); // one hour's worth, twice
  });

  it("a new session name every sample (same circuits) is bounded the same way", () => {
    const quota = new SeriesQuota(MAX_POWER_SAMPLE_CIRCUITS);
    const kept: PowerSampleRow[] = [];
    for (let sample = 0; sample < 1440; sample++) {
      const atMs = T + sample * 2500;
      kept.push(...capPowerSample(Array.from({ length: 8 }, (_, i) => ({ ...power(i, atMs), session: sample })), quota).kept);
    }
    expect(new Set(kept.map((row) => `${row.session}:${row.circuit}`)).size).toBe(MAX_POWER_SAMPLE_CIRCUITS);
    expect(new Set(kept.map((row) => row.session)).size).toBe(MAX_POWER_SAMPLE_CIRCUITS / 8);
  });

  it("64 new made-up item names every 15 s for an hour: at most 64 unknown items in the hour; catalog items never refused", () => {
    const quota = new SeriesQuota(MAX_UNCATALOGED_ITEMS_PER_SAMPLE);
    const kept: ItemSampleRow[] = [];
    for (let sample = 0; sample < 240; sample++) {
      const atMs = T + sample * 15_000;
      const forged = Array.from({ length: 64 }, (_, i) => item(`Desc_Rot${String(sample * 64 + i).padStart(6, "0")}_C`, atMs));
      kept.push(...capItemSample([...REAL.map((name) => item(name, atMs)), ...forged], isCatalogedItem, quota).kept);
    }
    expect(new Set(kept.filter((row) => !isCatalogedItem(row.item)).map((row) => row.item)).size).toBe(MAX_UNCATALOGED_ITEMS_PER_SAMPLE);
    expect(kept.filter((row) => isCatalogedItem(row.item))).toHaveLength(240 * REAL.length);
  });

  it("an honest factory keeps its series hour after hour, and a session change gets room by the next hour at the latest", () => {
    const quota = new SeriesQuota(MAX_POWER_SAMPLE_CIRCUITS);
    for (let sample = 0; sample < 1440; sample++) {
      expect(capPowerSample([power(1, T + sample * 5000)], quota).dropped).toBe(0);
    }
    expect(capPowerSample([{ ...power(1, T + 2 * HOUR), session: 2 }], quota).dropped).toBe(0);
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
    // One warning per table for the server, with counts only.
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("MadeUp");
    expect(log.warn.mock.calls.map((call) => (call[0] as { table: string }).table)).toEqual(["power_samples", "item_samples"]);
    expect(log.warn.mock.calls[0]![0]).toMatchObject({ code: "HISTORY_QUOTA_EXCEEDED", table: "power_samples", dropped: 1000 - MAX_POWER_SAMPLE_CIRCUITS });
    // A second over-cap sample of either table in the same hour is counted, not logged.
    recorder.recordPower(Array.from({ length: 1000 }, (_, i) => power(i, 2)));
    recorder.recordItems(madeUp(3000));
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("rotating circuit ids across samples: the recorder keeps the hour's series bounded and counts the rest", async () => {
    const { db, inserted } = countingDb();
    const metrics = createMetricsAggregator(() => 0);
    const recorder = new BufferedHistoryRecorder(db, "srv-a", { logger: logger(), metrics, now: () => 0 });
    const hourStart = 1_800_000_000_000 - (1_800_000_000_000 % 3_600_000);
    for (let sample = 0; sample < 100; sample++) {
      recorder.recordPower(Array.from({ length: 64 }, (_, i) => power(sample * 64 + i, hourStart + sample * 2500)));
    }
    await recorder.flush();
    expect(inserted.power_samples).toBe(MAX_POWER_SAMPLE_CIRCUITS); // only the first sample's 64 series
    expect(dropped(metrics)).toEqual([{ server: "srv-a", table: "power_samples", sum: 99 * 64 }]);
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
