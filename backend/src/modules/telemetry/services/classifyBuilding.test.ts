import { describe, it, expect } from "vitest";
import { classifyBuilding, STARVED_BELOW_PERCENT } from "./classifyBuilding.js";
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
    ["backed up wins over starved", building({ production: [rate("Desc_Cement_C", 0)] }), true, "backedUp"],
    ["starved: nothing coming out", building({ production: [rate("Desc_Cement_C", 0)] }), false, "starved"],
    ["producing: full rate", building(), false, "producing"],
    ["producing: slow but working (above the threshold)", building({ production: [rate("Desc_Cement_C", 9.4)] }), false, "producing"],
  ])("%s", (_name, input, backedUp, expected) => {
    expect(classifyBuilding(input, backedUp)?.state).toBe(expected);
  });

  describe("the starved threshold", () => {
    const at = (percent: number) => classifyBuilding(building({ production: [rate("Desc_Cement_C", percent)] }), false)?.state;

    it("splits exactly at STARVED_BELOW_PERCENT: below is starved, at it is producing", () => {
      expect(at(STARVED_BELOW_PERCENT - 0.001)).toBe("starved");
      expect(at(STARVED_BELOW_PERCENT)).toBe("producing");
      expect(at(STARVED_BELOW_PERCENT + 0.001)).toBe("producing");
    });

    it("is stable at the boundary: the same reading always gives the same state (no hidden state)", () => {
      for (let i = 0; i < 5; i++) {
        expect(at(STARVED_BELOW_PERCENT)).toBe("producing");
      }
    });

    it("judges a multi-output machine by its best output: any output moving means not starved", () => {
      const refinery = building({ production: [rate("Desc_A", 0), rate("Desc_B", 80)] });
      expect(classifyBuilding(refinery, false)?.state).toBe("producing");
      const stalled = building({ production: [rate("Desc_A", 0), rate("Desc_B", 1)] });
      expect(classifyBuilding(stalled, false)?.state).toBe("starved");
    });

    it("does not use isProducing at all: the inputs have no such field", () => {
      expect("isProducing" in building()).toBe(false);
    });
  });

  describe("missingInput", () => {
    it("names the ingredient with the lowest consumption percent when starved", () => {
      const starved = building({
        production: [rate("Desc_Out_C", 0)],
        consumption: [rate("Desc_Iron_C", 40), rate("Desc_Screw_C", 0), rate("Desc_Wire_C", 12)],
      });
      expect(classifyBuilding(starved, false)).toEqual({ state: "starved", missingInput: "Desc_Screw_C" });
    });

    it("is absent when there is no usable ingredient data, and never set for other states", () => {
      expect(classifyBuilding(building({ production: [rate("Desc_Out_C", 0)], consumption: [] }), false)).toEqual({
        state: "starved",
      });
      expect(classifyBuilding(building({ production: [rate("Desc_Out_C", 0)], consumption: [rate("X", NaN)] }), false)).toEqual({
        state: "starved",
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
