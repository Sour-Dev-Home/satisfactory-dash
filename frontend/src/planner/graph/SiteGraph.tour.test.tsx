import { act, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { factoryMixed, productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";

// The demo tour's planner targets (ADR-0065 build PR 2), as the demo build marks them: IS_DEMO on, as vite.config.ts sets it.
vi.mock("../../demo/mode", () => ({ IS_DEMO: true }));

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

async function openGraph() {
  server.use(http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)));
  renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
  fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
  return screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 3_000 });
}

describe("the planner's tour targets", () => {
  it("marks the canvas, one card of a group of machines, and the panel its click opens", async () => {
    await openGraph();
    expect(document.querySelectorAll('[data-tour="planner-canvas"]')).toHaveLength(1);
    const cards = document.querySelectorAll('[data-tour="planner-group-card"]');
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.getAttribute("data-card")).toBe("group");
    const node = productionGraphTwoSites.data.nodes.find((n) => n.key === card.getAttribute("data-node"));
    expect(node?.kind).toBe("machines");
    expect(document.querySelector('[data-tour="planner-group-panel"]')).toBeNull();

    // The card's keyboard path (the try-it step's Tab stop) is that card's own visually hidden button.
    const keys = document.querySelectorAll<HTMLButtonElement>('[data-tour="planner-group-card-key"]');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toHaveAttribute("aria-expanded", "false");

    // The tour's click (TourHost's `openedBy`, and "Do it for me"): a bubbling click on the SVG card.
    act(() => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const panel = await screen.findByRole("complementary");
    expect(panel).toHaveAttribute("data-tour", "planner-group-panel");
    expect(keys[0]).toHaveAttribute("aria-expanded", "true");

    // Escape on the canvas closes the panel and says it was handled, so the tour's page-wide Escape leaves it alone.
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      keys[0].dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
