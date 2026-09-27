import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isChunkLoadError, reloadOnce, reloadOnStaleChunk, RELOAD_GUARD_MS } from "./staleChunk";

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("isChunkLoadError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://example.test/assets/PowerChart-abc.js",
    "error loading dynamically imported module: https://example.test/assets/PowerChart-abc.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/MapCanvas-abc.css",
  ])("knows %s", (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it("leaves other errors alone", () => {
    expect(isChunkLoadError(new Error("boom"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("reloadOnce", () => {
  it("reloads, then not again within the guard, then again after it", () => {
    const reload = vi.fn();
    expect(reloadOnce(1_000_000, reload)).toBe(true);
    expect(reloadOnce(1_000_000 + RELOAD_GUARD_MS - 1, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnce(1_000_000 + RELOAD_GUARD_MS, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("reloads when the stored time is in the future (a clock set back)", () => {
    const reload = vi.fn();
    reloadOnce(2_000_000, reload);
    expect(reloadOnce(1_000_000, reload)).toBe(true);
  });

  it("ignores a stored value that isn't a time", () => {
    window.sessionStorage.setItem("satis-manager.stale-chunk-reload-at", "not a number");
    const reload = vi.fn();
    expect(reloadOnce(1_000_000, reload)).toBe(true);
  });

  it("never reloads when session storage throws, since it couldn't stop a loop", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const reload = vi.fn();
    expect(reloadOnce(1_000_000, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("never reloads when the time can't be saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const reload = vi.fn();
    expect(reloadOnce(1_000_000, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("never reloads offline, and keeps its one reload for when the browser is back online", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const reload = vi.fn();
    expect(reloadOnce(1_000_000, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    onLine.mockReturnValue(true);
    expect(reloadOnce(1_000_001, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not record a reload attempt in sessionStorage while offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    reloadOnce(1_000_000, vi.fn());
    expect(window.sessionStorage.getItem("satis-manager.stale-chunk-reload-at")).toBeNull();
  });

  it("still honors a guard set before going offline once back online", () => {
    const reload = vi.fn();
    expect(reloadOnce(1_000_000, reload)).toBe(true);

    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(reloadOnce(1_000_000 + RELOAD_GUARD_MS - 1, reload)).toBe(false);

    onLine.mockReturnValue(true);
    expect(reloadOnce(1_000_000 + RELOAD_GUARD_MS - 1, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("falls back to window.location.reload when no reload function is given", () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload: reloadSpy } });
    try {
      expect(reloadOnce(1_000_000)).toBe(true);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});

describe("reloadOnStaleChunk", () => {
  // Vite's handlePreloadError sets `payload` to the import's error before dispatching.
  const preloadError = (payload?: unknown) =>
    Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload });
  const missingChunk = () => new TypeError("Failed to fetch dynamically imported module: https://example.test/assets/x.js");

  it("reloads once on vite:preloadError without cancelling the event, and stops when removed", () => {
    const target = new EventTarget() as unknown as Window;
    const reload = vi.fn();
    const stop = reloadOnStaleChunk(target, reload);
    const event = preloadError(missingChunk());
    target.dispatchEvent(event);
    // Cancelling would make Vite resolve the import to undefined instead of reaching the boundary.
    expect(event.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    target.dispatchEvent(preloadError(missingChunk()));
    expect(reload).toHaveBeenCalledTimes(1);

    window.sessionStorage.clear();
    stop();
    target.dispatchEvent(preloadError(missingChunk()));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Found by the fresh-eyes pass: a bug in the lazy module's own code also fires the event, and a
  // reload wouldn't fix it; the section's Try again should show instead.
  it.each([
    ["a bug in the lazy module", new TypeError("Cannot read properties of undefined (reading 'render')")],
    ["no payload", undefined],
  ])("does not reload for %s", (_name, payload) => {
    const target = new EventTarget() as unknown as Window;
    const reload = vi.fn();
    reloadOnStaleChunk(target, reload);
    target.dispatchEvent(preloadError(payload));
    expect(reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("satis-manager.stale-chunk-reload-at")).toBeNull();
  });

  it("wires up on the real window and the real reload by default", () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload: reloadSpy } });
    const stop = reloadOnStaleChunk();
    try {
      window.dispatchEvent(preloadError(missingChunk()));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});
