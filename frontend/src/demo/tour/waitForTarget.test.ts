import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findReadyTarget, isTargetReady, TOUR_SETTLE_MS, TOUR_TARGET_WAIT_MS, waitForTarget } from "./waitForTarget";

/** jsdom lays nothing out: give an element a box. */
function sized(el: Element, width = 100, height = 50): Element {
  el.getBoundingClientRect = () => ({ x: 10, y: 20, width, height, top: 20, left: 10, right: 10 + width, bottom: 20 + height, toJSON: () => ({}) });
  return el;
}

function target(id: string): HTMLElement {
  const el = document.createElement("section");
  el.setAttribute("data-tour", id);
  return el;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("a step's target", () => {
  it("is ready once it has a box and sits in a revealed page (or no reveal wrapper)", () => {
    const el = target("a");
    document.body.append(el);
    expect(isTargetReady(el)).toBe(false); // no box yet
    sized(el);
    expect(isTargetReady(el)).toBe(true);

    const page = document.createElement("div");
    page.setAttribute("data-page-reveal", "waiting");
    const inside = sized(target("b"));
    page.append(inside);
    document.body.append(page);
    expect(isTargetReady(inside)).toBe(false);
    page.setAttribute("data-page-reveal", "revealed");
    expect(isTargetReady(inside)).toBe(true);
  });

  it("skips a copy that isn't ready for one that is", () => {
    const hidden = target("a");
    const shown = sized(target("a"));
    document.body.append(hidden, shown);
    expect(findReadyTarget("a")).toBe(shown);
  });
});

describe("waitForTarget", () => {
  it("finds a target that is already there at once", () => {
    const el = sized(target("a"));
    document.body.append(el);
    const onFound = vi.fn();
    const onTimeout = vi.fn();
    waitForTarget("a", { onFound, onTimeout });
    expect(onFound).toHaveBeenCalledWith(el);
    vi.advanceTimersByTime(TOUR_TARGET_WAIT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("finds a target that appears later, once its page is revealed", async () => {
    const onFound = vi.fn();
    const onTimeout = vi.fn();
    waitForTarget("late", { onFound, onTimeout });
    const page = document.createElement("div");
    page.setAttribute("data-page-reveal", "waiting");
    const el = sized(target("late"));
    page.append(el);
    document.body.append(page);
    await vi.advanceTimersByTimeAsync(100);
    expect(onFound).not.toHaveBeenCalled();
    page.setAttribute("data-page-reveal", "revealed");
    await vi.advanceTimersByTimeAsync(100);
    expect(onFound).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledWith(el);
    await vi.advanceTimersByTimeAsync(TOUR_TARGET_WAIT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("gives up after TOUR_TARGET_WAIT_MS when the target never appears", async () => {
    const onFound = vi.fn();
    const onTimeout = vi.fn();
    waitForTarget("never", { onFound, onTimeout });
    await vi.advanceTimersByTimeAsync(TOUR_TARGET_WAIT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onFound).not.toHaveBeenCalled();
    // Too late: nothing more is called.
    document.body.append(sized(target("never")));
    await vi.advanceTimersByTimeAsync(100);
    expect(onFound).not.toHaveBeenCalled();
  });

  describe("with a settling time (a step on a new page)", () => {
    it("waits until the box has kept still for TOUR_SETTLE_MS, then shows", async () => {
      const el = sized(target("s"));
      document.body.append(el);
      const onFound = vi.fn();
      waitForTarget("s", { onFound, onTimeout: vi.fn(), settleMs: TOUR_SETTLE_MS });
      expect(onFound).not.toHaveBeenCalled(); // ready, but not yet seen still
      await vi.advanceTimersByTimeAsync(TOUR_SETTLE_MS - 50);
      expect(onFound).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(onFound).toHaveBeenCalledWith(el);
    });

    it("keeps waiting while the box moves (a canvas laying out), and counts a sub-pixel wobble as still", async () => {
      const el = target("m");
      let x = 0;
      el.getBoundingClientRect = () => ({ x, y: 0, width: 100, height: 50, top: 0, left: x, right: x + 100, bottom: 50, toJSON: () => ({}) });
      document.body.append(el);
      const onFound = vi.fn();
      waitForTarget("m", { onFound, onTimeout: vi.fn(), settleMs: TOUR_SETTLE_MS });
      for (let i = 0; i < 40; i += 1) {
        x += 5;
        await vi.advanceTimersByTimeAsync(20);
      }
      expect(onFound).not.toHaveBeenCalled();
      // It stops, bar a half-pixel wobble: shown once still for the settling time.
      for (let i = 0; i < 6; i += 1) {
        x += i % 2 === 0 ? 0.5 : -0.5;
        await vi.advanceTimersByTimeAsync(20);
      }
      expect(onFound).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(TOUR_SETTLE_MS);
      expect(onFound).toHaveBeenCalledTimes(1);
    });

    it("still gives up after TOUR_TARGET_WAIT_MS when the box never keeps still", async () => {
      const el = target("never-still");
      let x = 0;
      el.getBoundingClientRect = () => {
        x += 3;
        return { x, y: 0, width: 100, height: 50, top: 0, left: x, right: x + 100, bottom: 50, toJSON: () => ({}) };
      };
      document.body.append(el);
      const onFound = vi.fn();
      const onTimeout = vi.fn();
      waitForTarget("never-still", { onFound, onTimeout, settleMs: TOUR_SETTLE_MS });
      await vi.advanceTimersByTimeAsync(TOUR_TARGET_WAIT_MS);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(onFound).not.toHaveBeenCalled();
    });
  });

  it("calls neither once cancelled", async () => {
    const onFound = vi.fn();
    const onTimeout = vi.fn();
    const cancel = waitForTarget("x", { onFound, onTimeout });
    cancel();
    document.body.append(sized(target("x")));
    await vi.advanceTimersByTimeAsync(TOUR_TARGET_WAIT_MS);
    expect(onFound).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
