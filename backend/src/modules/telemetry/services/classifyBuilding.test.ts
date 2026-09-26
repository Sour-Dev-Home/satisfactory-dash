import { describe, it, expect } from "vitest";
import { classifyBuilding, UNDERFED_BELOW_PERCENT } from "./classifyBuilding.js";
import type { ClassifiableBuilding } from "./classifyBuilding.js";

const rate = (className: string, percent: number) => ({
  name: className,
  className,
  currentPerMinute: percent,
  maxPerMinute: 100,
  percent,
});

/** A powered, configured machine running at 100 percent; each test overrides what it varies. */
function building(overrides: Partial<ClassifiableBuilding> = {}): ClassifiableBuilding {
  return {
    recipe: "Concrete",
    isPaused: false,
    production: [rate("Desc_Cement_C", 100)],
    consumption: [rate("Desc_Stone_C", 100)],
    circuitGroupId: 0,
    fuseTriggered: false,
    ...overrides,
  };
}

describe("classifyBuilding (ADR-0027 decision 2, per snapshot)", () => {
  it.each<[string, ClassifiableBuilding, boolean, string | undefined]>([
    ["paused", building({ isPaused: true }), false, "paused"],
    ["paused wins over unpowered", building({ isPaused: true, circuitGroupId: -1 }), false, "paused"],
    ["paused wins over backed up", building({ isPaused: true }), true, "paused"],
    ["unpowered: not connected (-1)", building({ circuitGroupId: -1 }), false, "unpowered"],
    ["unpowered: the circuit's fuse tripped", building({ fuseTriggered: true }), false, "unpowered"],
    ["unpowered wins over backed up", building({ circuitGroupId: -1 }), true, "unpowered"],
    ["unpowered wins over no recipe", building({ recipe: null, circuitGroupId: -1 }), false, "unpowered"],
    ["idle: no recipe", building({ recipe: null, production: [], consumption: [] }), false, "idle"],
    ["backed up", building({ production: [rate("Desc_Cement_C", 0)] }), true, "backedUp"],
    ["backed up wins over underfed", building({ production: [rate("Desc_Cement_C", 0)] }), true, "backedUp"],
    ["backed up with a low percent stays backed up (a full output is what lowers it)", building({ production: [rate("Desc_Cement_C", 40)] }), true, "backedUp"],
    ["underfed: nothing coming out", building({ production: [rate("Desc_Cement_C", 0)] }), false, "underfed"],
    ["underfed: slow because inputs are short (the 2026-09-22 machines at 24.7 and 9.4 percent)", building({ production: [rate("Desc_Cement_C", 24.7)] }), false, "underfed"],
    ["producing: full rate", building(), false, "producing"],
  ])("%s", (_name, input, backedUp, expected) => {
    expect(classifyBuilding(input, backedUp)?.state).toBe(expected);
  });

  describe("the underfed threshold (ADR-0027 amendment 2)", () => {
    const at = (percent: number) => classifyBuilding(building({ production: [rate("Desc_Cement_C", percent)] }), false)?.state;

    it("is the owner's 95 percent of the set clock", () => {
      expect(UNDERFED_BELOW_PERCENT).toBe(95);
    });

    it("splits exactly at UNDERFED_BELOW_PERCENT: below is underfed, at it is producing", () => {
      expect(at(94.9)).toBe("underfed");
      expect(at(95)).toBe("producing");
      expect(at(UNDERFED_BELOW_PERCENT - 0.001)).toBe("underfed");
      expect(at(UNDERFED_BELOW_PERCENT)).toBe("producing");
      expect(at(UNDERFED_BELOW_PERCENT + 0.001)).toBe("producing");
    });

    it("is stable at the boundary: the same reading always gives the same state (no hidden state)", () => {
      for (let i = 0; i < 5; i++) {
        expect(at(UNDERFED_BELOW_PERCENT)).toBe("producing");
      }
    });

    it("judges a fully fed machine at any clock speed as producing: the percent is relative to the SET clock", () => {
      // A 50 percent clock: MaxProd already includes the clock (frm-api.md), so 2.5 of 2.5 per minute reads 100.
      const underclocked = building({ production: [{ name: "C", className: "Desc_Cement_C", currentPerMinute: 2.5, maxPerMinute: 2.5, percent: 100 }] });
      expect(classifyBuilding(underclocked, false)?.state).toBe("producing");
      // A 160 percent clock, fully fed: 8 of 8 per minute reads 100.
      const overclocked = building({ production: [{ name: "C", className: "Desc_Cement_C", currentPerMinute: 8, maxPerMinute: 8, percent: 100 }] });
      expect(classifyBuilding(overclocked, false)?.state).toBe("producing");
    });

    it("judges a multi-output machine by its best output: any output at the set rate means not underfed", () => {
      const refinery = building({ production: [rate("Desc_A", 0), rate("Desc_B", 96)] });
      expect(classifyBuilding(refinery, false)?.state).toBe("producing");
      const slow = building({ production: [rate("Desc_A", 0), rate("Desc_B", 80)] });
      expect(classifyBuilding(slow, false)?.state).toBe("underfed"); // the best output is still below 95
      const stalled = building({ production: [rate("Desc_A", 0), rate("Desc_B", 1)] });
      expect(classifyBuilding(stalled, false)?.state).toBe("underfed");
    });

    it("does not use isProducing at all: the inputs have no such field", () => {
      expect("isProducing" in building()).toBe(false);
    });
  });

  describe("missingInput", () => {
    it("names the ingredient with the lowest consumption percent when underfed", () => {
      const underfed = building({
        production: [rate("Desc_Out_C", 0)],
        consumption: [rate("Desc_Iron_C", 40), rate("Desc_Screw_C", 0), rate("Desc_Wire_C", 12)],
      });
      expect(classifyBuilding(underfed, false)).toEqual({ state: "underfed", missingInput: "Desc_Screw_C" });
    });

    it("is absent when there is no usable ingredient data, and never set for other states", () => {
      expect(classifyBuilding(building({ production: [rate("Desc_Out_C", 0)], consumption: [] }), false)).toEqual({
        state: "underfed",
      });
      expect(classifyBuilding(building({ production: [rate("Desc_Out_C", 0)], consumption: [rate("X", NaN)] }), false)).toEqual({
        state: "underfed",
      });
      expect(classifyBuilding(building(), false)).toEqual({ state: "producing" });
    });
  });

  describe("missing data gives no state, never a guess", () => {
    it("has no output percent to judge by (no production entries, or only NaN)", () => {
      expect(classifyBuilding(building({ production: [] }), false)).toBeUndefined();
      expect(classifyBuilding(building({ production: [rate("X", NaN)] }), false)).toBeUndefined();
      expect(classifyBuilding(building({ production: [rate("X", Infinity)] }), false)).toBeUndefined();
    });

    it("does not know the fuse state of a connected machine that would otherwise be running or backed up", () => {
      expect(classifyBuilding(building({ fuseTriggered: undefined }), false)).toBeUndefined();
      expect(classifyBuilding(building({ fuseTriggered: undefined }), true)).toBeUndefined();
    });

    it("still answers what needs no fuse information: paused, not connected, no recipe", () => {
      expect(classifyBuilding(building({ fuseTriggered: undefined, isPaused: true }), false)?.state).toBe("paused");
      expect(classifyBuilding(building({ fuseTriggered: undefined, circuitGroupId: -1 }), false)?.state).toBe("unpowered");
      expect(classifyBuilding(building({ fuseTriggered: undefined, recipe: null }), false)?.state).toBe("idle");
    });
  });
});
