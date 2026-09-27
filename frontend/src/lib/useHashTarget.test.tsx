import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHashTarget } from "./useHashTarget";

const isTarget = (id: string) => id.startsWith("target");

function Page({ show = true, tick = 0 }: { show?: boolean; tick?: number }) {
  useHashTarget(isTarget);
  return (
    <div data-tick={tick}>
      {show && <h2 id="target-1">Target</h2>}
      <h2 id="other">Other</h2>
    </div>
  );
}

/** A navigation as the router makes one: a new history entry, with its own key and (react-router's
 *  actual shape) an incrementing `idx`. */
let entryIdx = 0;
const navigate = (hash: string, key: string) => window.history.pushState({ key, idx: ++entryIdx }, "", `/app${hash}`);

/** A same-entry URL update, as react-router's `replace()` makes one: a fresh key, but the same
 *  `idx` as the last navigation (it only bumps `idx` on a push). */
const replaceInPlace = (hash: string, key: string) => window.history.replaceState({ key, idx: entryIdx }, "", `/app${hash}`);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("useHashTarget", () => {
  it("scrolls to and focuses the element the fragment names, giving a heading tabIndex -1", () => {
    navigate("#target-1", "a");
    render(<Page />);
    const target = screen.getByText("Target");
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute("tabindex", "-1");
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("waits for the element, when its data lands later", () => {
    navigate("#target-1", "b");
    const { rerender } = render(<Page show={false} />);
    expect(document.body).toHaveFocus();
    rerender(<Page show />);
    expect(screen.getByText("Target")).toHaveFocus();
  });

  it("jumps once per navigation: a later re-render (a poll) doesn't take focus back", () => {
    navigate("#target-1", "c");
    const { rerender } = render(<Page tick={0} />);
    screen.getByText("Other").setAttribute("tabindex", "-1");
    screen.getByText("Other").focus();
    rerender(<Page tick={1} />);
    expect(screen.getByText("Other")).toHaveFocus();
  });

  it("jumps again on a new navigation to the same fragment", () => {
    navigate("#target-1", "d");
    const { rerender } = render(<Page tick={0} />);
    screen.getByText("Other").setAttribute("tabindex", "-1");
    screen.getByText("Other").focus();
    navigate("#target-1", "e");
    rerender(<Page tick={1} />);
    expect(screen.getByText("Target")).toHaveFocus();
  });

  // A component that keeps a value in the URL (?q=, FactoryView) replaces on every keystroke; that
  // must not steal focus back from the field the user is typing in.
  it("a same-entry URL update (same idx, new key) doesn't refocus, e.g. typing in a search box while #history is open", () => {
    navigate("#target-1", "g");
    const { rerender } = render(<Page tick={0} />);
    expect(screen.getByText("Target")).toHaveFocus();
    screen.getByText("Other").setAttribute("tabindex", "-1");
    screen.getByText("Other").focus();
    replaceInPlace("#target-1", "h");
    rerender(<Page tick={1} />);
    expect(screen.getByText("Other")).toHaveFocus();
  });

  it("focuses a whole section's heading rather than the section, so the ring outlines the heading", () => {
    function Sections() {
      useHashTarget((id) => id === "target-section");
      return (
        <section id="target-section" aria-labelledby="section-heading">
          <h3 id="section-heading">Section heading</h3>
          <p>Body</p>
        </section>
      );
    }
    navigate("#target-section", "s");
    render(<Sections />);
    expect(screen.getByRole("heading", { name: "Section heading" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "Section heading" }).scrollIntoView).toHaveBeenCalled();
  });

  it("leaves an id it doesn't render alone, and a page with no fragment", () => {
    navigate("#other", "f");
    render(<Page />);
    expect(screen.getByText("Other")).not.toHaveFocus();
    window.history.replaceState(null, "", "/app");
    render(<Page />);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
