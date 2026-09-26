import { describe, expect, it } from "vitest";
import { RowShapeError } from "../../../platform/db/rows.js";
import { ServiceUnavailableError } from "../../../platform/errorResponse.js";
import {
  chooseResolution,
  HistoryQueryService,
  MAX_ITEMS,
  MAX_POINTS,
  type HistoryDb,
} from "./historyQueryService.js";

const NOW = Date.UTC(2026, 8, 25, 12, 7, 31); // not on any bucket boundary

interface Call {
  sql: string;
  params: unknown[];
}

/** A fake pool whose client answers by what the SQL touches, and records everything it was asked. */
function fakePool(answers: { power?: unknown[]; top?: unknown[]; items?: unknown[]; transitions?: unknown[]; fail?: unknown } = {}) {
  const calls: Call[] = [];
  const events: string[] = [];
  const client = {
    on: () => {},
    removeListener: () => {},
    release: () => events.push("release"),
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) {
        events.push(sql);
        return { rows: [] };
      }
      if (answers.fail !== undefined && !sql.startsWith("SELECT set_config")) throw answers.fail;
      if (sql.includes("set_config")) return { rows: [] };
      if (sql.includes("power_rollups")) return { rows: answers.power ?? [] };
      if (sql.includes("GROUP BY r.item")) return { rows: answers.top ?? [] };
      if (sql.includes("item_rollups")) return { rows: answers.items ?? [] };
      if (sql.includes("building_transitions")) return { rows: answers.transitions ?? [] };
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  const pool = { connect: async () => client } as unknown as HistoryDb;
  return { pool, calls, events };
}

const powerRow = (session: number, circuit: number, t: number, production = 10) => ({
  session,
  circuit,
  t,
  samples: 60,
  production_min: production - 1,
  production_avg: production,
  production_max: production + 1,
  consumption_min: 1,
  consumption_avg: 2,
  consumption_max: 3,
  capacity_avg: 20,
  battery_min: 0,
  battery_avg: 0,
  battery_max: 0,
  fuse_samples: 0,
});

describe("chooseResolution: the range picks the resolution", () => {
  it.each([
    ["1h", 60, 60],
    ["6h", 60, 60],
    ["24h", 300, 60],
    ["7d", 3600, 3600],
    ["30d", 21_600, 3600],
    ["1y", 86_400, 3600],
  ] as const)("%s -> %i s buckets read from the %i s rollups", (range, bucketSeconds, source) => {
    expect(chooseResolution(range)).toEqual({ bucketSeconds, source });
  });

  it("never asks for more than MAX_POINTS per series, and reads minute rollups only below an hour", () => {
    const seconds = { "1h": 3600, "6h": 21_600, "24h": 86_400, "7d": 604_800, "30d": 2_592_000, "1y": 31_536_000 } as const;
    for (const range of Object.keys(seconds) as (keyof typeof seconds)[]) {
      const { bucketSeconds, source } = chooseResolution(range);
      expect(seconds[range] / bucketSeconds, range).toBeLessThanOrEqual(MAX_POINTS);
      expect(source, range).toBe(bucketSeconds < 3600 ? 60 : 3600);
    }
  });
});

