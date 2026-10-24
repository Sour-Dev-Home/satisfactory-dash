import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { renderWithClient } from "../test/render";

afterEach(() => {
  vi.restoreAllMocks();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const size = (el: HTMLElement, props: Record<string, number>) => {
  for (const [key, value] of Object.entries(props)) Object.defineProperty(el, key, { configurable: true, writable: true, value });
};

describe("the main nav's scroll cue", () => {
  it("fades the end, then both ends, then the start as the tabs scroll, on phones only", async () => {
    window.history.pushState(null, "", "/app");
    renderWithClient(<App />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    // Fits (jsdom measures 0): no fade, and no inline style anywhere.
    expect(nav.className).not.toContain("nav-fade");
    expect(nav.getAttribute("style")).toBeNull();
    size(nav, { clientWidth: 390, scrollWidth: 520, scrollLeft: 0 });
    fireEvent.scroll(nav);
    expect(nav).toHaveClass("max-sm:nav-fade-end");
    nav.scrollLeft = 60;
    fireEvent.scroll(nav);
    expect(nav).toHaveClass("max-sm:nav-fade-both");
    nav.scrollLeft = 130;
    fireEvent.scroll(nav);
    expect(nav).toHaveClass("max-sm:nav-fade-start");
    expect(nav).not.toHaveClass("max-sm:nav-fade-both");
  });

  it("scrolls the active tab into view when the page changes", async () => {
    window.history.pushState(null, "", "/app");
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    renderWithClient(<App />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    scroll.mockClear();
    fireEvent.click(nav.querySelector<HTMLElement>('a[href="/app/power"]')!);
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ inline: "nearest", block: "nearest" })));
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });
});
