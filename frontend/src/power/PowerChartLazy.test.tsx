import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import uPlot from "uplot";
import type { PowerHistory } from "@satisfactory-dash/shared";
import { powerHistoryFuseTrip, powerHistoryNormal } from "@satisfactory-dash/shared/fixtures";

// Fresh-eyes tests for the lazy PowerChart chunk (PR #93). Each test re-imports the panel
// after vi.resetModules so its module-level React.lazy starts unresolved, and controls the
// chunk through vi.doMock("./PowerChart").

type Plot = { data: unknown[][]; destroyed: boolean };
const plots = () => (uPlot as unknown as { instances: Plot[] }).instances;

type Panel = ComponentType<{ history: PowerHistory }>;

async function loadPanel(): Promise<Panel> {
  return (await import("./PowerHistoryPanel")).PowerHistoryPanel as Panel;
}

/** The history with one more reading appended to every series. */
function withOneMore(h: PowerHistory): PowerHistory {
  return {
    ...h,
    series: h.series.map((s) => {
      const last = s.points.at(-1)!;
      return { ...s, points: [...s.points, { ...last, t: last.t + h.intervalSeconds * 1000, productionMW: 4321 }] };
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock("./PowerChart");
});

describe("lazy PowerChart", () => {
  it("draws the chart after a chunk load failure once the operator presses Try again", async () => {
    let attempts = 0;
    vi.doMock("./PowerChart", async () => {
      attempts++;
      if (attempts === 1) throw new TypeError("Failed to fetch dynamically imported module");
      return vi.importActual<typeof import("./PowerChart")>("./PowerChart");
    });
    const PowerHistoryPanel = await loadPanel();
    const { ErrorBoundary } = await import("../components/ErrorBoundary");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <ErrorBoundary label="Power history">
        <PowerHistoryPanel history={powerHistoryNormal.data} />
      </ErrorBoundary>,
    );
    // The rejection reaches the section's boundary, not the whole app.
    expect(await screen.findByRole("alert", { name: "Power history error" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    // React.lazy caches the rejected promise, so without a fresh import() this never recovers.
    await waitFor(() => expect(container.querySelector(".power-chart")).not.toBeNull(), { timeout: 2000 });
    expect(attempts).toBe(2);
    error.mockRestore();
  });

  it("gives the chart the latest data when a poll lands while the chunk is still loading", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.doMock("./PowerChart", async () => {
      await gate;
      return vi.importActual<typeof import("./PowerChart")>("./PowerChart");
    });
    const PowerHistoryPanel = await loadPanel();
    const before = plots().length;
    const first = powerHistoryNormal.data;
    const { container, rerender } = render(<PowerHistoryPanel history={first} />);
    expect(container.querySelector("[data-chart-loading]")).not.toBeNull();

    const next = withOneMore(first);
    rerender(<PowerHistoryPanel history={next} />);
    await act(async () => release());

    await waitFor(() => expect(plots().length).toBe(before + 1));
    const plot = plots().at(-1)!;
    expect(plot.data[0]).toHaveLength(next.series[0].points.length);
    expect(plot.data[1].at(-1)).toBe(4321);
  });

  it("draws one chart per circuit and never falls back to the placeholder on a poll or a new circuit", async () => {
    const PowerHistoryPanel = await loadPanel();
    const one: PowerHistory = { ...powerHistoryFuseTrip.data, series: powerHistoryFuseTrip.data.series.slice(0, 1) };
    const { container, rerender } = render(<PowerHistoryPanel history={one} />);
    await waitFor(() => expect(container.querySelectorAll(".power-chart")).toHaveLength(1));
    const firstPlot = plots().at(-1)!;

    // A poll appends: same chart, no placeholder, no remount.
    rerender(<PowerHistoryPanel history={withOneMore(one)} />);
    expect(container.querySelector("[data-chart-loading]")).toBeNull();
    expect(firstPlot.destroyed).toBe(false);

    // A second circuit appears: it draws straight away (the chunk is loaded), the first stays.
    rerender(<PowerHistoryPanel history={powerHistoryFuseTrip.data} />);
    expect(container.querySelector("[data-chart-loading]")).toBeNull();
    expect(container.querySelectorAll(".power-chart")).toHaveLength(powerHistoryFuseTrip.data.series.length);
    expect(firstPlot.destroyed).toBe(false);
  });
});
