import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Loadable, PanelSkeleton } from "./Skeleton";
import { PageRevealContext } from "./skeletonClock";

// The skeleton timing rules (#494), on fake timers: no flash on a fast load, and no flicker on a
// slow one. Fallbacks apply in jsdom: 150 ms to show, 300 ms minimum.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function Panel({ pending }: { pending: boolean }) {
  return (
    <Loadable pending={pending} skeleton={<PanelSkeleton label="Loading thing…" />}>
      <p>The thing</p>
    </Loadable>
  );
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const skeletonBox = () => document.querySelector("[data-loading]");

describe("Loadable", () => {
  it("never shows a skeleton when the data lands inside the show-delay", async () => {
    const { rerender } = render(<Panel pending />);
    // The box is there from the start (reserved) but unseen.
    expect(skeletonBox()).toHaveAttribute("data-loading", "waiting");
    expect(skeletonBox()).toHaveClass("invisible");
    await tick(149);
    expect(skeletonBox()).toHaveAttribute("data-loading", "waiting");

    rerender(<Panel pending={false} />);
    expect(screen.getByText("The thing")).toBeInTheDocument();
    expect(skeletonBox()).toBeNull();
    await tick(1_000);
    expect(skeletonBox()).toBeNull();
  });

  it("shows the skeleton once the data has taken longer than the show-delay", async () => {
    render(<Panel pending />);
    await tick(150);
    expect(skeletonBox()).toHaveAttribute("data-loading", "shown");
    expect(skeletonBox()).not.toHaveClass("invisible");
    expect(screen.queryByText("The thing")).not.toBeInTheDocument();
  });

  it("keeps a shown skeleton for the minimum display, even if the data lands at once", async () => {
    const { rerender } = render(<Panel pending />);
    await tick(150);
    expect(skeletonBox()).toHaveAttribute("data-loading", "shown");

    await tick(50);
    rerender(<Panel pending={false} />);
    // Shown for 50 ms so far: it stays until 300 ms after it appeared (250 ms more).
    expect(screen.queryByText("The thing")).not.toBeInTheDocument();
    await tick(249);
    expect(screen.queryByText("The thing")).not.toBeInTheDocument();
    await tick(1);
    expect(screen.getByText("The thing")).toBeInTheDocument();
    expect(skeletonBox()).toBeNull();
  });

  it("swaps at once when the data lands after the minimum has passed", async () => {
    const { rerender } = render(<Panel pending />);
    await tick(150 + 300);
    rerender(<Panel pending={false} />);
    expect(screen.getByText("The thing")).toBeInTheDocument();
    expect(skeletonBox()).toBeNull();
  });

  it("fades content in only when it replaces a skeleton", async () => {
    const { container, rerender } = render(<Panel pending={false} />);
    expect(container.firstElementChild).not.toHaveClass("animate-reveal");

    rerender(<Panel pending />);
    await tick(150);
    rerender(<Panel pending={false} />);
    await tick(300);
    expect(container.firstElementChild).toHaveClass("animate-reveal");
  });

  it("does not start the show-delay until the page around it is revealed", async () => {
    function Page({ revealed }: { revealed: boolean }) {
      return (
        <PageRevealContext.Provider value={revealed}>
          <Panel pending />
        </PageRevealContext.Provider>
      );
    }
    const { rerender } = render(<Page revealed={false} />);
    await tick(2_000);
    expect(skeletonBox()).toHaveAttribute("data-loading", "waiting");

    rerender(<Page revealed />);
    await tick(149);
    expect(skeletonBox()).toHaveAttribute("data-loading", "waiting");
    await tick(1);
    expect(skeletonBox()).toHaveAttribute("data-loading", "shown");
  });

  it("clears its timers on unmount", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Panel pending />);
    unmount();
    await tick(1_000);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("announces the loading panel to screen readers once it is shown, never as visible text", async () => {
    render(<Panel pending />);
    await tick(150);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading thing…");
    expect(status).toHaveClass("sr-only");
    expect(document.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
    for (const block of document.querySelectorAll("[data-skeleton]")) expect(block).toHaveAttribute("aria-hidden", "true");
  });

  it("honours a zero minimum (reduced motion): the swap is immediate", async () => {
    document.documentElement.style.setProperty("--duration-skeleton-min", "0s");
    try {
      const { rerender } = render(<Panel pending />);
      await tick(150);
      rerender(<Panel pending={false} />);
      await tick(0);
      expect(screen.getByText("The thing")).toBeInTheDocument();
    } finally {
      document.documentElement.style.removeProperty("--duration-skeleton-min");
    }
  });
});
