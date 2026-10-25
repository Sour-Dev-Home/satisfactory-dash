import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { addSeriesDelta } from "../../platform/metrics/seriesHourlyRepository.js";
import { emptyBucketCounts } from "../../platform/metrics/histogramBuckets.js";
import { createMetricsService } from "./metricsService.js";
import { readCounterSeries, readHistogramSeries } from "./metricsRepository.js";

const available = dbTestsAvailable();
const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-25T10:30:00Z");
const hourAgo = (n: number) => Math.floor(NOW / HOUR_MS) * HOUR_MS - n * HOUR_MS;

const buckets = (at: Record<number, number>) => {
  const b = emptyBucketCounts();
  for (const [i, n] of Object.entries(at)) b[Number(i)] = n;
  return b;
};

describe.skipIf(!available)("metrics read path over metrics.series_hourly", () => {
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

  const histogram = (hourStartMs: number, labels: Record<string, string>, at: Record<number, number>) =>
    addSeriesDelta(app, { hourStartMs, metric: "poller.cycle.duration", labels, count: Object.values(at).reduce((a, b) => a + b, 0), sum: 1, bucketCounts: buckets(at) });
  const count = (hourStartMs: number, labels: Record<string, string>, sum: number) =>
    addSeriesDelta(app, { hourStartMs, metric: "satis.agent.refused", labels, count: 1, sum });

  it("sums bucket arrays element-wise across hours and keeps servers and label sets apart", async () => {
    await histogram(hourAgo(0), { server: "a1", group: "fast" }, { 2: 3, 4: 1 });
    await histogram(hourAgo(1), { server: "a1", group: "fast" }, { 2: 2, 12: 1 });
    await histogram(hourAgo(1), { server: "b2", group: "fast" }, { 0: 4 });
    const series = await readHistogramSeries(app, new Date(hourAgo(5)), new Date(NOW));
    const a1 = series.find((s) => s.labels.get("server") === "a1")!;
    expect(a1.buckets).toEqual(buckets({ 2: 5, 4: 1, 12: 1 }));
    expect(series.find((s) => s.labels.get("server") === "b2")!.buckets).toEqual(buckets({ 0: 4 }));
    expect(series).toHaveLength(2);
  });

  it("reads only the window, and counters apart from histograms", async () => {
    await histogram(hourAgo(30), { server: "a1", group: "fast" }, { 1: 9 });
    await histogram(hourAgo(0), { server: "a1", group: "fast" }, { 1: 1 });
    await count(hourAgo(30), { server: "a1", status: "401" }, 100);
    await count(hourAgo(0), { server: "a1", status: "401" }, 2);
    await count(hourAgo(1), { server: "a1", status: "401" }, 3);
    const from = new Date(hourAgo(24));
    expect((await readHistogramSeries(app, from, new Date(NOW)))[0].buckets).toEqual(buckets({ 1: 1 }));
    const counters = await readCounterSeries(app, from, new Date(NOW));
    expect(counters).toHaveLength(1);
    expect(counters[0].total).toBe(5);
  });

  it("builds the overview end to end, folded, with the worst server by public id", async () => {
    await histogram(hourAgo(0), { server: "slow1", group: "fast" }, { 12: 4 });
    await histogram(hourAgo(0), { server: "ok2", group: "fast" }, { 1: 4 });
    await count(hourAgo(2), { server: "ok2", status: "401" }, 6);
    const out = await createMetricsService({ db: app, now: () => NOW }).overview("1h");
    if (!out.system.available) throw new Error("expected data");
    expect(out.system.histograms).toEqual([{ metric: "poller.cycle.duration", labels: { group: "fast" }, count: 8, p50Ms: 2, p95Ms: null, p99Ms: null }]);
    // 1h window starts at the previous hour start (09:00): the counter from 2 hours earlier is outside it.
    expect(out.system.counters).toEqual([]);
    expect(out.system.servers[0]).toMatchObject({ kind: "histogram", server: "slow1", p95Ms: null });
    const wide = await createMetricsService({ db: app, now: () => NOW }).overview("24h");
    if (!wide.system.available) throw new Error("expected data");
    expect(wide.system.counters).toEqual([{ metric: "satis.agent.refused", labels: { status: "401" }, total: 6 }]);
  });
});
