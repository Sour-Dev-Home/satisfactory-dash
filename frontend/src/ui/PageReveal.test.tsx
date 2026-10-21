import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageReveal } from "./PageReveal";
import { Loadable, PanelSkeleton } from "./Skeleton";
import type { PageQuery } from "./usePageReveal";

// The page reveal (#494), on fake timers: panels load at once but show together, when the primary
// queries have answered or the 400 ms budget is up, whichever comes first.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A query whose answer the test releases by hand. */
function controlled(key: string) {
  let resolve: (value: string) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const options = { queryKey: ["page", key], queryFn: () => promise, retry: false } as unknown as PageQuery;
  return { options, resolve, reject };
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const page = () => document.querySelector("[data-page-reveal]");

function renderPage(queryClient: QueryClient, queries: PageQuery[], scope = "a", children = <p>Panels</p>) {
  const ui = (s: string) => (
    <QueryClientProvider client={queryClient}>
      <PageReveal queries={queries} scope={s}>
        {children}
      </PageReveal>
    </QueryClientProvider>
  );
  const view = render(ui(scope));
  return { ...view, rerenderScope: (s: string) => view.rerender(ui(s)) };
}

describe("PageReveal", () => {
  it("keeps the panels mounted but unseen until the primary queries answer, then shows them at once", async () => {
    const a = controlled("a");
    const b = controlled("b");
    renderPage(client(), [a.options, b.options]);
    expect(page()).toHaveAttribute("data-page-reveal", "waiting");
    expect(page()).toHaveClass("invisible");
    expect(page()).toHaveAttribute("aria-busy", "true");
    // Mounted (its queries run, its skeletons take their size), just not painted.
    expect(screen.getByText("Panels")).toBeInTheDocument();

    a.resolve("A");
    await tick(100);
    expect(page()).toHaveAttribute("data-page-reveal", "waiting");

    b.resolve("B");
    await tick(0);
    expect(page()).toHaveAttribute("data-page-reveal", "revealed");
    expect(page()).toHaveClass("animate-reveal");
    expect(page()).not.toHaveClass("invisible");
    expect(page()).not.toHaveAttribute("aria-busy");
  });

  it("reveals on its first render when every query is already cached", async () => {
    const queryClient = client();
    queryClient.setQueryData(["page", "a"], "A");
    const a = controlled("a");
    renderPage(queryClient, [a.options]);
    expect(page()).toHaveAttribute("data-page-reveal", "revealed");
  });

  it("reveals at the budget, not before, when a query is still slow", async () => {
    const slow = controlled("slow");
    renderPage(client(), [slow.options]);
    await tick(399);
    expect(page()).toHaveAttribute("data-page-reveal", "waiting");
    await tick(1);
    expect(page()).toHaveAttribute("data-page-reveal", "revealed");
  });

  it("counts a failed query as answered", async () => {
    const bad = controlled("bad");
    renderPage(client(), [bad.options]);
    bad.reject(new Error("boom"));
    await tick(0);
    expect(page()).toHaveAttribute("data-page-reveal", "revealed");
  });

  it("stays revealed when a query later goes back to loading", async () => {
    const queryClient = client();
    const a = controlled("a");
    renderPage(queryClient, [a.options]);
    a.resolve("A");
    await tick(0);
    expect(page()).toHaveAttribute("data-page-reveal", "revealed");

    await act(async () => {
      queryClient.removeQueries({ queryKey: ["page", "a"] });
    });
    await tick(1_000);
    expect(page()).toHaveAttribute("data-page-reveal", "revealed");
  });

  it("gives a new scope (another server) its own reveal", async () => {
    const queryClient = client();
    const a = controlled("a");
    const other = controlled("other");
    const view = renderPage(queryClient, [a.options], "a");
    a.resolve("A");
    await tick(0);
    expect(page()).toHaveAttribute("data-page-reveal", "revealed");

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <PageReveal queries={[other.options]} scope="b">
          <p>Panels</p>
        </PageReveal>
      </QueryClientProvider>,
    );
    expect(page()).toHaveAttribute("data-page-reveal", "waiting");
    await tick(400);
    expect(page()).toHaveAttribute("data-page-reveal", "revealed");
  });

  it("calls onRevealed once, when it reveals", async () => {
    const onRevealed = vi.fn();
    const a = controlled("a");
    render(
      <QueryClientProvider client={client()}>
        <PageReveal queries={[a.options]} scope="a" onRevealed={onRevealed}>
          <p>Panels</p>
        </PageReveal>
      </QueryClientProvider>,
    );
    expect(onRevealed).not.toHaveBeenCalled();
    a.resolve("A");
    await tick(0);
    expect(onRevealed).toHaveBeenCalledTimes(1);
  });

  it("does not start a panel's skeleton clock before the reveal, so a slow panel's skeleton shows after it", async () => {
    const slow = controlled("slow");
    render(
      <QueryClientProvider client={client()}>
        <PageReveal queries={[slow.options]} scope="a">
          <Loadable pending skeleton={<PanelSkeleton label="Loading slow…" />}>
            <p>Done</p>
          </Loadable>
        </PageReveal>
      </QueryClientProvider>,
    );
    // Budget over at 400 ms: the page shows, and the panel's own 150 ms delay starts only now.
    await tick(400);
    expect(document.querySelector("[data-loading]")).toHaveAttribute("data-loading", "waiting");
    await tick(150);
    expect(document.querySelector("[data-loading]")).toHaveAttribute("data-loading", "shown");
  });
});
