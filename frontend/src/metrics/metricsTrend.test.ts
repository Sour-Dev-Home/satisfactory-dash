import { describe, expect, it } from "vitest";
import { METRICS_TREND_OVER_MS } from "@satisfactory-dash/shared";
import { metricsChartsDay, metricsChartsWeekFull, metricsOverviewAvailable, metricsOverviewWithCharts } from "@satisfactory-dash/shared/fixtures";
import {
  alertsChartSpec,
  bucketChange,
  chartsData,
  errorRateSeries,
  headlineTiles,
  percentChange,
  previousWords,
  sparklinePath,
  stackSeries,
  sumSeries,
  systemChartSpecs,
  trendCaption,
  trendMsText,
  trendTimes,
  worstMs,
} from "./metricsTrend";

describe("trendMsText", () => {
  it("reads a bucket bound, the over value as above the last bucket, and null as no data", () => {
    expect(trendMsText(200)).toBe("≤ 200 ms");
    expect(trendMsText(2000)).toBe("≤ 2 s");
    expect(trendMsText(METRICS_TREND_OVER_MS)).toBe("> 5 s");
    expect(trendMsText(null)).toBe("No data");
  });
});

describe("percentChange", () => {
  it("says up or down by a whole percent, and which way is worse", () => {
    expect(percentChange(112, 100, true)).toEqual({ text: "Up 12%", direction: "up", tone: "worse", relative: true });
    expect(percentChange(97, 100, true)).toEqual({ text: "Down 3%", direction: "down", tone: "better", relative: true });
    expect(percentChange(150, 100, null)).toMatchObject({ text: "Up 50%", tone: "neutral" });
    expect(percentChange(2600, 100, true).text).toBe("Up 2,500%");
  });

  it("calls a change under half a percent about the same", () => {
    expect(percentChange(1003, 1000, true)).toMatchObject({ text: "About the same", direction: "same", tone: "neutral" });
  });

  it("has no comparison when either side is unknown or the one before is zero", () => {
    for (const [current, previous] of [
      [null, 10],
      [10, null],
      [5, 0],
      [0, 0],
    ] as const) {
      expect(percentChange(current, previous, true)).toEqual({ text: "No comparison", direction: null, tone: "neutral" });
    }
  });
});

describe("bucketChange", () => {
  it("names both buckets when the percentile moved, higher being worse", () => {
    expect(bucketChange(200, 100)).toEqual({ text: "≤ 200 ms, was ≤ 100 ms", direction: "up", tone: "worse" });
    expect(bucketChange(100, 200)).toEqual({ text: "≤ 100 ms, was ≤ 200 ms", direction: "down", tone: "better" });
    expect(bucketChange(METRICS_TREND_OVER_MS, 5000)).toMatchObject({ text: "> 5 s, was ≤ 5 s", tone: "worse" });
  });

  it("says the same, or no comparison when a window had no data", () => {
    expect(bucketChange(2000, 2000)).toMatchObject({ text: "Same as before", tone: "neutral" });
    expect(bucketChange(500, null).text).toBe("No comparison");
    expect(bucketChange(null, 500).text).toBe("No comparison");
  });
});

describe("headlineTiles", () => {
  // The fixture: 4210 requests in 24.5 h (12 of them 5xx), against 3980 in 24 h (4 of them 5xx).
  const tiles = new Map(headlineTiles(metricsChartsDay).map((t) => [t.id, t]));

  it("shows requests per hour, comparing hourly rates, with no good direction", () => {
    expect(tiles.get("requests")).toMatchObject({ label: "Requests per hour", value: "172" });
    expect(tiles.get("requests")?.change).toMatchObject({ text: "Up 4%", tone: "neutral" });
  });

  it("shows the 5xx error rate, worse when it rises", () => {
    expect(tiles.get("errors")?.value).toBe("0.3%");
    expect(tiles.get("errors")?.change).toMatchObject({ text: "Up 184%", tone: "worse" });
  });

  it("shows percentiles as buckets, and their change as the bucket step", () => {
    expect(tiles.get("request-p95")?.value).toBe("≤ 200 ms");
    expect(tiles.get("request-p95")?.change.text).toBe("≤ 200 ms, was ≤ 100 ms");
    expect(tiles.get("poll-lag")?.change.text).toBe("Same as before");
    // The window before had no agent uploads.
    expect(tiles.get("agent-lag")?.change.text).toBe("No comparison");
  });

  it("compares alert and refusal counts per hour, and has no comparison from a zero baseline", () => {
    expect(tiles.get("alerts")).toMatchObject({ value: "3", change: { text: "Up 194%", tone: "worse" } });
    expect(tiles.get("refused")).toMatchObject({ value: "2", change: { text: "No comparison" } });
  });

  it("feeds each sparkline from its trend, timings on a log scale", () => {
    expect(tiles.get("request-p95")?.spark).toEqual(metricsChartsDay.trend.requestMs.p95);
    expect(tiles.get("request-p95")?.sparkLog).toBe(true);
    expect(tiles.get("requests")?.spark[3]).toBeNull();
    expect(tiles.get("requests")?.sparkLog).toBe(false);
  });

  it("says no data for a window without requests", () => {
    const quiet = headlineTiles({
      ...metricsChartsDay,
      headline: { ...metricsChartsDay.headline, current: { ...metricsChartsDay.headline.current, requests: null, serverErrors: null } },
    });
    expect(quiet.find((t) => t.id === "requests")?.value).toBe("No data");
    expect(quiet.find((t) => t.id === "errors")?.value).toBe("No data");
  });
});

