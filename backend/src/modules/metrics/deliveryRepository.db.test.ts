import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { deliverySnapshotSample } from "@satisfactory-dash/shared/fixtures";
import { MetricsOverviewSchema } from "@satisfactory-dash/shared";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { DELIVERY_SNAPSHOTS_KEPT, insertDeliverySnapshot, latestDeliverySnapshot } from "./deliveryRepository.js";
import { createMetricsService } from "./metricsService.js";

const available = dbTestsAvailable();

const snapshotAt = (iso: string, mergedPrs = 2) => ({
  ...deliverySnapshotSample,
  generatedAt: iso,
  throughput: { ...deliverySnapshotSample.throughput, mergedPrs },
});

// ADR-0056 section 4 (PR 6b): metrics.delivery_snapshots, written and read as the runtime role.
describe.skipIf(!available)("metrics.delivery_snapshots", () => {
  let db: TestDatabase;
  let admin: pg.Pool;
  let app: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    app = new pg.Pool({ connectionString: db.appUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await admin?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await admin.query("TRUNCATE metrics.delivery_snapshots");
  });

  it("is empty before the first push", async () => {
    expect(await latestDeliverySnapshot(app)).toBeUndefined();
  });

  it("stores a snapshot as the runtime role and reads the newest back, unchanged", async () => {
    await insertDeliverySnapshot(app, snapshotAt("2026-10-25T06:00:00Z", 1));
    await insertDeliverySnapshot(app, snapshotAt("2026-10-26T06:00:00Z", 7));
    expect(await latestDeliverySnapshot(app)).toEqual(snapshotAt("2026-10-26T06:00:00Z", 7));
    const { rows } = await admin.query("SELECT schema_version, generated_at FROM metrics.delivery_snapshots ORDER BY id");
    expect(rows.map((r) => [r.schema_version, (r.generated_at as Date).toISOString()])).toEqual([
      [2, "2026-10-25T06:00:00.000Z"],
      [2, "2026-10-26T06:00:00.000Z"],
    ]);
  });

  it("newest means last received, not the latest generatedAt (a re-run of an old day still wins)", async () => {
    await insertDeliverySnapshot(app, snapshotAt("2026-10-26T06:00:00Z", 7));
    await insertDeliverySnapshot(app, snapshotAt("2026-10-20T06:00:00Z", 3));
    expect((await latestDeliverySnapshot(app))?.throughput.mergedPrs).toBe(3);
  });

  it(`prune on insert keeps the newest ${DELIVERY_SNAPSHOTS_KEPT}`, async () => {
    for (let i = 0; i < DELIVERY_SNAPSHOTS_KEPT + 5; i++) {
      await insertDeliverySnapshot(app, snapshotAt("2026-10-26T06:00:00Z", i));
    }
    const { rows } = await admin.query("SELECT body->'throughput'->>'mergedPrs' AS merged FROM metrics.delivery_snapshots ORDER BY id");
    expect(rows).toHaveLength(DELIVERY_SNAPSHOTS_KEPT);
    expect(Number(rows[0].merged)).toBe(5);
    expect(Number(rows.at(-1).merged)).toBe(DELIVERY_SNAPSHOTS_KEPT + 4);
  });

  it("skips a row of another schema version, and one that no longer fits the contract", async () => {
    await insertDeliverySnapshot(app, snapshotAt("2026-10-25T06:00:00Z", 1));
    await admin.query(
      "INSERT INTO metrics.delivery_snapshots (generated_at, schema_version, body) VALUES (now(), 3, '{\"schemaVersion\":3}'::jsonb)",
    );
    expect((await latestDeliverySnapshot(app))?.throughput.mergedPrs).toBe(1);
    await admin.query(
      "INSERT INTO metrics.delivery_snapshots (generated_at, schema_version, body) VALUES (now(), 2, '{\"schemaVersion\":2}'::jsonb)",
    );
    expect(await latestDeliverySnapshot(app)).toBeUndefined();
  });

  it("refuses a body that is not an object", async () => {
    await expect(
      admin.query("INSERT INTO metrics.delivery_snapshots (generated_at, schema_version, body) VALUES (now(), 2, '[]'::jsonb)"),
    ).rejects.toThrow(/check constraint/);
  });

  it("the metrics page serves it end to end", async () => {
    await insertDeliverySnapshot(app, snapshotAt("2026-10-26T06:00:00Z", 9));
    const out = await createMetricsService({ db: app, now: () => Date.parse("2026-10-26T10:30:00Z"), deliveryConfigured: true }).overview("24h");
    expect(MetricsOverviewSchema.parse(out).delivery).toEqual({ available: true, asOf: "2026-10-26T06:00:00Z", snapshot: snapshotAt("2026-10-26T06:00:00Z", 9) });
  });
});
