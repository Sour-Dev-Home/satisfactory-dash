import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { softDeleteServer, upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { createLatestSnapshotRepository, type LatestSnapshotWrite } from "./latestSnapshotRepository.js";

const available = dbTestsAvailable();
const T0 = Date.UTC(2026, 9, 24, 10, 0, 0);

const write = (overrides: Partial<LatestSnapshotWrite> = {}): LatestSnapshotWrite => ({
  reachable: true,
  unreachableSinceMs: undefined,
  lastReceivedAtMs: T0,
  statusJson: JSON.stringify({ sessionName: "s" }),
  statusObservedAtMs: T0,
  powerJson: JSON.stringify({ circuits: [] }),
  powerObservedAtMs: T0,
  factoryJson: JSON.stringify({ buildings: [] }),
  factoryObservedAtMs: T0,
  autoPause: { autoPause: true, pending: false, observedAtMs: T0 },
  ...overrides,
});

describe.skipIf(!available)("telemetry.latest_snapshots against a real Postgres (ADR-0052)", () => {
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

  const newServer = async () => upsertConfiguredServer(pool, { publicId: `snap-${++counter}`, displayName: "Snap" });
  const rows = async (serverId: string): Promise<number> =>
    Number((await admin.query("SELECT count(*) AS n FROM telemetry.latest_snapshots WHERE server_id = $1", [serverId])).rows[0].n);

  it("keeps one row a server and loads it back, with the times to the millisecond", async () => {
    const server = await newServer();
    const repo = createLatestSnapshotRepository(pool);
    expect(await repo.load(server.publicId)).toBeUndefined();
    await repo.upsert(server.publicId, write());
    await repo.upsert(server.publicId, write({ lastReceivedAtMs: T0 + 5000, statusObservedAtMs: T0 + 5000 }));
    expect(await rows(server.id)).toBe(1);
    const loaded = await repo.load(server.publicId);
    expect(loaded).toMatchObject({
      reachable: true,
      lastReceivedAtMs: T0 + 5000,
      status: { data: { sessionName: "s" }, observedAtMs: T0 + 5000 },
      power: { observedAtMs: T0 },
      autoPause: { autoPause: true, pending: false, observedAtMs: T0 },
    });
  });

  it("has no players column", async () => {
    const result = await admin.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'telemetry' AND table_name = 'latest_snapshots'",
    );
    const names = result.rows.map((r: { column_name: string }) => r.column_name);
    expect(names.some((n) => n.includes("player"))).toBe(false);
  });

  it("round-trips an unreachable state and a null factory", async () => {
    const server = await newServer();
    const repo = createLatestSnapshotRepository(pool);
    await repo.upsert(server.publicId, write({ reachable: false, unreachableSinceMs: T0 + 1000, factoryJson: null, factoryObservedAtMs: undefined, autoPause: undefined }));
    const loaded = await repo.load(server.publicId);
    expect(loaded).toMatchObject({ reachable: false, unreachableSinceMs: T0 + 1000, factory: undefined, autoPause: undefined });
  });

  it("only replaces a row with an older or equal last_received_at (recency guard, ADR-0054 D3.5)", async () => {
    const server = await newServer();
    const repo = createLatestSnapshotRepository(pool);
    await repo.upsert(server.publicId, write({ lastReceivedAtMs: T0 + 10_000, statusJson: JSON.stringify({ sessionName: "newer" }) }));
    await repo.upsert(server.publicId, write({ lastReceivedAtMs: T0, statusJson: JSON.stringify({ sessionName: "older" }) }));
    expect((await repo.load(server.publicId))?.status?.data).toEqual({ sessionName: "newer" });
    await repo.upsert(server.publicId, write({ lastReceivedAtMs: T0 + 10_000, statusJson: JSON.stringify({ sessionName: "same" }) }));
    expect((await repo.load(server.publicId))?.status?.data).toEqual({ sessionName: "same" });
  });

  it("writes nothing for a removed server, and loads nothing for it", async () => {
    const server = await newServer();
    const repo = createLatestSnapshotRepository(pool);
    await repo.upsert(server.publicId, write());
    expect(await softDeleteServer(pool, server.publicId)).toBe(true);
    expect(await rows(server.id)).toBe(0);
    await repo.upsert(server.publicId, write({ lastReceivedAtMs: T0 + 60_000 }));
    expect(await rows(server.id)).toBe(0);
    expect(await repo.load(server.publicId)).toBeUndefined();
  });

  it("writes nothing for an unknown server", async () => {
    const repo = createLatestSnapshotRepository(pool);
    const total = async () => Number((await admin.query("SELECT count(*) AS n FROM telemetry.latest_snapshots")).rows[0].n);
    const before = await total();
    await repo.upsert("no-such-server", write());
    expect(await total()).toBe(before);
    expect(await repo.load("no-such-server")).toBeUndefined();
  });
});
