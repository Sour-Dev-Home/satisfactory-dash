import { describe, expect, it } from "vitest";
import type { CounterSummary, HistogramSummary } from "@satisfactory-dash/shared";
import { METRICS_UNAVAILABLE_REASONS } from "@satisfactory-dash/shared";
import {
  countText,
  groupHistograms,
  hoursText,
  labelsText,
  metricName,
  monthText,
  percentileText,
  rateText,
  resolveText,
  sortAlertMonths,
  splitCounters,
  unavailableText,
  windowWords,
} from "./metricsText";

const hist = (metric: string, labels: Record<string, string> = {}): HistogramSummary => ({ metric, labels, count: 1, p50Ms: 1, p95Ms: 2, p99Ms: 5 });
const counter = (metric: string): CounterSummary => ({ metric, labels: {}, total: 1 });

describe("percentileText: bucket upper bounds, never interpolated", () => {
  it("shows a bound under a second in ms and from a second in s", () => {
    expect(percentileText(1)).toBe("≤ 1 ms");
    expect(percentileText(200)).toBe("≤ 200 ms");
    expect(percentileText(1000)).toBe("≤ 1 s");
    expect(percentileText(2000)).toBe("≤ 2 s");
  });
  it("shows the open-ended last bucket as above the largest bound", () => {
    expect(percentileText(null)).toBe("> 5 s");
  });
});

describe("labels and names", () => {
  it("spells labels out without losing the value, and says nothing for none", () => {
    expect(labelsText({ route: "/api/health", status_class: "2xx" })).toBe("route /api/health, status class 2xx");
    expect(labelsText({})).toBe("");
  });
  it("names the known metrics and shows an unknown one as its registry name", () => {
    expect(metricName("satis.poller.lag")).toBe("Poll lag");
    expect(metricName("satis.future.thing")).toBe("satis.future.thing");
  });
  it("looks a hostile metric name up as text, not as a property", () => {
    expect(metricName("__proto__")).toBe("__proto__");
    expect(metricName("constructor")).toBe("constructor");
    expect(windowWords("7d")).toBe("the last 7 days");
  });
});

describe("grouping", () => {
  it("splits histograms into their groups in reading order and puts unknown ones last", () => {
    const groups = groupHistograms([
      hist("satis.poller.lag"),
      hist("db.client.operation.duration"),
      hist("http.server.request.duration"),
      hist("satis.brand.new"),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["requests", "database", "lag", "other"]);
    expect(groups.at(-1)?.rows.map((r) => r.metric)).toEqual(["satis.brand.new"]);
  });
  it("leaves out empty groups, and none at all for no histograms", () => {
    expect(groupHistograms([])).toEqual([]);
  });
  it("calls rows written the work done and every other counter refused or dropped", () => {
    const { throughput, refused } = splitCounters([counter("satis.history.rows_written"), counter("satis.agent.refused"), counter("satis.new")]);
    expect(throughput.map((c) => c.metric)).toEqual(["satis.history.rows_written"]);
    expect(refused.map((c) => c.metric)).toEqual(["satis.agent.refused", "satis.new"]);
  });
});

describe("alert quality text", () => {
  it("sorts the newest month first, then by kind", () => {
    const row = (month: string, kind: string) => ({ month, kind, fired: 1, flaps: 0, medianResolveSeconds: null });
    const sorted = sortAlertMonths([row("2026-08", "b"), row("2026-10", "b"), row("2026-10", "a")]);
    expect(sorted.map((r) => `${r.month} ${r.kind}`)).toEqual(["2026-10 a", "2026-10 b", "2026-08 b"]);
  });
  it("names months and says when nothing resolved", () => {
    expect(monthText("2026-10")).toBe("October 2026");
    expect(monthText("2026-13")).toBe("2026-13");
    expect(resolveText(null)).toBe("None resolved");
    expect(resolveText(1260)).toBe("21 m");
  });
  it("formats rates and hours, with n/a for none", () => {
    expect(rateText(0.038)).toBe("3.8%");
    expect(rateText(null)).toBe("n/a");
    expect(hoursText(2.44)).toBe("2.4 h");
    expect(hoursText(null)).toBe("n/a");
    expect(countText(41230)).toBe("41,230");
  });
});

describe("unavailableText", () => {
  it("has its own copy for every section and reason, none empty or repeated", () => {
    const all = (["system", "alerts", "delivery"] as const).flatMap((section) =>
      METRICS_UNAVAILABLE_REASONS.map((reason) => unavailableText(section, reason)),
    );
    expect(all).toHaveLength(9);
    expect(new Set(all).size).toBe(9);
    for (const text of all) expect(text.length).toBeGreaterThan(10);
  });
});
