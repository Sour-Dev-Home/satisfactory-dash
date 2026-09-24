import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
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
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// The app routes by URL (ADR-0016 item 4), and jsdom keeps one URL per test file, so start
// every test at / like a fresh page load. A test that needs a page navigates first.
afterEach(() => window.history.replaceState(null, "", "/"));
