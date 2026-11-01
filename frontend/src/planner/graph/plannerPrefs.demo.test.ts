import { afterEach, describe, expect, it, vi } from "vitest";
import { NESTING_KEY, readNesting } from "./plannerPrefs";

// ADR-0061 build PR 6: the demo build turns nesting on by default so the owner reviews it there. `IS_DEMO` is the
// build-time constant, set here as the demo build sets it; plannerPrefs.test.tsx covers the production default (off).
vi.mock("../../demo/mode", () => ({ IS_DEMO: true }));

afterEach(() => window.localStorage.removeItem(NESTING_KEY));

describe("the nesting flag in the demo build", () => {
  it("is on with nothing stored, and with anything but off", () => {
    expect(readNesting()).toBe(true);
    window.localStorage.setItem(NESTING_KEY, "on");
    expect(readNesting()).toBe(true);
    window.localStorage.setItem(NESTING_KEY, "garbage");
    expect(readNesting()).toBe(true);
  });

  it("is off when the viewer stores off, to compare", () => {
    window.localStorage.setItem(NESTING_KEY, "off");
    expect(readNesting()).toBe(false);
  });

  it("stays on when storage throws (private mode, blocked site data)", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readNesting()).toBe(true);
    spy.mockRestore();
  });
});
