import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { productionGraphTwoSites } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { paletteGroups } from "../palette/paletteCommands";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { pageQueries } from "./pageQueries";
import { PLANNER_IN_NAV, visibleTabs } from "./tabs";

// ADR-0050 task 6: the graph view landed, so the Planner tab is listed (nav, prefetch, command bar).

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

describe("the Planner tab", () => {
  it("is switched on", () => {
    expect(PLANNER_IN_NAV).toBe(true);
  });

  it("is a tab in the nav, after Factory, and follows the page", async () => {
    window.history.pushState(null, "", "/app");
    renderWithClient(<App />);
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(nav.getAllByRole("link").map((l) => l.textContent)).toEqual(["Overview", "Power", "Factory", "Planner", "Map", "Settings"]);
    fireEvent.click(nav.getByRole("link", { name: "Planner" }));
    expect(await screen.findByRole("region", { name: "Production planner" }, { timeout: 3_000 })).toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Planner" })).toHaveAttribute("aria-current", "page");
  });

  it("is in the command bar's pages, after Factory", () => {
    const pages = paletteGroups({ isOperator: true, serverCount: 1, labels: new Map() }).find((g) => g.heading === "Pages");
    expect(pages?.commands.map((c) => c.label)).toEqual(["Overview", "Power", "Factory", "Planner", "Map", "Settings", "Servers", "Metrics"]);
    expect(pages?.commands.find((c) => c.label === "Planner")?.to).toBe("/app/planner");
  });

  it("is prefetched when its nav link is hovered", async () => {
    let reads = 0;
    server.use(
      http.get(endpoints.productionGraph.route, () => {
        reads += 1;
        return HttpResponse.json(productionGraphTwoSites);
      }),
    );
    window.history.pushState(null, "", "/app");
    renderWithClient(<App />);
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(reads).toBe(0);
    fireEvent.mouseEnter(nav.getByRole("link", { name: "Planner" }));
    await waitFor(() => expect(reads).toBe(1));
    expect(pageQueries("/app/planner", "default")).toHaveLength(1);
  });
});

describe("the tab list", () => {
  it("sits after Factory, with the operator's Servers and Metrics last", () => {
    expect(visibleTabs(false).map((t) => t.label)).toEqual(["Overview", "Power", "Factory", "Planner", "Map", "Settings"]);
    expect(visibleTabs(true).slice(-2).map((t) => t.label)).toEqual(["Servers", "Metrics"]);
  });

  it("can still be built without the Planner", () => {
    expect(visibleTabs(false, false).some((t) => t.to === "/app/planner")).toBe(false);
    const pages = paletteGroups({ isOperator: false, serverCount: 1, labels: new Map(), plannerInNav: false }).find((g) => g.heading === "Pages");
    expect(pages?.commands.some((c) => c.label === "Planner")).toBe(false);
  });
});