describe("series helpers", () => {
  it("sums per hour, keeping an hour with no data at all as a gap", () => {
    expect(sumSeries([[1, null, null], [2, 3, null]])).toEqual([3, 3, null]);
  });

  it("gives the hourly error rate, null for an hour without requests", () => {
    expect(errorRateSeries({ c2xx: [9, 0, null], c3xx: [0, 0, null], c4xx: [0, 0, null], c5xx: [1, 0, null] })).toEqual([0.1, null, null]);
  });

  it("stacks bottom first, a full gap staying a gap", () => {
    expect(stackSeries([[1, null, 0], [2, null, 5]])).toEqual([
      [1, null, 0],
      [3, null, 5],
    ]);
  });

  it("finds the worst bucket, the over value ranking last", () => {
    expect(worstMs([5, null, METRICS_TREND_OVER_MS, 5000])).toBe(METRICS_TREND_OVER_MS);
    expect(worstMs([null, null])).toBeNull();
  });

  it("puts the hours on the x axis in seconds, an hour apart", () => {
    const times = trendTimes(metricsChartsDay.trend);
    expect(times).toHaveLength(25);
    expect(times[0]).toBe(Date.parse(metricsChartsDay.trend.from) / 1000);
    expect(times[1] - times[0]).toBe(3600);
  });

  it("captions the day and the week, the 1 h window included in the day", () => {
    expect(trendCaption(metricsChartsDay.trend)).toBe("Hourly trend, last 24 h");
    expect(trendCaption(metricsChartsWeekFull.trend)).toBe("Hourly trend, last 7 days");
    expect(previousWords("1h")).toBe("the hour before");
  });

  it("finds the charts only when the section has them", () => {
    expect(chartsData(metricsOverviewWithCharts)).toBe(metricsChartsDay);
    expect(chartsData(metricsOverviewAvailable)).toBeNull();
    expect(chartsData({ ...metricsOverviewAvailable, charts: { available: false, reason: "not_built" } })).toBeNull();
  });
});

describe("sparklinePath", () => {
  it("breaks the line at a gap and draws a lone hour as a dot", () => {
    const path = sparklinePath([1, 2, null, 3], false);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).toContain("l0 0");
    expect(path.startsWith("M0 22")).toBe(true);
  });

  it("is empty without data and flat in the middle for a constant series", () => {
    expect(sparklinePath([null, null], false)).toBe("");
    expect(sparklinePath([4, 4], false)).toBe("M0 12L100 12");
  });

  it("scales timings by log, so 10 ms sits halfway between 1 ms and 100 ms", () => {
    expect(sparklinePath([1, 10, 100], true)).toBe("M0 22L50 12L100 2");
  });
});

describe("trend chart specs", () => {
  const specs = new Map(systemChartSpecs(metricsChartsDay.trend).map((s) => [s.id, s]));

  it("draws requests as a stack with 5xx on the baseline in the problem colour, the legend reading 2xx to 5xx", () => {
    const requests = specs.get("requests");
    expect(requests?.bars).toBe(true);
    expect(requests?.series.map((s) => s.label)).toEqual(["2xx", "3xx", "4xx", "5xx"]);
    expect(requests?.series.at(-1)).toMatchObject({ color: "--color-bad", drawn: metricsChartsDay.trend.requests.c5xx });
    // The top of the stack is every class together; the legend still shows the 2xx count.
    expect(requests?.series[0].drawn[0]).toBe(sumSeries(Object.values(metricsChartsDay.trend.requests))[0]);
    expect(requests?.series[0].values).toEqual(metricsChartsDay.trend.requests.c2xx);
    expect(requests?.summary).toMatch(/9 5xx errors in 1 hour\. No data for 1 hour\.$/);
  });

  it("draws timings with the over value kept for the clipped band, and 0 lifted onto the log scale", () => {
    const latency = specs.get("request-latency");
    expect(latency?.series.map((s) => s.color)).toEqual(["--color-ramp-1", "--color-ramp-2", "--color-ramp-3"]);
    expect(latency?.series[2].drawn).toContain(METRICS_TREND_OVER_MS);
    expect(latency?.summary).toContain("p99 > 5 s");
    const zero = systemChartSpecs({ ...metricsChartsDay.trend, dbP95Ms: metricsChartsDay.trend.dbP95Ms.map(() => 0) });
    const db = zero.find((s) => s.id === "database")?.series[0];
    expect(db?.drawn[0]).toBe(1);
    expect(db?.values[0]).toBe(0);
  });

  it("covers every trend in the contract, one chart each", () => {
    expect([...specs.keys()]).toEqual(["requests", "request-latency", "upstream", "database", "lag", "refused"]);
    expect(specs.get("refused")?.series).toHaveLength(5);
    expect(specs.get("refused")?.summary).toBe("2 in all: agent uploads refused 2.");
    expect(alertsChartSpec(metricsChartsDay.trend).summary).toBe("4 alerts fired in 4 hours.");
  });
});
