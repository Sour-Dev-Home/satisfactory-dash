import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { addSeriesDelta, mergeBucketCountsInDb, purgeExpiredSeries } from "./seriesHourlyRepository.js";
import { emptyBucketCounts } from "./histogramBuckets.js";
import type { SeriesDelta } from "./aggregator.js";

// ADR-0037 §2: metrics.series_hourly, its element-wise bucket-array merge function, and retention.
const available = dbTestsAvailable();

describe.skipIf(!available)("metrics.series_hourly", () => {
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
    await admin.query("TRUNCATE metrics.series_hourly");
  });

  const HOUR = new Date("2026-09-27T10:00:00Z").getTime();
  const rowFor = (hour: number) => admin.query("SELECT count, sum, bucket_counts FROM metrics.series_hourly WHERE hour = to_timestamp($1 / 1000.0)", [hour]);

  describe("metrics.merge_bucket_counts (bucket merge math)", () => {
    it("adds two same-length arrays element-wise", async () => {
      const a = emptyBucketCounts();
      a[0] = 3;
      a[5] = 1;
      const b = emptyBucketCounts();
      b[0] = 2;
      b[12] = 4;
      const merged = await mergeBucketCountsInDb(app, a, b);
      expect(merged).toEqual(a.map((v, i) => v + b[i]));
    });

    it("treats a null side as the identity (no buckets yet), not zero-length", async () => {
      const a = emptyBucketCounts();
      a[3] = 7;
      expect(await mergeBucketCountsInDb(app, a, null)).toEqual(a);
      expect(await mergeBucketCountsInDb(app, null, a)).toEqual(a);
      expect(await mergeBucketCountsInDb(app, null, null)).toBeNull();
    });
  });

  describe("addSeriesDelta (the flush's upsert)", () => {
    const delta = (overrides: Partial<SeriesDelta> = {}): SeriesDelta => ({
      hourStartMs: HOUR,
      metric: "http.server.request.duration",
      labels: { route: "/api/servers/:serverId/status", status_class: "2xx" },
      count: 1,
      sum: 3,
      bucketCounts: (() => {
        const b = emptyBucketCounts();
        b[2] = 1;
        return b;
      })(),
      ...overrides,
    });

    it("creates a fresh row on the first flush of an (hour, metric, labels) key", async () => {
      await addSeriesDelta(app, delta());
      const { rows } = await rowFor(HOUR);
      expect(rows).toHaveLength(1);
      expect(rows[0].count).toBe(1);
      expect(Number(rows[0].sum)).toBe(3);
    });

    it("a second flush for the same key ADDS onto the row, count/sum and bucket_counts alike (ADR-0037 §2)", async () => {
      await addSeriesDelta(app, delta());
      await addSeriesDelta(app, delta({ count: 2, sum: 10, bucketCounts: (() => { const b = emptyBucketCounts(); b[2] = 2; return b; })() }));
      const { rows } = await rowFor(HOUR);
      expect(rows[0].count).toBe(3);
      expect(Number(rows[0].sum)).toBe(13);
      expect(rows[0].bucket_counts).toEqual((() => {
        const b = emptyBucketCounts();
        b[2] = 3;
        return b;
      })());
    });

    it("a different label set gets its own row, even in the same hour and metric", async () => {
      await addSeriesDelta(app, delta({ labels: { route: "/api/a", status_class: "2xx" } }));
      await addSeriesDelta(app, delta({ labels: { route: "/api/b", status_class: "2xx" } }));
      const { rows } = await admin.query("SELECT count(*)::int AS n FROM metrics.series_hourly WHERE hour = to_timestamp($1 / 1000.0)", [HOUR]);
      expect(rows[0].n).toBe(2);
    });

    it("a counter's row (no bucket_counts) stays null across repeated flushes", async () => {
      await addSeriesDelta(app, delta({ metric: "satis.history.rows_written", labels: { table: "power_samples" }, bucketCounts: undefined }));
      await addSeriesDelta(app, delta({ metric: "satis.history.rows_written", labels: { table: "power_samples" }, bucketCounts: undefined, count: 4, sum: 40 }));
      const { rows } = await admin.query(
        "SELECT count, sum, bucket_counts FROM metrics.series_hourly WHERE hour = to_timestamp($1 / 1000.0) AND metric = 'satis.history.rows_written'",
        [HOUR],
      );
      expect(rows[0]).toMatchObject({ count: 5, bucket_counts: null });
      expect(Number(rows[0].sum)).toBe(43);
    });
  });

  describe("purgeExpiredSeries", () => {
    const insertAtHour = (hoursAgo: number) => addSeriesDelta(app, delta({ hourStartMs: Date.now() - hoursAgo * 3_600_000 }));
    function delta(overrides: Partial<SeriesDelta>): SeriesDelta {
      return {
        hourStartMs: HOUR,
        metric: "http.server.request.duration",
        labels: { route: `/api/${Math.random()}`, status_class: "2xx" },
        count: 1,
        sum: 1,
        bucketCounts: emptyBucketCounts(),
        ...overrides,
      };
    }

    it("deletes only rows older than 90 days, and returns how many", async () => {
      await insertAtHour(24 * 100); // 100 days ago: expired
      await insertAtHour(24 * 91); // 91 days ago: expired
      await insertAtHour(24 * 89); // 89 days ago: kept
      await insertAtHour(1); // recent: kept
      expect(await purgeExpiredSeries(app, Date.now())).toBe(2);
      const { rows } = await admin.query("SELECT count(*)::int AS n FROM metrics.series_hourly");
      expect(rows[0].n).toBe(2);
      expect(await purgeExpiredSeries(app, Date.now())).toBe(0);
    });
  });
});
