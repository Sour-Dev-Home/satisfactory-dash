import { describe, expect, it } from "vitest";
import { machineState } from "./machineState";

describe("machineState", () => {
  it("maps every state the contract names (ADR-0027)", () => {
    for (const state of ["producing", "idle", "backedUp", "underfed", "paused", "unpowered"]) {
      expect(machineState(state)).not.toBeNull();
    }
  });

  it("treats a missing, unknown or retired state as no state", () => {
    // "starved" was renamed "underfed" (ADR-0027 amendment 2): never shown if an old value slips through.
    for (const state of [undefined, "", "starved", "overclocking-ish", "Producing"]) expect(machineState(state)).toBeNull();
  });

  it("doesn't read object prototype keys as states", () => {
    for (const state of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(machineState(state)).toBeNull();
  });
});
