import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import {
  insertItemSamples,
  insertPowerSamples,
  insertTransitions,
  purgeExpired,
  rollUp,
  RAW_RETENTION_MS,
} from "./historyRepository.js";

const available = dbTestsAvailable();

// Runs as satis_app against a real Postgres (the migration is applied by createTestDatabase).
describe.skipIf(!available)("telemetry history against a real Postgres", () => {
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

  const newServer = async () => upsertConfiguredServer(pool, { publicId: `hist-${++counter}`, displayName: "History" });
  const count = async (table: string, serverId: string): Promise<number> =>
    Number((await admin.query(`SELECT count(*) AS n FROM telemetry.${table} WHERE server_id = $1`, [serverId])).rows[0].n);

  // A whole minute, well in the past so nothing here depends on the wall clock.
  const MINUTE = Date.UTC(2026, 0, 10, 12, 0, 0);
  const power = (atMs: number, productionMW: number, overrides: Record<string, unknown> = {}) => ({
    session: 7,
    circuit: 1,
    atMs,
    productionMW,
    consumptionMW: 50,
    capacityMW: 100,
    batteryPercent: 0,
    fuseTripped: false,
    ...overrides,
  });

  it("writes power samples for a registered server, and ignores an unknown one", async () => {
    const server = await newServer();
    await insertPowerSamples(pool, server.publicId, [power(MINUTE, 10), power(MINUTE + 5000, 20)]);
    expect(await count("power_samples", server.id)).toBe(2);
    await insertPowerSamples(pool, "no-such-server", [power(MINUTE, 10)]);
    const all = Number((await admin.query("SELECT count(*) AS n FROM telemetry.power_samples")).rows[0].n);
    expect(all).toBeGreaterThanOrEqual(2);
    expect(await count("power_samples", server.id)).toBe(2);
  });

  it("a duplicate sample is ignored, not an error", async () => {
    const server = await newServer();
    await insertPowerSamples(pool, server.publicId, [power(MINUTE, 10)]);
    await insertPowerSamples(pool, server.publicId, [power(MINUTE, 99)]);
    expect(await count("power_samples", server.id)).toBe(1);
  });

  it("rolls power samples into a minute and an hour bucket, idempotently", async () => {
    const server = await newServer();
    await insertPowerSamples(pool, server.publicId, [power(MINUTE, 10), power(MINUTE + 5000, 30, { fuseTripped: true })]);
    const window = { fromMs: MINUTE, toMs: MINUTE + 3_600_000 };
    await rollUp(pool, window);
    await rollUp(pool, window);
    const minute = (
      await admin.query("SELECT * FROM telemetry.power_rollups WHERE server_id = $1 AND resolution = 60", [server.id])
    ).rows;
    expect(minute).toHaveLength(1);
    expect(minute[0]).toMatchObject({ samples: 2, production_min: 10, production_avg: 20, production_max: 30, fuse_samples: 1 });
    const hour = (
      await admin.query("SELECT * FROM telemetry.power_rollups WHERE server_id = $1 AND resolution = 3600", [server.id])
    ).rows;
    expect(hour).toHaveLength(1);
    expect(hour[0]).toMatchObject({ samples: 2, production_avg: 20 });
  });

  it("does not roll the minute in progress", async () => {
    const server = await newServer();
    await insertPowerSamples(pool, server.publicId, [power(MINUTE + 5000, 10)]);
    await rollUp(pool, { fromMs: MINUTE, toMs: MINUTE + 30_000 });
    expect(await count("power_rollups", server.id)).toBe(0);
  });

  it("rolls item samples and writes transitions", async () => {
    const server = await newServer();
    await insertItemSamples(pool, server.publicId, [
      { item: "Desc_Cement_C", atMs: MINUTE, currentPerMinute: 60, maxPerMinute: 100 },
      { item: "Desc_Cement_C", atMs: MINUTE + 30_000, currentPerMinute: 80, maxPerMinute: 100 },
    ]);
    await rollUp(pool, { fromMs: MINUTE, toMs: MINUTE + 60_000 });
    const rows = (await admin.query("SELECT * FROM telemetry.item_rollups WHERE server_id = $1 AND resolution = 60", [server.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ samples: 2, current_min: 60, current_avg: 70, current_max: 80 });
    await insertTransitions(pool, server.publicId, [
      { atMs: MINUTE, buildingId: "b1", className: "Build_Constructor_C", fromState: null, toState: "producing" },
      { atMs: MINUTE + 1000, buildingId: "b1", className: "Build_Constructor_C", fromState: "producing", toState: "starved" },
    ]);
    expect(await count("building_transitions", server.id)).toBe(2);
  });

  it("purges expired rows in batches and keeps recent ones", async () => {
    const server = await newServer();
    const now = Date.now();
    const old = Array.from({ length: 12 }, (_, i) => power(now - RAW_RETENTION_MS - 3_600_000 + i * 5000, 1));
    await insertPowerSamples(pool, server.publicId, [...old, power(now - 60_000, 2)]);
    const purged = await purgeExpired(pool, now, { batchSize: 5 });
    expect(purged.powerSamples).toBeGreaterThanOrEqual(12);
    expect(await count("power_samples", server.id)).toBe(1);
  });
});
