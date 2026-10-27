import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SCROLL_MORE, ScrollRegion } from "./ScrollRegion";

const size = (el: HTMLElement, props: Record<string, number>) => {
  for (const [key, value] of Object.entries(props)) Object.defineProperty(el, key, { configurable: true, writable: true, value });
};

function mount() {
  render(
    <>
      <h4 id="rows-heading">Rows in view</h4>
      <ScrollRegion labelledBy="rows-heading">
        <table aria-labelledby="rows-heading">
          <tbody>
            <tr>
              <td>a</td>
            </tr>
          </tbody>
        </table>
      </ScrollRegion>
    </>,
  );
  return screen.getByRole("region", { name: "Rows in view" });
}

describe("ScrollRegion", () => {
  it("is a focusable, labelled scroll region with no cue when the rows fit", () => {
    const region = mount();
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("max-h-80", "overflow-auto");
    expect(region).not.toHaveClass("scroll-fade-bottom");
    expect(screen.queryByText(SCROLL_MORE)).toBeNull();
  });

  it("fades the bottom edge and says 'Scroll for more' while rows are cut, and drops both at the end", () => {
    const region = mount();
    size(region, { clientHeight: 320, scrollHeight: 900, scrollTop: 0 });
    fireEvent.scroll(region);
    expect(region).toHaveClass("scroll-fade-bottom");
    const cue = screen.getByText(SCROLL_MORE);
    expect(cue).toBeVisible();
    expect(cue).not.toHaveClass("invisible");
    region.scrollTop = 580;
    fireEvent.scroll(region);
    expect(region).not.toHaveClass("scroll-fade-bottom");
    // Its line keeps its place (no jump at the end of the scroll), just hidden.
    expect(screen.getByText(SCROLL_MORE)).toHaveClass("invisible");
  });
});