describe("HistoryQueryService.power", () => {
  it("aligns `from` down to a whole bucket (UTC), reports the resolution, and binds every value", async () => {
    const { pool, calls } = fakePool({ power: [] });
    const result = await new HistoryQueryService(pool, "alpha", { now: () => NOW }).power("24h");
    expect(result.resolutionSeconds).toBe(300);
    expect(result.to).toBe(NOW);
    expect(result.from % 300_000).toBe(0);
    expect(NOW - 86_400_000 - result.from).toBeGreaterThanOrEqual(0);
    expect(NOW - 86_400_000 - result.from).toBeLessThan(300_000);
    const query = calls.find((call) => call.sql.includes("power_rollups"))!;
    expect(query.params[0]).toBe("alpha");
    expect(query.params[1]).toBe(300); // bucket seconds, a parameter (make_interval), never in the text
    expect(query.params[2]).toBe(60); // the source: 1-minute rollups
    expect(query.params[3]).toBe(new Date(result.from).toISOString());
    expect(query.params[4]).toBe(new Date(NOW).toISOString());
    expect(query.sql).not.toContain("alpha");
  });

  it("reads the hourly rollups for a 7d range", async () => {
    const { pool, calls } = fakePool();
    await new HistoryQueryService(pool, "alpha", { now: () => NOW }).power("7d");
    const query = calls.find((call) => call.sql.includes("power_rollups"))!;
    expect(query.params[1]).toBe(3600);
    expect(query.params[2]).toBe(3600);
  });

  it("never merges game sessions: one series per (session, circuit), the newest data first", async () => {
    const { pool } = fakePool({
      power: [
        powerRow(-5, 1, 1000),
        powerRow(-5, 1, 2000),
        powerRow(-5, 2, 1000),
        powerRow(7, 1, 5000), // the same circuit id in a NEWER session (a hash: its value says nothing about age)
        powerRow(7, 1, 6000),
      ],
    });
    const { series } = await new HistoryQueryService(pool, "alpha", { now: () => NOW }).power("1h");
    expect(series.map((s) => [s.session, s.circuit, s.points.length])).toEqual([
      [7, 1, 2],
      [-5, 1, 2],
      [-5, 2, 1],
    ]);
    expect(series[0]!.points.map((p) => p.t)).toEqual([5000, 6000]); // oldest first inside a series
  });

  it("maps a row to the contract's point", async () => {
    const { pool } = fakePool({ power: [powerRow(1, 3, 42, 100)] });
    const { series } = await new HistoryQueryService(pool, "alpha", { now: () => NOW }).power("1h");
    expect(series[0]!.points[0]).toEqual({
      t: 42,
      samples: 60,
      productionMW: { min: 99, avg: 100, max: 101 },
      consumptionMW: { min: 1, avg: 2, max: 3 },
      capacityMW: 20,
      batteryPercent: { min: 0, avg: 0, max: 0 },
      fuseTrippedSamples: 0,
    });
  });
});

describe("HistoryQueryService.items", () => {
  const item = (name: string, t: number) => ({ item: name, t, samples: 2, current_min: 1, current_avg: 2, current_max: 3, max_avg: 4 });

  it("with no item, ranks and caps at MAX_ITEMS, and says so when it cut anything off", async () => {
    const names = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => `Desc_${i}_C`);
    const { pool, calls } = fakePool({ top: names.map((name) => ({ item: name })), items: [item("Desc_0_C", 1000)] });
    const result = await new HistoryQueryService(pool, "alpha", { now: () => NOW }).items("24h");
    expect(result.truncated).toBe(true);
    const ranking = calls.find((call) => call.sql.includes("GROUP BY r.item"))!;
    expect(ranking.params[4]).toBe(MAX_ITEMS + 1); // asked for one more than the cap
    const buckets = calls.find((call) => call.sql.includes("ANY("))!;
    expect((buckets.params[5] as string[]).length).toBe(MAX_ITEMS); // the extra one is not requested
    expect(result.series.map((s) => s.item)).toEqual(["Desc_0_C"]); // only items that have data are returned
  });

  it("is not truncated when the ranking fits, and keeps the ranking's order (highest rate first)", async () => {
    const { pool } = fakePool({
      top: [{ item: "Desc_B_C" }, { item: "Desc_A_C" }],
      items: [item("Desc_A_C", 1000), item("Desc_B_C", 1000), item("Desc_A_C", 2000)],
    });
    const result = await new HistoryQueryService(pool, "alpha", { now: () => NOW }).items("6h");
    expect(result.truncated).toBe(false);
    expect(result.series.map((s) => [s.item, s.points.length])).toEqual([
      ["Desc_B_C", 1],
      ["Desc_A_C", 2],
    ]);
  });

  it("with an item, skips the ranking and asks for just that item", async () => {
    const { pool, calls } = fakePool({ items: [item("Desc_IronPlate_C", 1000)] });
    const result = await new HistoryQueryService(pool, "alpha", { now: () => NOW }).items("30d", "Desc_IronPlate_C");
    expect(calls.some((call) => call.sql.includes("GROUP BY r.item"))).toBe(false);
    expect(calls.find((call) => call.sql.includes("ANY("))!.params[5]).toEqual(["Desc_IronPlate_C"]);
    expect(result).toMatchObject({ truncated: false, resolutionSeconds: 21_600 });
    expect(result.series).toHaveLength(1);
  });

  it("returns no series (and runs no bucket query) when nothing ranks", async () => {
    const { pool, calls } = fakePool({ top: [] });
    const result = await new HistoryQueryService(pool, "alpha", { now: () => NOW }).items("1h");
    expect(result.series).toEqual([]);
    expect(calls.some((call) => call.sql.includes("ANY("))).toBe(false);
  });
});

