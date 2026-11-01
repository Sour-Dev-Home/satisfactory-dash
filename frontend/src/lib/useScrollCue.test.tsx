import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollCue, useScrollCue } from "./useScrollCue";

const size = (el: HTMLElement, props: Record<string, number>) => {
  for (const [key, value] of Object.entries(props)) Object.defineProperty(el, key, { configurable: true, writable: true, value });
};

function Box() {
  const { attach, onScroll, overflows, more } = useScrollCue<HTMLDivElement>();
  return (
    <div ref={attach} onScroll={onScroll} data-testid="box" data-overflows={overflows} data-more={more}>
      <p>rows</p>
    </div>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("scrollCue", () => {
  it("is off when the content fits", () => {
    expect(scrollCue(0, 320, 320)).toEqual({ overflows: false, more: false });
    // Sub-pixel rounding is not overflow.
    expect(scrollCue(0, 320, 320.8)).toEqual({ overflows: false, more: false });
  });

  it("says there is more below until the end is reached", () => {
    expect(scrollCue(0, 320, 900)).toEqual({ overflows: true, more: true });
    expect(scrollCue(300, 320, 900)).toEqual({ overflows: true, more: true });
    expect(scrollCue(580, 320, 900)).toEqual({ overflows: true, more: false });
    expect(scrollCue(579.5, 320, 900)).toEqual({ overflows: true, more: false });
  });
});

describe("useScrollCue", () => {
  it("measures on scroll: nothing when it fits, more below, then the end", () => {
    render(<Box />);
    const box = screen.getByTestId("box");
    // jsdom measures 0: fits.
    expect(box.dataset.overflows).toBe("false");
    size(box, { clientHeight: 320, scrollHeight: 900, scrollTop: 0 });
    fireEvent.scroll(box);
    expect(box.dataset.overflows).toBe("true");
    expect(box.dataset.more).toBe("true");
    box.scrollTop = 580;
    fireEvent.scroll(box);
    expect(box.dataset.overflows).toBe("true");
    expect(box.dataset.more).toBe("false");
  });

  it("re-measures when the region or its content resizes, and disconnects on unmount", () => {
    const callbacks: (() => void)[] = [];
    const observed: Element[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect = disconnect;
      },
    );
    const { unmount } = render(<Box />);
    const box = screen.getByTestId("box");
    expect(observed).toEqual([box, box.firstElementChild]);
    expect(box.dataset.more).toBe("false");
    size(box, { clientHeight: 320, scrollHeight: 900, scrollTop: 0 });
    act(() => callbacks.forEach((c) => c()));
    expect(box.dataset.more).toBe("true");
    // Rows filtered away: fits again.
    size(box, { scrollHeight: 300 });
    act(() => callbacks.forEach((c) => c()));
    expect(box.dataset.overflows).toBe("false");
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
