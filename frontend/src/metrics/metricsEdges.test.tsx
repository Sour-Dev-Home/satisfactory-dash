import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { metricsOverviewAvailable } from "@satisfactory-dash/shared/fixtures";
import { DeliverySection, SystemSection } from "./MetricsSections";
import { groupHistograms, hoursText, monthText, percentileText } from "./metricsText";
import { demoMetricsOverview } from "../demo/metrics";

describe("metrics edge cases", () => {
  it("rounds the merged-per-day figure instead of printing a raw float", () => {
    const overview = metricsOverviewAvailable;
    if (!overview.delivery.available) throw new Error("fixture must have delivery");
    const snapshot = { ...overview.delivery.snapshot, throughput: { ...overview.delivery.snapshot.throughput, perDay: 10 / 7 } };
    render(<DeliverySection delivery={{ ...overview.delivery, snapshot }} />);
    expect(screen.getByText(/1\.4 a day/)).toBeInTheDocument();
    expect(screen.queryByText(/1\.428/)).toBeNull();
  });

  it("keeps odd month strings readable instead of throwing", () => {
    expect(monthText("2026-13")).toBe("2026-13");
    expect(monthText("2026-00")).toBe("2026-00");
    expect(monthText("garbage")).toBe("garbage");
    expect(monthText("2026-01")).toBe("January 2026");
    expect(monthText("2026-12")).toBe("December 2026");
  });

  it("shows sub-second, whole-second and fractional-second bounds", () => {
    expect(percentileText(0)).toBe("≤ 0 ms");
    expect(percentileText(1000)).toBe("≤ 1 s");
    expect(percentileText(2500)).toBe("≤ 2.5 s");
    expect(hoursText(0)).toBe("0 h");
  });

  it("renders duplicate metric+label rows without key collisions", () => {
    const dup = { metric: "x.unknown", labels: {}, count: 1, p50Ms: 1, p95Ms: 1, p99Ms: 1 };
    const system = {
      available: true as const,
      asOf: "2026-10-01T00:00:00.000Z",
      histograms: [dup, dup],
      counters: [],
      servers: [],
    };
    const errors: unknown[] = [];
    const spy = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      render(<SystemSection system={system} />);
    } finally {
      console.error = spy;
    }
    expect(errors).toEqual([]);
    expect(screen.getAllByText("x.unknown")).toHaveLength(2);
    expect(groupHistograms([dup, dup])).toHaveLength(1);
  });

  it("builds the demo's alert months across a year boundary and for every window", () => {
    const jan = Date.UTC(2027, 0, 15);
    const alerts = demoMetricsOverview(jan, "1h").alerts;
    if (!alerts.available) throw new Error("demo alerts must be available");
    expect(new Set(alerts.months.map((m) => m.month))).toEqual(new Set(["2026-11", "2026-12", "2027-01"]));
    const dec = demoMetricsOverview(Date.UTC(2026, 11, 31, 23, 59), "7d").alerts;
    if (!dec.available) throw new Error("demo alerts must be available");
    expect(new Set(dec.months.map((m) => m.month))).toEqual(new Set(["2026-10", "2026-11", "2026-12"]));
  });
});
