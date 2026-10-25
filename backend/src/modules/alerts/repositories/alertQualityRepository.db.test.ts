import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { alertQualitySummary, monthStart } from "./alertQualityRepository.js";

const available = dbTestsAvailable();
const NOW = Date.parse("2026-10-25T12:00:00Z");
const MIN = 60_000;

// ADR-0056 PR 4 against a real Postgres: monthly grouping, the flap rule, the median, pairing per alert.
describe.skipIf(!available)("alert quality summary over alerts.alert_events", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let counter = 0;
  let serverA = "";
  let serverB = "";

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 2 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await admin.query("DELETE FROM alerts.alert_events");
    serverA = (await upsertConfiguredServer(pool, { publicId: `aq-${++counter}`, displayName: "Quality" })).id;
    serverB = (await upsertConfiguredServer(pool, { publicId: `aq-${++counter}`, displayName: "Quality" })).id;
  });

  const event = (server: string, kind: string, subject: string, transition: string, atIso: string | number) =>
    admin.query(
      `INSERT INTO alerts.alert_events (server_id, kind, severity, subject, transition, at)
       VALUES ($1::uuid, $2, 'warning', $3, $4, $5::timestamptz)`,
      [server, kind, subject, transition, typeof atIso === "number" ? new Date(atIso).toISOString() : atIso],
    );
  const T0 = Date.parse("2026-10-10T08:00:00Z");

  it("is empty with no events", async () => {
    expect(await alertQualitySummary(pool, NOW)).toEqual([]);
  });

  it("groups by UTC month of the fired time and by kind, ordered", async () => {
    await event(serverA, "power_outage", "c1", "fired", "2026-09-30T23:59:59Z");
    await event(serverA, "power_outage", "c1", "resolved", "2026-10-01T00:30:00Z"); // resolves across the month edge
    await event(serverA, "power_outage", "c2", "fired", "2026-10-01T00:00:00Z");
    await event(serverA, "stopped_machines", "all", "fired", "2026-10-02T00:00:00Z");
    expect(await alertQualitySummary(pool, NOW)).toEqual([
      { month: "2026-09", kind: "power_outage", fired: 1, flaps: 0, medianResolveSeconds: 1801 },
      { month: "2026-10", kind: "power_outage", fired: 1, flaps: 0, medianResolveSeconds: null },
      { month: "2026-10", kind: "stopped_machines", fired: 1, flaps: 0, medianResolveSeconds: null },
    ]);
  });

  it("counts a flap at exactly 5 minutes, not at 5 minutes and 1 second", async () => {
    await event(serverA, "power_outage", "c1", "fired", T0);
    await event(serverA, "power_outage", "c1", "resolved", T0 + 5 * MIN);
    await event(serverA, "power_outage", "c2", "fired", T0);
    await event(serverA, "power_outage", "c2", "resolved", T0 + 5 * MIN + 1000);
    expect(await alertQualitySummary(pool, NOW)).toEqual([
      { month: "2026-10", kind: "power_outage", fired: 2, flaps: 1, medianResolveSeconds: 300.5 },
    ]);
  });

  it("takes the median of resolved alerts only; fired with no resolve counts as fired but not in the median or flaps", async () => {
    for (const [subject, minutes] of [["a", 1], ["b", 10], ["c", 100]] as const) {
      await event(serverA, "stopped_machines", subject, "fired", T0);
      await event(serverA, "stopped_machines", subject, "resolved", T0 + minutes * MIN);
    }
    await event(serverA, "stopped_machines", "open", "fired", T0); // still firing
    expect(await alertQualitySummary(pool, NOW)).toEqual([
      { month: "2026-10", kind: "stopped_machines", fired: 4, flaps: 1, medianResolveSeconds: 600 },
    ]);
  });

  it("ignores updated and renotify rows, and pairs each fired with its own next resolve (re-fires, other alerts, other servers)", async () => {
    await event(serverA, "power_outage", "c1", "fired", T0);
    await event(serverA, "power_outage", "c1", "updated", T0 + MIN);
    await event(serverA, "power_outage", "c1", "renotify", T0 + 2 * MIN);
    await event(serverA, "power_outage", "c1", "resolved", T0 + 3 * MIN); // flap, 180 s
    await event(serverA, "power_outage", "c1", "fired", T0 + 10 * MIN);
    await event(serverA, "power_outage", "c1", "resolved", T0 + 70 * MIN); // 3600 s
    // The same subject on another server resolves later: it must not steal or lend a resolve.
    await event(serverB, "power_outage", "c1", "fired", T0);
    await event(serverB, "power_outage", "c1", "resolved", T0 + 20 * MIN); // 1200 s
    expect(await alertQualitySummary(pool, NOW)).toEqual([
      { month: "2026-10", kind: "power_outage", fired: 3, flaps: 1, medianResolveSeconds: 1200 },
    ]);
  });

  it("a fired that is followed by another fired (lost resolve) has no resolve time", async () => {
    await event(serverA, "fuse_trip", "c1", "fired", T0);
    await event(serverA, "fuse_trip", "c1", "fired", T0 + MIN);
    await event(serverA, "fuse_trip", "c1", "resolved", T0 + 2 * MIN);
    expect(await alertQualitySummary(pool, NOW)).toEqual([
      { month: "2026-10", kind: "fuse_trip", fired: 2, flaps: 1, medianResolveSeconds: 60 },
    ]);
  });

  it("covers only the current and the two previous calendar months", async () => {
    expect(monthStart(NOW, 2).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    await event(serverA, "power_outage", "old", "fired", "2026-07-31T23:59:59Z");
    await event(serverA, "power_outage", "edge", "fired", "2026-08-01T00:00:00Z");
    expect(await alertQualitySummary(pool, NOW)).toEqual([
      { month: "2026-08", kind: "power_outage", fired: 1, flaps: 0, medianResolveSeconds: null },
    ]);
  });

  it("carries no server, subject or summary: only month, kind and counts", async () => {
    await event(serverA, "power_outage", "secret-subject", "fired", T0);
    const [row] = await alertQualitySummary(pool, NOW);
    expect(Object.keys(row).sort()).toEqual(["fired", "flaps", "kind", "medianResolveSeconds", "month"]);
    expect(JSON.stringify(row)).not.toContain("secret-subject");
  });
});

describe("monthStart", () => {
  it("steps back across a year edge in UTC", () => {
    expect(monthStart(Date.parse("2027-01-15T00:00:00Z"), 2).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(monthStart(Date.parse("2026-10-31T23:59:59Z"), 0).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
