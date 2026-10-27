import { describe, expect, it } from "vitest";
import { METRICS_TREND_OVER_MS, MetricsChartsSectionSchema } from "@satisfactory-dash/shared";
import { buildCharts, chartsBounds } from "./metricsCharts.js";
import type { HourlyCounter, HourlyHistogram } from "./metricsRepository.js";

const H = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-25T10:30:00Z");
const THIS_HOUR = Date.parse("2026-10-25T10:00:00Z");
const DAY = 24 * H;

/** A 13-bucket array with `n` observations in bucket `i` (0-based; 12 is the open-ended one). */
const at = (i: number, n = 1) => Array.from({ length: 13 }, (_, k) => (k === i ? n : 0));
const hist = (hoursAgo: number, metric: string, buckets: number[], extra: Partial<HourlyHistogram> = {}): HourlyHistogram => ({
  hourMs: THIS_HOUR - hoursAgo * H,
  metric,
  statusClass: "",
  api: "",
  buckets,
  ...extra,
});
const counter = (hoursAgo: number, metric: string, total: number): HourlyCounter => ({ hourMs: THIS_HOUR - hoursAgo * H, metric, total });

const build = (histograms: HourlyHistogram[], counters: HourlyCounter[] = [], fired = new Map<number, number>(), window: "1h" | "24h" | "7d" = "24h") =>
  buildCharts({ window, lengthMs: window === "1h" ? H : window === "24h" ? DAY : 7 * DAY, nowMs: NOW, histograms, counters, fired });

function available(out: ReturnType<typeof build>) {
  if (!out.available) throw new Error("expected charts");
  expect(MetricsChartsSectionSchema.safeParse(out).success).toBe(true);
  return out;
}

describe("chartsBounds", () => {
  it("ends the trend at the current hour, a day for 1h and 24h and a week for 7d, and reaches back over the previous window", () => {
    expect(chartsBounds("1h", H, NOW)).toMatchObject({ points: 25, trendFrom: THIS_HOUR - 24 * H, currentFrom: THIS_HOUR - H, previousFrom: THIS_HOUR - 2 * H, rangeFrom: THIS_HOUR - 24 * H });
    expect(chartsBounds("24h", DAY, NOW)).toMatchObject({ points: 25, trendFrom: THIS_HOUR - 24 * H, rangeFrom: THIS_HOUR - 48 * H });
    expect(chartsBounds("7d", 7 * DAY, NOW)).toMatchObject({ points: 169, trendFrom: THIS_HOUR - 168 * H, rangeFrom: THIS_HOUR - 336 * H });
  });

  it("keeps the point count fixed when now falls exactly on the hour", () => {
    const b = chartsBounds("24h", DAY, THIS_HOUR);
    expect(b.points).toBe(25);
    expect(b.trendFrom).toBe(THIS_HOUR - 24 * H);
  });
});

