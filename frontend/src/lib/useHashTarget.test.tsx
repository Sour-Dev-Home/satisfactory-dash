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

/** A navigation as the router makes one: a new history entry, with its own key. */
const navigate = (hash: string, key: string) => window.history.pushState({ key }, "", `/app${hash}`);

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

  it("leaves an id it doesn't render alone, and a page with no fragment", () => {
    navigate("#other", "f");
    render(<Page />);
    expect(screen.getByText("Other")).not.toHaveFocus();
    window.history.replaceState(null, "", "/app");
    render(<Page />);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