describe("HistoryQueryService.transitions", () => {
  const row = (t: number) => ({ t, building_id: "b", class_name: "c", from_state: null, to_state: "producing" });

  it("asks for one more than the limit to learn whether there is more, and returns newest first", async () => {
    const { pool, calls } = fakePool({ transitions: [row(3), row(2), row(1)] });
    const result = await new HistoryQueryService(pool, "alpha", { now: () => NOW }).transitions("24h", 2);
    expect(calls.find((call) => call.sql.includes("building_transitions"))!.params[3]).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.transitions.map((t) => t.t)).toEqual([3, 2]);
    expect(result.transitions[0]).toEqual({ t: 3, buildingId: "b", className: "c", fromState: null, toState: "producing" });
  });

  it("is not truncated when the rows fit the limit", async () => {
    const { pool } = fakePool({ transitions: [row(2), row(1)] });
    const result = await new HistoryQueryService(pool, "alpha", { now: () => NOW }).transitions("1h", 2);
    expect(result.truncated).toBe(false);
    expect(result.transitions).toHaveLength(2);
    expect(result.to - result.from).toBe(3_600_000);
  });
});

describe("cost guard and failures", () => {
  it("runs every read in a transaction with a bound statement timeout, released afterwards", async () => {
    const { pool, calls, events } = fakePool();
    await new HistoryQueryService(pool, "alpha", { now: () => NOW, statementTimeoutMs: 1234 }).power("1h");
    expect(calls[0]!.sql).toBe("BEGIN");
    const guard = calls[1]!;
    expect(guard.sql).toContain("set_config('statement_timeout', $1, true)"); // true = SET LOCAL
    expect(guard.params).toEqual(["1234"]);
    expect(events).toEqual(["BEGIN", "COMMIT", "release"]);
  });

  it("the default timeout is 5 seconds", async () => {
    const { pool, calls } = fakePool();
    await new HistoryQueryService(pool, "alpha", { now: () => NOW }).transitions("1h", 10);
    expect(calls[1]!.params).toEqual(["5000"]);
  });

  it("a cancelled (timed out) or failed query is a 503 with the cause kept, and the transaction is rolled back", async () => {
    for (const failure of [Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }), new Error("connection reset")]) {
      const { pool, events } = fakePool({ fail: failure });
      const promise = new HistoryQueryService(pool, "alpha", { now: () => NOW }).power("1h");
      await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableError);
      await expect(promise).rejects.toMatchObject({ cause: failure });
      expect(events).toContain("ROLLBACK");
    }
  });

  it("a row that does not match the expected shape is our bug (a 500), not an outage", async () => {
    const { pool } = fakePool({ power: [{ session: "x" }] });
    await expect(new HistoryQueryService(pool, "alpha", { now: () => NOW }).power("1h")).rejects.toBeInstanceOf(RowShapeError);
  });

  it("never interpolates a value into SQL", async () => {
    const { pool, calls } = fakePool({ top: [{ item: "Desc_A_C" }], items: [] });
    const hostile = "x'; DROP TABLE telemetry.power_samples; --";
    await new HistoryQueryService(pool, hostile, { now: () => NOW }).items("24h", hostile);
    for (const call of calls) expect(call.sql).not.toContain("DROP");
    expect(calls.some((call) => call.params.includes(hostile))).toBe(true); // it travelled as a parameter
  });
});
