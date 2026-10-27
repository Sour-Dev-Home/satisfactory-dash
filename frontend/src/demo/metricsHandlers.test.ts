import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, METRICS_TREND_OVER_MS, METRICS_WINDOWS, MetricsOverviewSchema, metricsTrendPoints } from "@satisfactory-dash/shared";
import { resetDemoState } from "./handlers";
import { demoMetricsOverview } from "./metrics";
import { transport } from "./transport";

// ADR-0056 PR 5: the demo serves the operator's metrics from its own made-up world (demo/metrics.ts), through the demo
// transport, with the same query rules as the backend. Nothing here may use the network.

const call = (path: string) => transport(path, { method: "GET", credentials: "include" });
const signIn = () =>
  transport(endpoints.auth.login.path(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "demo", password: "demo" }),
  });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetDemoState();
  fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not use the network")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("the demo's metrics route", () => {
  it("is a 401 until the visitor enters the demo", async () => {
    expect((await call(endpoints.metrics.overview.path())).status).toBe(401);
  });

  it("answers every window with a body the contract accepts, and the window it was asked for", async () => {
    await signIn();
    for (const window of METRICS_WINDOWS) {
      const res = await call(`${endpoints.metrics.overview.path()}?window=${window}`);
      expect(res.status).toBe(200);
      expect(MetricsOverviewSchema.parse(await res.json()).window).toBe(window);
    }
  });

  it("defaults to 24h on a bare GET, like the contract says", async () => {
    await signIn();
    const body = MetricsOverviewSchema.parse(await (await call(endpoints.metrics.overview.path())).json());
    expect(body.window).toBe("24h");
  });

  it("refuses a window the contract doesn't have, like the backend", async () => {
    await signIn();
    const res = await call(`${endpoints.metrics.overview.path()}?window=30d`);
    expect(res.status).toBe(400);
  });
});

describe("the demo's metrics world", () => {
  const NOW = Date.parse("2026-10-25T12:00:00Z");

  it("scales counts with the window and keeps percentiles as bucket bounds", () => {
    const hour = demoMetricsOverview(NOW, "1h");
    const week = demoMetricsOverview(NOW, "7d");
    if (!hour.system.available || !week.system.available) throw new Error("the demo system section has data");
    expect(week.system.histograms[0].count).toBeGreaterThan(hour.system.histograms[0].count);
    expect(week.system.histograms[0].p95Ms).toBe(hour.system.histograms[0].p95Ms);
  });

  it("has charts for every window that the contract accepts: a day of hours, a week for 7d, one bad hour", () => {
    for (const window of METRICS_WINDOWS) {
      const overview = MetricsOverviewSchema.parse(demoMetricsOverview(NOW, window));
      const charts = overview.charts;
      if (!charts?.available) throw new Error("the demo has charts");
      expect(charts.trend.points).toBe(metricsTrendPoints(window));
      // The trend ends in the current hour, on the hour.
      expect(Date.parse(charts.trend.from) + (charts.trend.points - 1) * 3_600_000).toBe(Date.parse("2026-10-25T12:00:00Z"));
      expect(charts.trend.requestMs.p99).toContain(METRICS_TREND_OVER_MS);
      expect(charts.trend.requests.c5xx.some((n) => (n ?? 0) > 1)).toBe(true);
    }
    const week = demoMetricsOverview(NOW, "7d").charts;
    if (!week?.available) throw new Error("the demo has charts");
    expect(week.trend.requests.c2xx).toContain(null);
  });

  it("covers the last three calendar months, across a year boundary too", () => {
    const months = (now: string) => {
      const alerts = demoMetricsOverview(Date.parse(now), "24h").alerts;
      if (!alerts.available) throw new Error("the demo alerts section has data");
      return [...new Set(alerts.months.map((m) => m.month))];
    };
    expect(months("2026-10-25T12:00:00Z")).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(months("2026-01-05T12:00:00Z")).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("has no personal data: only invented ids and the public status and probe links", () => {
    const text = JSON.stringify(demoMetricsOverview(NOW, "24h"));
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/[A-Za-z]:\\/);
  });
});