describe("buildCharts", () => {
  it("says no_data when nothing was recorded", () => {
    expect(build([])).toEqual({ available: false, reason: "no_data" });
  });

  it("puts each hour at its index, with null request counts for an hour with no request rows and 0 for a quiet class", () => {
    const out = available(build([hist(0, "http.server.request.duration", at(2, 3), { statusClass: "2xx" }), hist(2, "http.server.request.duration", at(2, 1), { statusClass: "4xx" })]));
    const { c2xx, c4xx, c5xx } = out.trend.requests;
    expect(out.trend.from).toBe(new Date(THIS_HOUR - 24 * H).toISOString());
    expect([c2xx.at(-1), c4xx.at(-1), c5xx.at(-1)]).toEqual([3, 0, 0]);
    expect([c2xx.at(-3), c4xx.at(-3)]).toEqual([0, 1]);
    expect(c2xx.at(-2)).toBeNull();
    expect(c2xx[0]).toBeNull();
  });

  it("counts 1xx toward latency but not toward the per-class counts", () => {
    const out = available(build([hist(0, "http.server.request.duration", at(0, 4), { statusClass: "1xx" })]));
    expect(out.trend.requests.c2xx.at(-1)).toBe(0);
    expect(out.trend.requestMs.p95.at(-1)).toBe(1);
    expect(out.headline.current.requests).toBe(4);
  });

  it("gives bucket upper bounds per hour, the over value for the open bucket and null for an hour without data", () => {
    const out = available(build([hist(0, "satis.poller.lag", at(12)), hist(1, "satis.poller.lag", at(5))]));
    expect(out.trend.pollLagP95Ms.at(-1)).toBe(METRICS_TREND_OVER_MS);
    expect(out.trend.pollLagP95Ms.at(-2)).toBe(50);
    expect(out.trend.pollLagP95Ms.at(-3)).toBeNull();
  });

  it("splits game-server calls by upstream and ignores an unknown one", () => {
    const out = available(
      build([
        hist(0, "http.server.upstream.duration", at(3), { api: "vanilla" }),
        hist(0, "http.server.upstream.duration", at(6), { api: "frm" }),
        hist(0, "http.server.upstream.duration", at(12), { api: "other" }),
      ]),
    );
    expect([out.trend.upstreamP95Ms.vanilla.at(-1), out.trend.upstreamP95Ms.frm.at(-1)]).toEqual([10, 100]);
  });

  it("fills counters and fired alerts with 0 for quiet hours", () => {
    const fired = new Map([[THIS_HOUR - H, 2]]);
    const out = available(build([], [counter(0, "satis.agent.refused", 3), counter(0, "satis.unrelated", 9)], fired));
    expect(out.trend.agentRefused.at(-1)).toBe(3);
    expect(out.trend.agentRefused.at(-2)).toBe(0);
    expect(out.trend.alertsFired.at(-2)).toBe(2);
    expect(out.trend.pushDropped.every((n) => n === 0)).toBe(true);
  });

  it("computes the headline for the window and the one before it from summed buckets", () => {
    const req = (hoursAgo: number, cls: string, buckets: number[]) => hist(hoursAgo, "http.server.request.duration", buckets, { statusClass: cls });
    const out = available(
      build(
        [req(0, "2xx", at(3, 8)), req(0, "5xx", at(9, 2)), req(30, "2xx", at(2, 5)), hist(30, "satis.agent.ingest.lag", at(7))],
        [counter(1, "satis.history.rows_dropped", 4), counter(30, "satis.signup.refused", 1)],
        new Map([[THIS_HOUR - 3 * H, 1]]),
      ),
    );
    const { current, previous } = out.headline;
    expect(current).toMatchObject({ hours: 24.5, requests: 10, serverErrors: 2, requestP95Ms: 1000, agentLagP95Ms: null, alertsFired: 1, refusedAndDropped: 4 });
    expect(previous).toMatchObject({ hours: 24, requests: 5, serverErrors: 0, requestP95Ms: 5, agentLagP95Ms: 200, alertsFired: 0, refusedAndDropped: 1 });
  });

  it("says null requests in a headline window with no request rows, not zero", () => {
    const out = available(build([hist(0, "satis.poller.lag", at(1))]));
    expect(out.headline.current).toMatchObject({ requests: null, serverErrors: null, requestP95Ms: null });
  });

  it("drops a section the contract refuses to no_data instead of throwing", () => {
    const bad = at(2, Number.NaN);
    expect(build([hist(0, "http.server.request.duration", bad, { statusClass: "2xx" })])).toEqual({ available: false, reason: "no_data" });
  });

  it("keeps the last point as the current partial hour and counts a full hour when now is on the hour", () => {
    const out = buildCharts({
      window: "1h",
      lengthMs: H,
      nowMs: THIS_HOUR,
      histograms: [hist(0, "satis.poller.lag", at(1))],
      counters: [],
      fired: new Map([[THIS_HOUR, 2]]),
    });
    const section = available(out);
    expect(section.trend.alertsFired.at(-1)).toBe(2);
    expect(section.trend.pollLagP95Ms.at(-1)).toBe(2);
    expect(section.headline.current.hours).toBe(1);
    expect(section.headline.current.alertsFired).toBe(2);
  });

  it("builds a full week within the contract", () => {
    const histograms = Array.from({ length: 169 }, (_, i) => hist(i, "http.server.request.duration", at(i % 13, 10 + i), { statusClass: "2xx" }));
    const out = available(build(histograms, [], new Map(), "7d"));
    expect(out.trend.points).toBe(169);
    expect(out.trend.requests.c2xx.every((n) => n !== null)).toBe(true);
  });
});
