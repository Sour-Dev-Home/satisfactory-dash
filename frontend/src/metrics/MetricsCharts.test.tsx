import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import uPlot from "uplot";
import { metricsChartsDay, metricsOverviewAvailable, metricsOverviewWithCharts } from "@satisfactory-dash/shared/fixtures";
import { HeadlineRow } from "./MetricsCharts";
import { MetricsSections } from "./MetricsSections";

// ADR-0056 amendment 2026-10-26: the chart-led page. The tiles' words carry every number (the sparklines and charts are
// aria-hidden), a worse change says so in words and an icon, and the tables stay as folded Details.

const plots = () => (uPlot as unknown as { instances: { data: unknown[][] }[] }).instances;

const tile = (id: string) => {
  const el = document.querySelector(`[data-tile='${id}']`);
  if (!(el instanceof HTMLElement)) throw new Error(`no tile ${id}`);
  return within(el);
};

describe("the headline row", () => {
  it("shows the window's numbers with their change on the window before", () => {
    render(<HeadlineRow overview={metricsOverviewWithCharts} />);
    const row = screen.getByRole("region", { name: "At a glance" });
    expect(within(row).getAllByRole("listitem")).toHaveLength(7);
    expect(tile("requests").getByText("Requests per hour")).toBeInTheDocument();
    expect(tile("requests").getByText("172")).toBeInTheDocument();
    expect(tile("requests").getByText(/Up 4% on the 24 hours before/)).toBeInTheDocument();
    expect(tile("request-p95").getByText("≤ 200 ms", { selector: ".text-xl" })).toBeInTheDocument();
  });

  it("says a worse change in words with an icon, never by colour alone", () => {
    render(<HeadlineRow overview={metricsOverviewWithCharts} />);
    const change = tile("request-p95").getByText(/was ≤ 100 ms/);
    expect(change).toHaveTextContent("▲≤ 200 ms, was ≤ 100 ms, worse");
    expect(change).toHaveAttribute("data-tone", "worse");
    // A rise in traffic is neither better nor worse.
    expect(tile("requests").getByText(/Up 4%/)).toHaveAttribute("data-tone", "neutral");
    expect(tile("requests").getByText(/Up 4%/)).not.toHaveTextContent("worse");
  });

  it("says there is no comparison when the window before had nothing", () => {
    render(<HeadlineRow overview={metricsOverviewWithCharts} />);
    expect(tile("agent-lag").getByText("No comparison")).toBeInTheDocument();
    expect(tile("refused").getByText("No comparison")).toBeInTheDocument();
  });

  it("draws a decorative sparkline per tile", () => {
    const { container } = render(<HeadlineRow overview={metricsOverviewWithCharts} />);
    const sparks = container.querySelectorAll("[data-tile] svg");
    expect(sparks).toHaveLength(7);
    for (const svg of sparks) expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("says charts aren't available yet when an older backend sends none", () => {
    render(<HeadlineRow overview={metricsOverviewAvailable} />);
    expect(screen.getByText(/^Charts not available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("gives the backend's reason when the charts section says why", () => {
    render(<HeadlineRow overview={{ ...metricsOverviewAvailable, charts: { available: false, reason: "no_data" } }} />);
    expect(screen.getByText(/^Charts not available yet: nothing has been recorded/)).toBeInTheDocument();
  });
});

describe("the charts and their Details", () => {
  it("draws every trend from one lazy chunk, each with a text summary, and folds the tables under them", async () => {
    const before = plots().length;
    const { container } = render(<MetricsSections overview={metricsOverviewWithCharts} />);
    const system = screen.getByRole("region", { name: "System" });
    expect(within(system).getByRole("figure", { name: "Requests per hour, by status class" })).toBeInTheDocument();
    expect(within(system).getByText(/9 5xx errors in 1 hour/)).toBeInTheDocument();
    expect(within(system).getAllByText(/^Hourly trend, last 24 h/)).toHaveLength(1);
    const alerts = screen.getByRole("region", { name: "Alert quality" });
    expect(within(alerts).getByRole("figure", { name: "Alerts fired per hour" })).toBeInTheDocument();
    await waitFor(() => expect(plots().length - before).toBe(7));
    expect(plots().at(-1)?.data[0]).toHaveLength(metricsChartsDay.trend.points);
    for (const chart of container.querySelectorAll(".trend-chart")) expect(chart).toHaveAttribute("aria-hidden", "true");

    // The tables are the text path: in closed Details under the charts.
    const details = container.querySelectorAll("details[data-details]");
    expect(details).toHaveLength(4);
    for (const d of details) expect(d).not.toHaveAttribute("open");
    expect(within(system).getByText("System details: every timing and counter")).toBeInTheDocument();
    expect(within(system).getByText(/Timings are bucket upper bounds/).closest("details")).not.toBeNull();
    expect(within(alerts).getByText("Power outage").closest("details")).not.toBeNull();
  });

  it("keeps the Details when there are no charts, and draws nothing", () => {
    const before = plots().length;
    const { container } = render(<MetricsSections overview={metricsOverviewAvailable} />);
    expect(screen.getByText(/^Charts not available yet/)).toBeInTheDocument();
    expect(container.querySelectorAll("figure")).toHaveLength(0);
    expect(container.querySelectorAll("details[data-details]")).toHaveLength(4);
    expect(screen.getByText("abc123")).toBeInTheDocument();
    expect(plots().length).toBe(before);
  });
});
