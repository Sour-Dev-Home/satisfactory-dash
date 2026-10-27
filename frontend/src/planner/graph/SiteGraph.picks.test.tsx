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
  });
});
