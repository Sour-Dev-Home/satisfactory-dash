import { fireEvent, render, screen, within } from "@testing-library/react";
import type { HistoryItems } from "@satisfactory-dash/shared";
import { historyItems7d, historyTransitions24h } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it, vi } from "vitest";
import * as world from "../demo/world";
import type { ItemLabel } from "./itemLabels";
import { ItemHistoryPanel } from "./ItemHistoryPanel";
import { SinceYesterdayPanel } from "./SinceYesterdayPanel";

// uPlot needs a canvas; the chart is a lazy chunk anyway. Stand in for it with what it was given.
vi.mock("./ItemChart", () => ({
  ItemChart: ({ data, unitLabel }: { data: unknown[][]; unitLabel: string }) => (
    <div data-testid="item-chart" data-unit={unitLabel} data-points={data[0].length} />
  ),
}));

const labels = new Map<string, ItemLabel>([
  ["Desc_IronPlate_C", { name: "Iron Plate", unit: "items/min" }],
  ["Desc_IronScrew_C", { name: "Screw", unit: "items/min" }],
  ["Desc_Rotor_C", { name: "Rotor", unit: "items/min" }],
  ["Desc_HeavyOilResidue_C", { name: "Heavy Oil Residue", unit: "m3/min" }],
]);
const demo7d = world.historyItems(world.DEMO_EPOCH, "7d").data;

describe("SinceYesterdayPanel", () => {
  it("leads with the biggest drop, as text, and names the hour compared", () => {
    render(<SinceYesterdayPanel history={demo7d} labels={labels} />);
    // Yesterday's numbers ride the demo's gentle daily wave, so match them loosely.
    expect(screen.getByText(/^Biggest drop: Rotor: [\d.]+ → 0 items\/min \(−100%\)$/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Since yesterday · this hour yesterday \(\d\d?:\d\d( [AP]M)?\)$/ })).toBeInTheDocument();
    const down = screen.getByRole("list", { name: "Down" });
    const lines = within(down).getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^▼Rotor: [\d.]+ → 0 items\/min \(−100%\)$/);
    expect(lines[1]).toMatch(/^▼Screw: [\d.]+ → 30 items\/min \(−2\d%\)$/);
    for (const glyph of down.querySelectorAll("span")) expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("list", { name: "Up" })).not.toBeInTheDocument();
  });

  it("counts state changes in the last 24 h, with + when the backend held more back", () => {
    render(<SinceYesterdayPanel history={demo7d} transitions={historyTransitions24h.data} labels={labels} />);
    expect(screen.getByText("Machines changed state 2+ times in the last 24 h.")).toBeInTheDocument();
  });

  it("says 1 time, in the singular", () => {
    const one = { ...historyTransitions24h.data, truncated: false, transitions: historyTransitions24h.data.transitions.slice(0, 1) };
    render(<SinceYesterdayPanel history={demo7d} transitions={one} labels={labels} />);
    expect(screen.getByText("Machines changed state 1 time in the last 24 h.")).toBeInTheDocument();
  });

  it("says there isn't enough history yet, with no empty list", () => {
    render(<SinceYesterdayPanel history={historyItems7d.data} labels={labels} />);
    expect(screen.getByText("Not enough history yet: this compares with the same hour yesterday.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("says when nothing changed much", () => {
    const flat: HistoryItems = { ...demo7d, series: demo7d.series.filter((s) => s.item === "Desc_IronPlate_C") };
    render(<SinceYesterdayPanel history={flat} labels={labels} />);
    expect(screen.getByText("No big changes since this hour yesterday.")).toBeInTheDocument();
  });
});

describe("ItemHistoryPanel", () => {
  const day = world.historyItems(world.DEMO_EPOCH, "24h").data;

  it("shows the highest-rate item first, with a text summary in its own unit and a chart", async () => {
    render(<ItemHistoryPanel history={day} labels={labels} item={undefined} onItem={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Item" })).toHaveValue("Desc_IronIngot_C");
    // Not in today's labels: the class name made readable, and "per min", never a guessed unit.
    expect(screen.getByText(/^Iron Ingot, last 24 hours: average [\d.]+ per min, low [\d.]+ per min, high 75 per min; capacity 75 per min\.$/)).toBeInTheDocument();
    expect(await screen.findByTestId("item-chart")).toHaveAttribute("data-unit", "per min");
  });

  it("switches item through its callback and charts the chosen one in its unit", async () => {
    const onItem = vi.fn();
    render(<ItemHistoryPanel history={day} labels={labels} item="Desc_HeavyOilResidue_C" onItem={onItem} />);
    expect(await screen.findByTestId("item-chart")).toHaveAttribute("data-unit", "m³/min");
    fireEvent.change(screen.getByRole("combobox", { name: "Item" }), { target: { value: "Desc_IronScrew_C" } });
    expect(onItem).toHaveBeenCalledWith("Desc_IronScrew_C");
  });

  it("falls back to the first item when the chosen one isn't in this range", () => {
    render(<ItemHistoryPanel history={day} labels={labels} item="Desc_Gone_C" onItem={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Item" })).toHaveValue("Desc_IronIngot_C");
  });

  it("breaks the line at a gap: one null point per missing stretch", async () => {
    const week = world.historyItems(world.DEMO_EPOCH, "7d").data;
    render(<ItemHistoryPanel history={week} labels={labels} item="Desc_IronPlate_C" onItem={() => {}} />);
    const points = week.series.find((s) => s.item === "Desc_IronPlate_C")!.points.length;
    expect(Number((await screen.findByTestId("item-chart")).dataset.points)).toBe(points + 1);
  });

  it("says when nothing was recorded, or only one reading", () => {
    const { rerender } = render(<ItemHistoryPanel history={{ ...day, series: [] }} labels={labels} item={undefined} onItem={() => {}} />);
    expect(screen.getByText("No production history recorded in this range yet.")).toBeInTheDocument();
    rerender(<ItemHistoryPanel history={historyItems7d.data} labels={labels} item="Desc_Wire_C" onItem={() => {}} />);
    expect(screen.getByText("Only one reading in this range so far.")).toBeInTheDocument();
  });

  it("says when the backend capped the list at 50 items", () => {
    render(<ItemHistoryPanel history={{ ...day, truncated: true }} labels={labels} item={undefined} onItem={() => {}} />);
    expect(screen.getByText("Showing the 50 items made fastest in this range.")).toBeInTheDocument();
  });
});
