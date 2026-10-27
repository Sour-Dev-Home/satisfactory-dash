import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { productionGraphFactories, serversRoleOwner, serversRoleViewer } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";

// ADR-0055 Decision 12 (#727): on the overview canvas, Shift- or Ctrl-click picks factories for a merge.

afterEach(() => {
  vi.unstubAllGlobals();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

function wideScreen() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), addEventListener: () => {}, removeEventListener: () => {} }));
}

function renderView(servers = serversRoleOwner) {
  wideScreen();
  server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(productionGraphFactories)));
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={servers.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
}

const overview = () => screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
const factoryCards = (svg: HTMLElement) => [...svg.querySelectorAll<SVGGElement>('[data-card="factory"]')];

describe("picking factories on the overview canvas", () => {
  it("Shift-click and Ctrl-click pick factory cards, marked and counted; Escape clears them; a plain click opens", async () => {
    renderView();
    const svg = await overview();
    const [first, second] = factoryCards(svg);
    fireEvent.click(first!, { shiftKey: true });
    expect(first).toHaveAttribute("data-picked", "true");
    const bar = screen.getByRole("group", { name: "Selected factories" });
    expect(within(bar).getByRole("status")).toHaveTextContent("1 factory selected");
    fireEvent.click(second!, { ctrlKey: true });
    expect(within(bar).getByRole("status")).toHaveTextContent("2 factories selected");
    expect(screen.getAllByRole("button", { name: /, selected$/ })).toHaveLength(2);
    // Shift-click again unpicks.
    fireEvent.click(second!, { shiftKey: true });
    expect(within(bar).getByRole("status")).toHaveTextContent("1 factory selected");
    fireEvent.keyDown(screen.getByRole("group", { name: /^Graph viewport/ }), { key: "Escape" });
    expect(within(bar).getByRole("status")).toHaveTextContent("No factories selected");
    fireEvent.click(first!);
    expect(await screen.findByRole("heading", { name: "Groups", hidden: true })).toBeInTheDocument();
  });

  it("a viewer's Shift-click opens the factory as before", async () => {
    renderView(serversRoleViewer);
    const svg = await overview();
    fireEvent.click(factoryCards(svg)[0]!, { shiftKey: true });
    expect(screen.queryByRole("group", { name: "Selected factories" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Groups", hidden: true })).toBeInTheDocument();
    // No Select tool either: a viewer cannot merge.
    expect(screen.queryByRole("button", { name: "Select" })).not.toBeInTheDocument();
  });
});

describe("the overview's Select tool (the owner, 2026-10-27)", () => {
  it("says how to pick while nothing is picked, and turns a plain click or tap into a pick", async () => {
    renderView();
    const svg = await overview();
    const bar = screen.getByRole("group", { name: "Selected factories" });
    expect(within(bar).getByRole("status")).toHaveTextContent("No factories selected: turn on Select above to pick some");
    const select = within(screen.getByRole("group", { name: "Merge" })).getByRole("button", { name: "Select" });
    expect(select).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(select);
    expect(select).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Click factories to pick them for a merge; Escape clears.")).toBeInTheDocument();
    const [first, second] = factoryCards(svg);
    fireEvent.click(first!);
    fireEvent.click(second!);
    expect(first).toHaveAttribute("data-picked", "true");
    expect(within(bar).getByRole("status")).toHaveTextContent("2 factories selected");
    // A plain click on a picked factory unpicks it; nothing opens while Select is on.
    fireEvent.click(second!);
    expect(within(bar).getByRole("status")).toHaveTextContent("1 factory selected");
    expect(screen.queryByRole("heading", { name: "Groups", hidden: true })).not.toBeInTheDocument();
    // Off again: a click opens.
    fireEvent.click(select);
    fireEvent.click(second!);
    expect(await screen.findByRole("heading", { name: "Groups", hidden: true })).toBeInTheDocument();
  });

  it("makes each factory's keyboard button a pick toggle while Select is on", async () => {
    renderView();
    await overview();
    fireEvent.click(within(screen.getByRole("group", { name: "Merge" })).getByRole("button", { name: "Select" }));
    const picks = screen.getAllByRole("button", { name: /^Pick / });
    expect(picks.length).toBeGreaterThan(1);
    expect(picks[0]).toHaveAttribute("aria-pressed", "false");
    expect(picks[0].getAttribute("aria-label")).not.toMatch(/Open factory/);
    fireEvent.click(picks[0]);
    expect(picks[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("group", { name: "Selected factories" })).getByRole("status")).toHaveTextContent("1 factory selected");
  });
});
