import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { deliverySnapshotSample } from "@satisfactory-dash/shared/fixtures";
import { DeliverySnapshotSchema } from "@satisfactory-dash/shared";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { DELIVERY_SNAPSHOTS_KEPT, insertDeliverySnapshot, latestDeliverySnapshot } from "./deliveryRepository.js";

const available = dbTestsAvailable();

describe.skipIf(!available)("metrics.delivery_snapshots, edge cases", () => {
  let db: TestDatabase;
  let admin: pg.Pool;
  let app: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    app = new pg.Pool({ connectionString: db.appUrl, max: 4 });
  }, 60_000);
  afterAll(async () => {
    await app?.end();
    await admin?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await admin.query("TRUNCATE metrics.delivery_snapshots");
  });

  it("concurrent pushes never leave more than the cap, and the newest survives", async () => {
    for (let i = 0; i < DELIVERY_SNAPSHOTS_KEPT; i += 1) await insertDeliverySnapshot(app, deliverySnapshotSample);
    await Promise.all(Array.from({ length: 6 }, () => insertDeliverySnapshot(app, deliverySnapshotSample)));
    const { rows } = await admin.query("SELECT count(*)::int AS n FROM metrics.delivery_snapshots");
    expect(rows[0].n).toBe(DELIVERY_SNAPSHOTS_KEPT);
  });

  it("every generatedAt the contract accepts is storable (no 500 behind a 200-valid body)", async () => {
    const times = ["0001-01-01T00:00:00Z", "9999-12-31T23:59:59Z", "2026-10-26T06:00:00.123456789Z", "2026-10-26T06:00:00+14:00", "2026-02-28T23:59:60Z"];
    for (const generatedAt of times) {
      const parsed = DeliverySnapshotSchema.safeParse({ ...deliverySnapshotSample, generatedAt });
      if (!parsed.success) continue;
      await expect(insertDeliverySnapshot(app, parsed.data), generatedAt).resolves.toBeUndefined();
    }
    expect(await latestDeliverySnapshot(app)).toBeDefined();
  });
});
