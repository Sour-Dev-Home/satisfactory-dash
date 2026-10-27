import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { addSeriesDelta } from "../../platform/metrics/seriesHourlyRepository.js";
import { emptyBucketCounts } from "../../platform/metrics/histogramBuckets.js";
import { createMetricsService } from "./metricsService.js";
import { MetricsOverviewSchema } from "@satisfactory-dash/shared";
import { readCounterSeries, readHistogramSeries, readHourlyCounters, readHourlyHistograms } from "./metricsRepository.js";

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

  const record = (hourStartMs: number, metric: string, labels: Record<string, string>, at: Record<number, number>) =>
    addSeriesDelta(app, { hourStartMs, metric, labels, count: Object.values(at).reduce((a, b) => a + b, 0), sum: 1, bucketCounts: buckets(at) });

  it("reads the charts' hourly histograms folded to status_class and api, one ordered array per hour", async () => {
    await record(hourAgo(0), "http.server.request.duration", { server: "a1", route: "/api/a", status_class: "2xx" }, { 1: 2 });
    await record(hourAgo(0), "http.server.request.duration", { server: "b2", route: "/api/b", status_class: "2xx" }, { 1: 1, 12: 1 });
    await record(hourAgo(0), "http.server.request.duration", { route: "/api/a", status_class: "5xx" }, { 3: 1 });
    await record(hourAgo(1), "http.server.upstream.duration", { server: "a1", api: "frm" }, { 4: 5 });
    await record(hourAgo(0), "satis.poller.cycle.duration", { server: "a1", group: "fast" }, { 0: 9 });
    const rows = await readHourlyHistograms(app, new Date(hourAgo(5)), new Date(NOW), ["http.server.request.duration", "http.server.upstream.duration"]);
    const key = (r: (typeof rows)[number]) => `${r.hourMs}|${r.metric}|${r.statusClass}|${r.api}`;
    const byKey = new Map(rows.map((r) => [key(r), r.buckets]));
    expect(rows).toHaveLength(3);
    expect(byKey.get(`${hourAgo(0)}|http.server.request.duration|2xx|`)).toEqual(buckets({ 1: 3, 12: 1 }));
    expect(byKey.get(`${hourAgo(0)}|http.server.request.duration|5xx|`)).toEqual(buckets({ 3: 1 }));
    expect(byKey.get(`${hourAgo(1)}|http.server.upstream.duration||frm`)).toEqual(buckets({ 4: 5 }));
  });

  it("reads the charts' hourly counters summed across servers and labels, only the asked metrics", async () => {
    await count(hourAgo(0), { server: "a1", status: "401" }, 2);
    await count(hourAgo(0), { server: "b2", status: "403" }, 3);
    await count(hourAgo(3), { server: "a1", status: "401" }, 1);
    const rows = await readHourlyCounters(app, new Date(hourAgo(5)), new Date(NOW), ["satis.agent.refused"]);
    expect(rows.sort((a, b) => a.hourMs - b.hourMs)).toEqual([
      { hourMs: hourAgo(3), metric: "satis.agent.refused", total: 1 },
      { hourMs: hourAgo(0), metric: "satis.agent.refused", total: 5 },
    ]);
    expect(await readHourlyCounters(app, new Date(hourAgo(5)), new Date(NOW), ["satis.signup.refused"])).toEqual([]);
  });

  it("serves contract-valid charts end to end, with the previous window's numbers", async () => {
    await record(hourAgo(0), "http.server.request.duration", { route: "/api/a", status_class: "2xx" }, { 2: 4 });
    await record(hourAgo(30), "http.server.request.duration", { route: "/api/a", status_class: "5xx" }, { 2: 1 });
    const out = await createMetricsService({ db: app, now: () => NOW }).overview("24h");
    expect(MetricsOverviewSchema.parse(out)).toBeTruthy();
    if (!out.charts?.available) throw new Error("expected charts");
    expect(out.charts.trend.requests.c2xx.at(-1)).toBe(4);
    expect(out.charts.headline.current).toMatchObject({ requests: 4, serverErrors: 0 });
    expect(out.charts.headline.previous).toMatchObject({ requests: 1, serverErrors: 1 });
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
