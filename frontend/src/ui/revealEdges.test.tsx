import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageReveal } from "./PageReveal";
import { Loadable, PanelSkeleton } from "./Skeleton";
import { parseCssTime } from "./loadTiming";
import type { PageQuery } from "./usePageReveal";

// Independent bug hunt on the page reveal (#494).

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function Panel({ pending }: { pending: boolean }) {
  return (
    <Loadable pending={pending} skeleton={<PanelSkeleton label="Loading thing…" />}>
      <p>The thing</p>
    </Loadable>
  );
}

describe("content that never replaced a visible skeleton", () => {
  it("does not fade in on its own when the data landed inside the show-delay (the page already fades it)", async () => {
    const { container, rerender } = render(<Panel pending />);
    await tick(50);
    rerender(<Panel pending={false} />);
    expect(screen.getByText("The thing")).toBeInTheDocument();
    expect(container.firstElementChild).not.toHaveClass("animate-reveal");
  });

  it("does not double-fade a panel whose data arrived while the page was still hidden", async () => {
    let resolve: (v: string) => void = () => {};
    const promise = new Promise<string>((r) => (resolve = r));
    const q = { queryKey: ["hunt", "p"], queryFn: () => promise } as unknown as PageQuery;
    const client = new QueryClient();
    function Inner() {
      return <Panel pending={!client.getQueryData(["hunt", "p"])} />;
    }
    const { container, rerender } = render(
      <QueryClientProvider client={client}>
        <PageReveal queries={[q]} scope="a">
          <Inner />
        </PageReveal>
      </QueryClientProvider>,
    );
    resolve("x");
    await tick(10);
    rerender(
      <QueryClientProvider client={client}>
        <PageReveal queries={[q]} scope="a">
          <Inner />
        </PageReveal>
      </QueryClientProvider>,
    );
    expect(container.querySelector("[data-page-reveal]")).toHaveAttribute("data-page-reveal", "revealed");
    expect(screen.getByText("The thing").parentElement).not.toHaveClass("animate-reveal");
  });
});

describe("onRevealed", () => {
  it("is not called again when the parent re-renders with a new callback function", async () => {
    const client = new QueryClient();
    const calls = vi.fn();
    const ui = () => (
      <QueryClientProvider client={client}>
        <PageReveal queries={[]} scope="a" onRevealed={() => calls()}>
          <p>x</p>
        </PageReveal>
      </QueryClientProvider>
    );
    const { rerender } = render(ui());
    await tick(0);
    rerender(ui());
    rerender(ui());
    expect(calls).toHaveBeenCalledTimes(1);
  });
});

describe("parseCssTime", () => {
  it("accepts CSS's case-insensitive units", () => {
    expect(parseCssTime("150MS")).toBe(150);
  });
});
