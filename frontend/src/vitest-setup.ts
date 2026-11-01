import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { clearFoldMemory } from "./planner/graph/foldMemory";
import { server } from "./test/server";

// jsdom has no canvas, so uPlot can't draw here. Tests see a stub that records what the
// chart was given (`uplotInstances`); the real chart runs in the e2e suite.
vi.mock("uplot", () => {
  class FakePlot {
    static instances: FakePlot[] = [];
    data: unknown;
    destroyed = false;
    constructor(_opts: unknown, data: unknown) {
      this.data = data;
      FakePlot.instances.push(this);
    }
    setData(data: unknown) {
      this.data = data;
    }
    setSize() {}
    redraw() {}
    destroy() {
      this.destroyed = true;
    }
  }
  return { default: FakePlot };
});
vi.mock("uplot/dist/uPlot.min.css", () => ({}));
// jsdom has no ResizeObserver either (the chart follows its container's width).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// A request with no handler fails the test instead of silently hitting the network.
// (MSW 3 renamed onUnhandledRequest to onUnhandledFrame; unhandledRequest.test.ts pins it.)
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// The app routes by URL (ADR-0016 item 4), and jsdom keeps one URL per test file, so start
// every test at /app like a fresh load of the app (/ is the landing page). A test that needs
// another page navigates first.
beforeEach(() => window.history.replaceState(null, "", "/app"));

// Remembered UI choices (the map's filters) live in localStorage, which jsdom keeps for the whole file:
// every test starts like a first visit. The planner's fold memory (sessionStorage and a module copy) too.
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearFoldMemory();
});
