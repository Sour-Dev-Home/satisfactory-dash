import { render, screen, within } from "@testing-library/react";
import type { FactoryBuilding, FactoryResponse } from "@satisfactory-dash/shared";
import { factoryOldBackend, factoryStatesAndIngredients } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it } from "vitest";
import { FactoryPanel } from "./FactoryPanel";

// Ingredients and machine state (ADR-0027, #184): what each machine consumes, and the
// backend's state as a label whose colour only repeats the text.

function rowFor(recipe: string): HTMLElement {
  const cell = within(screen.getByRole("table")).getByRole("cell", { name: recipe });
  return cell.closest("tr") as HTMLElement;
}

/** The lines of a row's Inputs or Outputs list (exact textContent), or null without one. */
function lines(row: HTMLElement, label: "Inputs" | "Outputs"): string[] | null {
  const list = within(row).queryByRole("list", { name: label });
  return list ? within(list).getAllByRole("listitem").map((li) => li.textContent ?? "") : null;
}

/** The last cell (State): its text, which is the whole meaning. */
function stateText(row: HTMLElement): string {
  const cells = row.querySelectorAll("td");
  return cells[cells.length - 1].textContent ?? "";
}

function withBuildings(...buildings: FactoryBuilding[]): FactoryResponse {
  return { ...factoryStatesAndIngredients, data: { buildings, backedUpCount: buildings.filter((b) => b.isBackedUp).length } };
}

const machine = factoryStatesAndIngredients.data.buildings[0];

describe("FactoryPanel ingredients", () => {
  it("lists each input the way outputs are listed, solid and fluid units alike", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    const packager = rowFor("Packaged Fuel");
    expect(lines(packager, "Inputs")).toEqual(["Fuel: 24 / 60 m³/min (40%)", "Empty Canister: 24 / 60 items/min (40%)"]);
    expect(lines(packager, "Outputs")).toEqual(["Packaged Fuel: 24 / 60 items/min (40%)"]);
  });

  it("shows a dash for a machine with no recipe (an empty ingredients array)", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    const assembler = rowFor("No recipe");
    expect(lines(assembler, "Inputs")).toBeNull();
    expect(within(assembler).getAllByText("—")).toHaveLength(2);
  });

  it("leaves the cell empty for one machine from an older backend (no ingredients field)", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    const concrete = rowFor("Concrete");
    expect(lines(concrete, "Inputs")).toBeNull();
    expect(within(concrete).queryByText("—")).not.toBeInTheDocument();
    expect(lines(concrete, "Outputs")).toEqual(["Concrete: 15 / 15 items/min (100%)"]);
  });

  it("has no Inputs column at all when the backend sends no ingredients", () => {
    render(<FactoryPanel snapshot={factoryOldBackend} />);
    expect(screen.queryByRole("columnheader", { name: "Inputs" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Outputs" })).toBeInTheDocument();
  });

  it("uses the per-min fallback for an input without a unit", () => {
    const input = { ...machine.production[0], name: "Iron Ingot", currentPerMinute: 30, maxPerMinute: 30, unit: null };
    render(<FactoryPanel snapshot={withBuildings({ ...machine, ingredients: [input] })} />);
    expect(lines(rowFor("Iron Plate"), "Inputs")).toEqual(["Iron Ingot: 30 / 30 per min (100%)"]);
  });
});

describe("FactoryPanel machine state", () => {
  it.each([
    ["Iron Plate", "Producing", "text-ok"],
    ["Packaged Fuel", "Underfed", "text-warn"],
    ["No recipe", "Idle", "text-muted"],
    ["Screw", "Backed up", "text-warn"],
    ["Copper Ingot", "Paused", "text-info"],
    ["Wire", "Unpowered", "text-bad"],
  ])("labels the %s machine %s, in %s", (recipe, label, tone) => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    const row = rowFor(recipe);
    expect(stateText(row)).toBe(label);
    expect(within(row).getByText(label)).toHaveClass(tone);
  });

  it("shows no state for an unknown value or a missing one, never a guess", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    expect(stateText(rowFor("Computer"))).toBe("");
    expect(stateText(rowFor("Rotor"))).toBe("");
    expect(screen.queryByText(/overclocking/)).not.toBeInTheDocument();
  });

  it("says Backed up once when the state and the flag agree", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    expect(within(rowFor("Screw")).getAllByText("Backed up")).toHaveLength(1);
  });

  it("keeps the flags from an older backend without state, in the same colours", () => {
    const old = { ...machine, state: undefined, isBackedUp: true, isPaused: true };
    render(<FactoryPanel snapshot={withBuildings(old)} />);
    const row = rowFor("Iron Plate");
    expect(stateText(row)).toBe("Backed up Paused");
    expect(within(row).getByText("Backed up")).toHaveClass("text-warn");
    expect(within(row).getByText("Paused")).toHaveClass("text-info");
  });

  it("adds a flag the state doesn't say", () => {
    render(<FactoryPanel snapshot={withBuildings({ ...machine, state: "unpowered", isBackedUp: true })} />);
    expect(stateText(rowFor("Iron Plate"))).toBe("Unpowered Backed up");
  });
});

describe("FactoryPanel clock speed", () => {
  // One machine each, so the only body row (the clock changes the recipe cell's name).
  const onlyRow = () => within(screen.getByRole("table")).getAllByRole("row")[1];
  const recipeCell = () => within(onlyRow()).getAllByRole("cell")[0];

  it.each([
    [160, "Iron PlateClock 160%"],
    [50, "Iron PlateClock 50%"],
    [62.5, "Iron PlateClock 62.5%"],
  ])("labels a %s%% clock beside the recipe", (clockSpeedPercent, text) => {
    render(<FactoryPanel snapshot={withBuildings({ ...machine, clockSpeedPercent })} />);
    expect(recipeCell().textContent).toBe(text);
  });

  it.each([100, 100.02, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "shows nothing for a clock of %s (the default, absent, or not a clock)",
    (clockSpeedPercent) => {
      render(<FactoryPanel snapshot={withBuildings({ ...machine, clockSpeedPercent })} />);
      expect(recipeCell().textContent).toBe("Iron Plate");
    },
  );

  it("keeps the clock out of the outputs and the state", () => {
    render(<FactoryPanel snapshot={withBuildings({ ...machine, clockSpeedPercent: 160 })} />);
    const row = onlyRow();
    expect(lines(row, "Outputs")).toEqual(["Iron Plate: 20 / 20 items/min (100%)"]);
    expect(stateText(row)).toBe("Producing");
  });
});

describe("FactoryPanel summary", () => {
  it("says 1 machine in the singular", () => {
    render(<FactoryPanel snapshot={withBuildings(machine)} />);
    expect(screen.getByText("1 machine · 0 backed up · 0 paused · 0 without a recipe")).toBeInTheDocument();
  });
});
