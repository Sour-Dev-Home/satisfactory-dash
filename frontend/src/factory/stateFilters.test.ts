import type { FactoryBuilding } from "@satisfactory-dash/shared";
import { factoryMixed } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it } from "vitest";
import { FACTORY_STATE_FILTERS } from "../lib/deepLinks";
import { matchesStates, STATE_FILTERS, toggleState } from "./stateFilters";

const base = factoryMixed.data.buildings[0];
const machine = (over: Partial<FactoryBuilding>): FactoryBuilding => ({ ...base, isBackedUp: false, isPaused: false, state: "producing", ...over });

describe("the Factory page's state filters (ADR-0062 F.3)", () => {
  it("has a view for every filter the URL can name, in the same order", () => {
    expect([...STATE_FILTERS.keys()]).toEqual([...FACTORY_STATE_FILTERS]);
  });

  it("passes every machine when no filter is on", () => {
    expect(matchesStates(machine({}), [])).toBe(true);
  });

  it("passes a machine matching any filter that is on, so each toggle widens the list", () => {
    const paused = machine({ isPaused: true, state: "paused" });
    const noRecipe = machine({ recipe: null });
    expect(matchesStates(paused, ["backedUp"])).toBe(false);
    expect(matchesStates(paused, ["backedUp", "paused"])).toBe(true);
    expect(matchesStates(noRecipe, ["paused", "noRecipe"])).toBe(true);
    expect(matchesStates(machine({}), ["backedUp", "paused", "noRecipe"])).toBe(false);
  });

  it("counts a machine as backed up by its state, as the summary's count does (isBackedUpState, issue 201)", () => {
    expect(matchesStates(machine({ state: "backedUp" }), ["backedUp"])).toBe(true);
    expect(matchesStates(machine({ isBackedUp: true }), ["backedUp"])).toBe(false);
  });

  it("toggles one filter on and off, keeping the others and the filters' order", () => {
    expect(toggleState([], "noRecipe")).toEqual(["noRecipe"]);
    expect(toggleState(["noRecipe"], "backedUp")).toEqual(["backedUp", "noRecipe"]);
    expect(toggleState(["backedUp", "noRecipe"], "backedUp")).toEqual(["noRecipe"]);
    expect(toggleState(["paused"], "paused")).toEqual([]);
  });
});
