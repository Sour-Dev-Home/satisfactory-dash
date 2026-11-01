import { fireEvent, render, screen, within } from "@testing-library/react";
import { factoryStatesAndIngredients } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it, vi } from "vitest";
import { FactoryPanel } from "./FactoryPanel";

// ADR-0062 F.3: the rows show state with the Planner's StateMark, and the summary's counts are filter toggles.

function rowFor(recipe: string): HTMLElement {
  const cell = within(screen.getByRole("table")).getByRole("cell", { name: recipe });
  return cell.closest("tr") as HTMLElement;
}

const marksIn = (el: HTMLElement) => [...el.querySelectorAll("[data-state-mark]")].map((g) => g.getAttribute("data-state-mark"));

const group = () => screen.getByRole("group", { name: "Filter machines" });
const filterButton = (label: string) => within(group()).getByRole("button", { name: new RegExp(`^${label} \\d+$`) });
const rowNames = () => within(screen.getByRole("table")).getAllByRole("rowheader").map((th) => th.textContent);

describe("FactoryPanel state marks (ADR-0062 F.3)", () => {
  it("puts the Planner's mark before each stalled state's word, in that state's tone", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    expect(marksIn(rowFor("Screw"))).toEqual(["backedUp"]);
    expect(marksIn(rowFor("Packaged Fuel"))).toEqual(["underfed"]);
    expect(marksIn(rowFor("Copper Ingot"))).toEqual(["paused"]);
    expect(marksIn(rowFor("No recipe"))).toEqual(["idle"]);
    expect(rowFor("Screw").querySelector("[data-state-mark]")).toHaveClass("text-warn");
    expect(rowFor("Copper Ingot").querySelector("[data-state-mark]")).toHaveClass("text-info");
  });

  it("draws no mark for producing, unpowered, an unknown state or no state: those keep the word alone", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    expect(marksIn(rowFor("Iron Plate"))).toEqual([]);
    expect(marksIn(rowFor("Wire"))).toEqual([]);
    expect(marksIn(rowFor("Computer"))).toEqual([]);
  });

  it("keeps the mark out of the accessible text: the word still says it", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    const svg = rowFor("Screw").querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    const cells = rowFor("Screw").querySelectorAll("td");
    expect(cells[cells.length - 1].textContent).toBe("Backed up");
  });
});

describe("FactoryPanel state filter toggles (ADR-0062 F.3)", () => {
  const all = factoryStatesAndIngredients.data.buildings;
  const count = (test: (b: (typeof all)[number]) => boolean) => all.filter(test).length;

  it("shows each filter's count in its name, from the whole snapshot", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    expect(filterButton("All")).toHaveAccessibleName(`All ${all.length}`);
    expect(filterButton("Backed up")).toHaveAccessibleName(`Backed up ${count((b) => b.state === "backedUp")}`);
    expect(filterButton("Paused")).toHaveAccessibleName(`Paused ${count((b) => b.isPaused)}`);
    expect(filterButton("No recipe")).toHaveAccessibleName(`No recipe ${count((b) => b.recipe === null)}`);
  });

  it("starts on All, and turns several states on together, showing a machine matching any of them", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    expect(filterButton("All")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(filterButton("Backed up"));
    fireEvent.click(filterButton("Paused"));
    expect(filterButton("All")).toHaveAttribute("aria-pressed", "false");
    expect(filterButton("Backed up")).toHaveAttribute("aria-pressed", "true");
    expect(filterButton("Paused")).toHaveAttribute("aria-pressed", "true");
    expect(rowNames()).toEqual(all.filter((b) => b.state === "backedUp" || b.isPaused).map((b) => b.name));
  });

  it("turns a state off again, and All turns every state off", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    fireEvent.click(filterButton("Backed up"));
    fireEvent.click(filterButton("No recipe"));
    fireEvent.click(filterButton("Backed up"));
    expect(filterButton("Backed up")).toHaveAttribute("aria-pressed", "false");
    expect(rowNames()).toHaveLength(count((b) => b.recipe === null));
    fireEvent.click(filterButton("All"));
    expect(filterButton("No recipe")).toHaveAttribute("aria-pressed", "false");
    expect(rowNames()).toHaveLength(all.length);
  });

  it("puts the state's mark on its toggle, in the button's own colour while pressed", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    expect(marksIn(filterButton("Backed up"))).toEqual(["backedUp"]);
    expect(marksIn(filterButton("Paused"))).toEqual(["paused"]);
    expect(marksIn(filterButton("No recipe"))).toEqual([]);
    expect(marksIn(filterButton("All"))).toEqual([]);
    expect(filterButton("Backed up").querySelector("[data-state-mark]")).toHaveClass("text-warn");
    fireEvent.click(filterButton("Backed up"));
    expect(filterButton("Backed up").querySelector("[data-state-mark]")).not.toHaveClass("text-warn");
  });

  it("narrows by the search as well as the states: the states OR together, the search ANDs with them", () => {
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} />);
    fireEvent.click(filterButton("Backed up"));
    fireEvent.click(filterButton("Paused"));
    const both = rowNames();
    const needle = both[0] as string;
    fireEvent.change(screen.getByLabelText("Search machines"), { target: { value: needle } });
    const narrowed = rowNames();
    expect(narrowed).toContain(needle);
    expect(narrowed.every((n) => both.includes(n))).toBe(true);
    fireEvent.change(screen.getByLabelText("Search machines"), { target: { value: "zzz no such machine" } });
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("is controlled when given states: shows them and asks for the next set, in the filters' order", () => {
    const onStates = vi.fn();
    render(<FactoryPanel snapshot={factoryStatesAndIngredients} states={["noRecipe"]} onStates={onStates} />);
    expect(filterButton("No recipe")).toHaveAttribute("aria-pressed", "true");
    expect(rowNames()).toHaveLength(count((b) => b.recipe === null));
    fireEvent.click(filterButton("Backed up"));
    expect(onStates).toHaveBeenLastCalledWith(["backedUp", "noRecipe"]);
    fireEvent.click(filterButton("All"));
    expect(onStates).toHaveBeenLastCalledWith([]);
  });
});
