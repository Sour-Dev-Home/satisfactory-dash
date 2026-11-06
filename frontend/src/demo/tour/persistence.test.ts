import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasSeenTour, markTourSeen, resetTourLoadForTests, shouldAutoStart, TOUR_STORAGE_KEY } from "./persistence";

beforeEach(() => resetTourLoadForTests());
afterEach(() => vi.restoreAllMocks());

describe("remembering the tour", () => {
  it("starts by itself only at exactly /app, on a first visit", () => {
    expect(shouldAutoStart("/app")).toBe(true);
    expect(shouldAutoStart("/app/power")).toBe(false);
    expect(shouldAutoStart("/app/")).toBe(false);
    expect(shouldAutoStart("/")).toBe(false);
  });

  it("stores demo.tour = seen when it starts, and then never starts by itself again", () => {
    markTourSeen();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe("seen");
    resetTourLoadForTests(); // a reload: only storage remembers
    expect(hasSeenTour()).toBe(true);
    expect(shouldAutoStart("/app")).toBe(false);
  });

  it("ignores any other stored value", () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "nope");
    expect(hasSeenTour()).toBe(false);
  });

  it("with storage throwing, still starts only once per page load", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(shouldAutoStart("/app")).toBe(true);
    expect(() => markTourSeen()).not.toThrow();
    expect(shouldAutoStart("/app")).toBe(false);
    // The next visit may show it again (accepted, ADR-0065 Decision 7).
    resetTourLoadForTests();
    expect(shouldAutoStart("/app")).toBe(true);
  });
});
