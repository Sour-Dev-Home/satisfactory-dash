import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { factoryMixed } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { paletteGroups } from "../palette/paletteCommands";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { pageQueries } from "./pageQueries";
import { PLANNER_IN_NAV, visibleTabs } from "./tabs";

// ADR-0050 task 5: the Planner page is routed but not listed until the graph view lands (task 6 flips PLANNER_IN_NAV).

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

describe("the Planner page while it is hidden", () => {
  it("is switched off", () => {
    expect(PLANNER_IN_NAV).toBe(false);
  });

  it("is not a tab in the nav", async () => {
    window.history.pushState(null, "", "/app");
    renderWithClient(<App />);
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(nav.getByRole("link", { name: "Factory" })).toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "Planner" })).not.toBeInTheDocument();
  });

  it("is not in the command bar's pages", () => {
    const pages = paletteGroups({ isOperator: true, serverCount: 1, labels: new Map() }).find((g) => g.heading === "Pages");
    expect(pages?.commands.map((c) => c.label)).toEqual(["Overview", "Power", "Factory", "Map", "Settings", "Servers"]);
  });

  it("still renders at /app/planner, and the nav does not follow it", async () => {
    window.history.pushState(null, "", "/app/planner");
    renderWithClient(<App />);
    expect(await screen.findByRole("region", { name: "Production planner" }, { timeout: 3_000 })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Iron Plate site" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Planner" })).not.toBeInTheDocument();
  });

  it("is not prefetched by a nav link (no link exists to hover), though its page has primary queries", async () => {
    let reads = 0;
    server.use(
      http.get(endpoints.productionGraph.route, () => {
        reads += 1;
        return HttpResponse.json({});
      }),
      http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)),
    );
    window.history.pushState(null, "", "/app");
    renderWithClient(<App />);
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    for (const link of nav.getAllByRole("link")) fireEvent.mouseEnter(link);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(reads).toBe(0);
    expect(pageQueries("/app/planner", "default")).toHaveLength(1);
  });
});

describe("the Planner page once it is switched on", () => {
  it("sits after Factory in the nav and the command bar", () => {
    expect(visibleTabs(false, true).map((t) => t.label)).toEqual(["Overview", "Power", "Factory", "Planner", "Map", "Settings"]);
    expect(visibleTabs(true, true).at(-1)?.label).toBe("Servers");
    const pages = paletteGroups({ isOperator: false, serverCount: 1, labels: new Map(), plannerInNav: true }).find(
      (g) => g.heading === "Pages",
    );
    expect(pages?.commands.map((c) => c.label)).toEqual(["Overview", "Power", "Factory", "Planner", "Map", "Settings"]);
    expect(pages?.commands.find((c) => c.label === "Planner")?.to).toBe("/app/planner");
  });

  it("is off in the default tab list", () => {
    expect(visibleTabs(false).some((t) => t.to === "/app/planner")).toBe(false);
  });
});
