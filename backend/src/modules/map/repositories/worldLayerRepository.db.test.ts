import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { getLatestWorldLayer, upsertWorldLayerIfChanged } from "./worldLayerRepository.js";

const available = dbTestsAvailable();

// Runs as satis_app against a real Postgres (the migration is applied by createTestDatabase).
describe.skipIf(!available)("map.world_layers against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let counter = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const newServer = async () => upsertConfiguredServer(pool, { publicId: `map-${++counter}`, displayName: "Map" });

  it("has no row for a layer that has never been ingested", async () => {
    const server = await newServer();
    expect(await getLatestWorldLayer(pool, server.publicId, "rails")).toBeUndefined();
  });

  it("stores the first ingest, then reads it back", async () => {
    const server = await newServer();
    const reading = { hash: "h1", observedAt: "2026-09-28T00:00:00.000Z", truncated: false, count: 1, data: [{ id: "a", points: [[0, 0], [1, 1]] }] };
    const result = await upsertWorldLayerIfChanged(pool, server.publicId, "rails", reading);
    expect(result).toEqual({ written: true });
    expect(await getLatestWorldLayer(pool, server.publicId, "rails")).toEqual(reading);
  });

  it("a second ingest with the SAME hash writes nothing (the row keeps its original observedAt)", async () => {
    const server = await newServer();
    const first = { hash: "same", observedAt: "2026-09-28T00:00:00.000Z", truncated: false, count: 1, data: [1] };
    await upsertWorldLayerIfChanged(pool, server.publicId, "rails", first);
    const second = await upsertWorldLayerIfChanged(pool, server.publicId, "rails", { ...first, observedAt: "2026-09-28T00:10:00.000Z" });
    expect(second).toEqual({ written: false });
    expect((await getLatestWorldLayer(pool, server.publicId, "rails"))?.observedAt).toBe("2026-09-28T00:00:00.000Z");
  });

  it("a second ingest with a DIFFERENT hash overwrites the row (latest only, not appended)", async () => {
    const server = await newServer();
    await upsertWorldLayerIfChanged(pool, server.publicId, "rails", { hash: "h1", observedAt: "2026-09-28T00:00:00.000Z", truncated: false, count: 1, data: [1] });
    const changed = { hash: "h2", observedAt: "2026-09-28T00:10:00.000Z", truncated: true, count: 2, data: [1, 2] };
    const result = await upsertWorldLayerIfChanged(pool, server.publicId, "rails", changed);
    expect(result).toEqual({ written: true });
    expect(await getLatestWorldLayer(pool, server.publicId, "rails")).toEqual(changed);
  });

  it("rails and resourceNodes are independent rows for the same server", async () => {
    const server = await newServer();
    await upsertWorldLayerIfChanged(pool, server.publicId, "rails", { hash: "r1", observedAt: "2026-09-28T00:00:00.000Z", truncated: false, count: 1, data: [1] });
    await upsertWorldLayerIfChanged(pool, server.publicId, "resourceNodes", { hash: "n1", observedAt: "2026-09-28T00:00:00.000Z", truncated: false, count: 1, data: [2] });
    expect((await getLatestWorldLayer(pool, server.publicId, "rails"))?.hash).toBe("r1");
    expect((await getLatestWorldLayer(pool, server.publicId, "resourceNodes"))?.hash).toBe("n1");
  });

  it("an unknown server id matches no row on either read or write", async () => {
    expect(await getLatestWorldLayer(pool, "does-not-exist", "rails")).toBeUndefined();
    const result = await upsertWorldLayerIfChanged(pool, "does-not-exist", "rails", { hash: "h1", observedAt: "2026-09-28T00:00:00.000Z", truncated: false, count: 0, data: [] });
    expect(result).toEqual({ written: false });
  });
});
