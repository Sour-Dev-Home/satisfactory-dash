import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FactoryResponse } from "@satisfactory-dash/shared";
import {
  factoryEmpty,
  factoryMixed,
  factoryOldBackend,
  factoryUnknownItem,
} from "@satisfactory-dash/shared/fixtures";
import { FactoryPanel } from "./FactoryPanel";

function rows(): HTMLElement[] {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

function rowFor(recipe: string): HTMLElement {
  const row = rows().find((r) => within(r).queryByText(recipe, { selector: "td" }));
  if (!row) throw new Error(`no row with recipe ${recipe}`);
  return row;
}

function pick(label: string) {
  fireEvent.click(within(screen.getByRole("group", { name: "Filter machines" })).getByRole("button", { name: label }));
}

describe("FactoryPanel", () => {
  it("summarizes the factory, taking the backed-up count from the backend", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    expect(screen.getByText("5 machines · 2 backed up · 0 paused · 1 without a recipe")).toBeInTheDocument();
    expect(rows()).toHaveLength(5);
  });

  it("treats backed-up as information: a tag and a filter, never an alert", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(rowFor("Stator")).getByText("Backed up")).toBeInTheDocument();
    pick("Backed up");
    expect(rows()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Backed up" })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters to machines without a recipe and labels them", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    pick("No recipe");
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByText("No recipe", { selector: "td" })).toBeInTheDocument();
    expect(within(rows()[0]).getByText("—")).toBeInTheDocument();
  });

  it("filters to paused machines", () => {
    const [first, ...rest] = factoryMixed.data.buildings;
    const withPaused = {
      ...factoryMixed,
      data: { ...factoryMixed.data, buildings: [{ ...first, isPaused: true }, ...rest] },
    } satisfies FactoryResponse;
    render(<FactoryPanel snapshot={withPaused} />);
    pick("Paused");
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByText("Paused")).toBeInTheDocument();
  });

  it("searches by machine or recipe name, case-insensitively", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    fireEvent.change(screen.getByLabelText("Search machines"), { target: { value: "refin" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search machines"), { target: { value: "STATOR" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search machines"), { target: { value: "nothing like this" } });
    expect(screen.getByText("No machines match.")).toBeInTheDocument();
  });

  it("shows activity from the averaged percent even when isProducing is false", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    expect(rowFor("Alternate: Coated Iron Canister")).toHaveTextContent(
      "Empty Canister: 5.6 / 60 items/min (9.4%)",
    );
  });

  it("shows each rate in the unit the backend reports (ADR-0015)", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    const refinery = rowFor("Fuel");
    expect(refinery).toHaveTextContent("Fuel: 40 / 40 m³/min (100%)");
    expect(refinery).toHaveTextContent("Polymer Resin: 30 / 30 items/min (100%)");
  });

  it("shows just 'per min' for an item whose unit is unknown (null)", () => {
    render(<FactoryPanel snapshot={factoryUnknownItem} />);
    const row = rowFor("Modded Widget");
    expect(row).toHaveTextContent("Modded Widget: 10 / 10 per min");
    expect(row).not.toHaveTextContent(/m³|items\/min/);
  });

  it("shows just 'per min' when an older backend omits the unit field", () => {
    render(<FactoryPanel snapshot={factoryOldBackend} />);
    const row = rowFor("Iron Plate");
    expect(row).toHaveTextContent("Iron Plate: 20 / 20 per min (100%)");
    expect(row).not.toHaveTextContent(/m³|items\/min/);
  });

  it("says so for an empty factory", () => {
    render(<FactoryPanel snapshot={factoryEmpty} />);
    expect(screen.getByText("No machines yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("notes stale factory data with its own observedAt", () => {
    const stale = { ...factoryMixed, stale: true, observedAt: "2026-09-22T22:00:00.000Z" } satisfies FactoryResponse;
    render(<FactoryPanel snapshot={stale} />);
    expect(
      screen.getByText(`Showing last known factory data from ${new Date(stale.observedAt).toLocaleString()}.`),
    ).toBeInTheDocument();
  });
});
