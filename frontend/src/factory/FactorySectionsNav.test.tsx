import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryEmpty, factoryMixed, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { FactoryPanel } from "./FactoryPanel";
import { FactorySectionsNav } from "./FactorySectionsNav";
import { FactoryView } from "./FactoryView";

// One macrotask before cleanup, so responses already sent settle before the view unmounts (#386).
afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

function renderPage() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <BrowserRouter>
        <FactoryView />
      </BrowserRouter>
    </ServerContext>,
  );
}

const nav = () => screen.getByRole("navigation", { name: "Factory sections" });

describe("the Factory page's in-page nav (ADR-0062 F.4)", () => {
  it("links to the three sections in page order, keeping the search", async () => {
    window.history.pushState(null, "", "/app/factory?q=smelter&item=Desc_IronPlate_C");
    renderPage();
    await screen.findByRole("navigation", { name: "Factory sections" });
    const links = within(nav()).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Machines", "History", "Bottlenecks"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/app/factory?q=smelter&item=Desc_IronPlate_C#machines",
      "/app/factory?q=smelter&item=Desc_IronPlate_C#history",
      "/app/factory?q=smelter&item=Desc_IronPlate_C#bottlenecks",
    ]);
  });

  it("jumps to each section and focuses its heading, and a second click on the same link jumps again", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.pushState(null, "", "/app/factory");
    renderPage();
    await screen.findByRole("navigation", { name: "Factory sections" });

    fireEvent.click(within(nav()).getByRole("link", { name: "History" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Production history" })).toHaveFocus());
    expect(window.location.hash).toBe("#history");

    fireEvent.click(within(nav()).getByRole("link", { name: "Machines" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Factory", level: 3 })).toHaveFocus());
    const calls = scroll.mock.calls.length;
    // The reader scrolls away and clicks the same link again: a push, so the jump runs once more.
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(within(nav()).getByRole("link", { name: "Machines" }));
    await waitFor(() => expect(scroll.mock.calls.length).toBe(calls + 1));
    expect(screen.getByRole("heading", { name: "Factory", level: 3 })).toHaveFocus();

    fireEvent.click(within(nav()).getByRole("link", { name: "Bottlenecks" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Bottlenecks" })).toHaveFocus());
  });

  it("gives every target a scroll margin, so a jump leaves room above its heading", async () => {
    window.history.pushState(null, "", "/app/factory");
    const { container } = renderPage();
    await screen.findByRole("heading", { name: "Bottlenecks" });
    for (const id of ["machines", "history", "bottlenecks"]) {
      expect(container.querySelector(`#${id}`)).toHaveClass("scroll-mt-4");
    }
  });
});

describe("the machine table's filter bar (ADR-0062 F.4)", () => {
  it("is one sticky bar with the nav, the search and the state filters", () => {
    const { container } = render(
      <MemoryRouter>
        <FactoryPanel snapshot={factoryMixed} nav={<FactorySectionsNav />} />
      </MemoryRouter>,
    );
    const bar = container.querySelector<HTMLElement>("[data-filter-bar]");
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("sm:sticky", "sm:top-0", "sm:z-(--z-sticky)", "sm:bg-surface");
    const inBar = within(bar!);
    expect(inBar.getByRole("navigation", { name: "Factory sections" })).toBeInTheDocument();
    expect(inBar.getByRole("searchbox", { name: "Search machines" })).toBeInTheDocument();
    const filters = inBar.getByRole("group", { name: "Filter machines" });
    expect(within(filters).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Backed up", "Paused", "No recipe"]);
    // On a phone only the nav and the search stick: the outer box is `contents` there, and the inner row sticks alone.
    expect(bar).toHaveClass("contents");
    const phoneRow = inBar.getByRole("navigation", { name: "Factory sections" }).parentElement!;
    expect(phoneRow).toHaveClass("max-sm:sticky", "max-sm:top-0", "max-sm:bg-surface");
    expect(phoneRow).toContainElement(inBar.getByRole("searchbox", { name: "Search machines" }));
    expect(phoneRow).not.toContainElement(filters);
    // The table is below the bar, never inside it.
    expect(bar).not.toContainElement(screen.getByRole("table"));
  });

  it("keeps the nav when there are no machines yet", () => {
    render(
      <MemoryRouter>
        <FactoryPanel snapshot={factoryEmpty} nav={<FactorySectionsNav />} />
      </MemoryRouter>,
    );
    expect(screen.getByText("No machines yet.")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Factory sections" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filter machines" })).not.toBeInTheDocument();
  });

  it("renders no bar at all with neither a nav nor machines", () => {
    const { container } = render(<FactoryPanel snapshot={factoryEmpty} />);
    expect(container.querySelector("[data-filter-bar]")).toBeNull();
  });
});
