import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { HistoryQueryService, MAX_ITEMS } from "../services/historyQueryService.js";

const available = dbTestsAvailable();

// ADR-0027 decision 3, the read side, against a real Postgres (the migration is applied by createTestDatabase; the
// service runs as satis_app, the rollups are written as the admin).
describe.skipIf(!available)("history queries against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let counter = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  // A request time that is on no bucket boundary. Everything below sits in the last hour before it.
  const NOW = Date.UTC(2026, 8, 25, 12, 7, 31);
  const at = (hh: number, mm: number) => Date.UTC(2026, 8, 25, hh, mm, 0);
  const service = (publicId: string) => new HistoryQueryService(pool, publicId, { now: () => NOW });
  const newServer = async () => upsertConfiguredServer(pool, { publicId: `hq-${++counter}`, displayName: "Query" });

  async function powerRollup(serverId: string, o: { session: number; circuit: number; resolution: 60 | 3600; bucketMs: number; samples: number; production: [number, number, number] }) {
    const [min, avg, max] = o.production;
    await admin.query(
      `INSERT INTO telemetry.power_rollups
         (server_id, session, circuit, resolution, bucket, samples, production_min, production_avg, production_max,
          consumption_min, consumption_avg, consumption_max, capacity_avg, battery_min, battery_avg, battery_max, fuse_samples)
       VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, $7, $8, $9, 1, 2, 3, 50, 0, 0, 0, 0)`,
      [serverId, o.session, o.circuit, o.resolution, o.bucketMs, o.samples, min, avg, max],
    );
  }

  it("re-buckets 1-minute rollups into 5-minute UTC buckets: weighted average, min of mins, max of maxes, summed samples", async () => {
    const server = await newServer();
    await powerRollup(server.id, { session: 1, circuit: 1, resolution: 60, bucketMs: at(12, 0), samples: 60, production: [8, 10, 12] });
    await powerRollup(server.id, { session: 1, circuit: 1, resolution: 60, bucketMs: at(12, 1), samples: 20, production: [25, 30, 35] });
    await powerRollup(server.id, { session: 1, circuit: 1, resolution: 60, bucketMs: at(12, 6), samples: 60, production: [40, 40, 40] }); // the next 5-minute bucket
    const { series, resolutionSeconds } = await service(server.publicId).power("24h");
    expect(resolutionSeconds).toBe(300);
    expect(series).toHaveLength(1);
    const [first, second] = series[0]!.points;
    expect(first!.t).toBe(at(12, 0));
    expect(first!.t % 300_000).toBe(0); // UTC-aligned
    expect(first!.samples).toBe(80);
    expect(first!.productionMW.min).toBe(8);
    expect(first!.productionMW.max).toBe(35);
    expect(first!.productionMW.avg).toBeCloseTo((60 * 10 + 20 * 30) / 80, 9); // 15: weighted by samples, not (10+30)/2
    expect(second!.t).toBe(at(12, 5));
    expect(second!.samples).toBe(60);
  });

  it("reads the 1-minute rollups for a 24h range and the HOURLY rollups for 7d, never mixing the two", async () => {
    const server = await newServer();
    // The same hour, once as minute rows (avg 10) and once as an hourly row (avg 99): the source is chosen by range.
    await powerRollup(server.id, { session: 1, circuit: 1, resolution: 60, bucketMs: at(11, 0), samples: 60, production: [9, 10, 11] });
    await powerRollup(server.id, { session: 1, circuit: 1, resolution: 3600, bucketMs: at(11, 0), samples: 720, production: [90, 99, 110] });
    const day = await service(server.publicId).power("24h");
    expect(day.series[0]!.points).toHaveLength(1);
    expect(day.series[0]!.points[0]).toMatchObject({ samples: 60 });
    expect(day.series[0]!.points[0]!.productionMW.avg).toBe(10);
    const week = await service(server.publicId).power("7d");
    expect(week.resolutionSeconds).toBe(3600);
    expect(week.series[0]!.points).toHaveLength(1);
    expect(week.series[0]!.points[0]!.samples).toBe(720);
    expect(week.series[0]!.points[0]!.productionMW.avg).toBe(99);
    for (const range of ["30d", "1y"] as const) {
      const long = await service(server.publicId).power(range);
      expect(long.series[0]!.points.map((p) => p.productionMW.avg), range).toEqual([99]); // hourly rows, re-binned
    }
  });

  it("never merges game sessions: the same circuit id in two sessions is two series, the newest data first", async () => {
    const server = await newServer();
    await powerRollup(server.id, { session: 111, circuit: 1, resolution: 60, bucketMs: at(10, 0), samples: 60, production: [1, 1, 1] });
    await powerRollup(server.id, { session: -222, circuit: 1, resolution: 60, bucketMs: at(12, 0), samples: 60, production: [2, 2, 2] });
    await powerRollup(server.id, { session: -222, circuit: 2, resolution: 60, bucketMs: at(11, 0), samples: 60, production: [3, 3, 3] });
    const { series } = await service(server.publicId).power("24h");
    expect(series.map((s) => [s.session, s.circuit])).toEqual([
      [-222, 1], // newest data
      [-222, 2],
      [111, 1],
    ]);
    expect(series.every((s) => s.points.length === 1)).toBe(true);
  });

  it("only ever reads the asked-for server's rows, and an unknown server has none", async () => {
    const mine = await newServer();
    const other = await newServer();
    await powerRollup(mine.id, { session: 1, circuit: 1, resolution: 60, bucketMs: at(12, 0), samples: 60, production: [5, 5, 5] });
    await powerRollup(other.id, { session: 1, circuit: 1, resolution: 60, bucketMs: at(12, 0), samples: 60, production: [77, 77, 77] });
    expect((await service(mine.publicId).power("24h")).series[0]!.points[0]!.productionMW.avg).toBe(5);
    expect((await service("no-such-server").power("24h")).series).toEqual([]);
  });

  it("does not return rows outside the range (before `from`, or at or after `to`)", async () => {
    const server = await newServer();
    await powerRollup(server.id, { session: 1, circuit: 1, resolution: 60, bucketMs: at(12, 0), samples: 60, production: [1, 1, 1] });
    await powerRollup(server.id, { session: 1, circuit: 1, resolution: 60, bucketMs: NOW - 2 * 3_600_000, samples: 60, production: [2, 2, 2] });
    const { series } = await service(server.publicId).power("1h");
    expect(series[0]!.points.map((p) => p.t)).toEqual([at(12, 0)]); // the row two hours back is out of a 1h range
  });

  it("items: ranks by average rate, caps at MAX_ITEMS with truncated, and keeps the best first", async () => {
    const server = await newServer();
    await admin.query(
      `INSERT INTO telemetry.item_rollups (server_id, item, resolution, bucket, samples, current_min, current_avg, current_max, max_avg)
       SELECT $1::uuid, 'Item_' || lpad(g::text, 3, '0'), 60, to_timestamp($2::float8 / 1000.0), 2, g, g, g, g + 1
       FROM generate_series(1, $3::int) AS g`,
      [server.id, at(12, 0), MAX_ITEMS + 5],
    );
    const result = await service(server.publicId).items("24h");
    expect(result.truncated).toBe(true);
    expect(result.series).toHaveLength(MAX_ITEMS);
    expect(result.series[0]!.item).toBe(`Item_${String(MAX_ITEMS + 5).padStart(3, "0")}`); // the highest rate first
    expect(result.series[0]!.points[0]).toMatchObject({ samples: 2, maxPerMinute: MAX_ITEMS + 6 });
    const one = await service(server.publicId).items("24h", "Item_001");
    expect(one.truncated).toBe(false);
    expect(one.series.map((s) => s.item)).toEqual(["Item_001"]);
    expect((await service(server.publicId).items("24h", "Desc_Nothing_C")).series).toEqual([]);
  });

  it("items: weighted re-bucketing of minute rows, and hourly rows for a 7d range", async () => {
    const server = await newServer();
    const insert = (resolution: 60 | 3600, ms: number, samples: number, min: number, avg: number, max: number) =>
      admin.query(
        `INSERT INTO telemetry.item_rollups (server_id, item, resolution, bucket, samples, current_min, current_avg, current_max, max_avg)
         VALUES ($1, 'Desc_X_C', $2, to_timestamp($3 / 1000.0), $4, $5, $6, $7, 100)`,
        [server.id, resolution, ms, samples, min, avg, max],
      );
    await insert(60, at(12, 0), 2, 10, 20, 30);
    await insert(60, at(12, 1), 6, 5, 40, 50);
    await insert(3600, at(11, 0), 120, 1, 2, 3);
    const day = await service(server.publicId).items("24h", "Desc_X_C");
    expect(day.series[0]!.points).toHaveLength(1);
    expect(day.series[0]!.points[0]).toMatchObject({ t: at(12, 0), samples: 8 });
    expect(day.series[0]!.points[0]!.currentPerMinute).toEqual({ min: 5, avg: (2 * 20 + 6 * 40) / 8, max: 50 });
    const week = await service(server.publicId).items("7d", "Desc_X_C");
    expect(week.series[0]!.points).toEqual([
      { t: at(11, 0), samples: 120, currentPerMinute: { min: 1, avg: 2, max: 3 }, maxPerMinute: 100 },
    ]);
  });

  it("transitions: newest first, within the range, limit + truncated", async () => {
    const server = await newServer();
    const insert = (ms: number, to: string, from: string | null) =>
      admin.query(
        "INSERT INTO telemetry.building_transitions (server_id, at, building_id, class_name, from_state, to_state) VALUES ($1, to_timestamp($2 / 1000.0), 'b1', 'Build_X_C', $3, $4)",
        [server.id, ms, from, to],
      );
    await insert(at(12, 0), "producing", null);
    await insert(at(12, 5), "underfed", "producing");
    await insert(at(11, 0), "idle", null);
    await insert(NOW - 2 * 86_400_000, "paused", null); // outside a 24h range
    const all = await service(server.publicId).transitions("24h", 10);
    expect(all.transitions.map((t) => t.toState)).toEqual(["underfed", "producing", "idle"]);
    expect(all.truncated).toBe(false);
    expect(all.transitions[0]).toEqual({ t: at(12, 5), buildingId: "b1", className: "Build_X_C", fromState: "producing", toState: "underfed" });
    expect(all.transitions[1]!.fromState).toBeNull();
    const limited = await service(server.publicId).transitions("24h", 2);
    expect(limited.transitions.map((t) => t.toState)).toEqual(["underfed", "producing"]);
    expect(limited.truncated).toBe(true);
    expect((await service(server.publicId).transitions("7d", 10)).transitions).toHaveLength(4);
  });
});
