import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findReadyTarget, isTargetReady, TOUR_TARGET_WAIT_MS, waitForTarget } from "./waitForTarget";

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
