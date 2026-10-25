import { fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type ServerListResponse } from "@satisfactory-dash/shared";
import { serversMemberCannotManage, serversSingle } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { paletteGroups } from "../palette/paletteCommands";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { pageQueries } from "../shell/pageQueries";
import { visibleTabs } from "../shell/tabs";

// ADR-0056 section 3: the metrics page is the operator's, and in the real app it is not in the nav, even for them. The
// command bar and the Servers page are its doors; anyone else typing the URL gets the unknown-page redirect.

const listServers = (body: ServerListResponse) => server.use(http.get(endpoints.servers.route, () => HttpResponse.json(body)));
const operator = { ...serversSingle, canManageServers: true };

describe("the metrics page's visibility", () => {
  it("is never a tab in the real app, for the operator or anyone else", () => {
    expect(visibleTabs(true).map((t) => t.label)).not.toContain("Metrics");
    expect(visibleTabs(false).map((t) => t.label)).not.toContain("Metrics");
  });

  it("is a tab in the demo build, for the operator only", () => {
    expect(visibleTabs(true, true, true).map((t) => t.label)).toEqual([
      "Overview", "Power", "Factory", "Planner", "Map", "Settings", "Servers", "Metrics",
    ]);
    expect(visibleTabs(false, true, true).map((t) => t.label)).not.toContain("Metrics");
  });

  it("is a command for the operator only", () => {
    const pages = (isOperator: boolean) =>
      paletteGroups({ isOperator, serverCount: 1, labels: new Map() }).find((g) => g.heading === "Pages")?.commands ?? [];
    expect(pages(true).find((c) => c.id === "page-metrics")).toMatchObject({ label: "Metrics", to: "/app/metrics" });
    expect(pages(false).map((c) => c.id)).not.toContain("page-metrics");
  });

  it("starts its read when the page opens, for the page reveal and any prefetch", () => {
    expect(pageQueries("/app/metrics", "default").map((q) => q.queryKey)).toEqual([["metrics", "24h"]]);
  });
});

describe("reaching /app/metrics", () => {
  it("opens for the operator, who sees no Metrics tab", async () => {
    listServers(operator);
    window.history.pushState(null, "", "/app/metrics");
    renderWithClient(<App />);
    expect(await screen.findByRole("region", { name: "System" }, { timeout: 3_000 })).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    expect(nav.queryByRole("link", { name: "Metrics" })).not.toBeInTheDocument();
  });

  it.each([
    ["a member", serversMemberCannotManage],
    ["an older backend without the flag", serversSingle],
  ])("goes back to the app for %s, without asking the backend for metrics", async (_who, list) => {
    let asked = false;
    server.use(
      http.get(endpoints.metrics.overview.route, () => {
        asked = true;
        return HttpResponse.json({});
      }),
    );
    listServers(list);
    window.history.pushState(null, "", "/app/metrics?scenario=x");
    renderWithClient(<App />);
    await screen.findByRole("region", { name: "Overview" }, { timeout: 3_000 });
    expect(window.location.pathname).toBe("/app");
    expect(window.location.search).toBe("?scenario=x");
    expect(asked).toBe(false);
  });

  it("is linked from the operator's Servers page", async () => {
    listServers(operator);
    window.history.pushState(null, "", "/app/servers");
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Open the metrics page" }, { timeout: 3_000 }));
    expect(await screen.findByRole("region", { name: "System" }, { timeout: 3_000 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/metrics");
  });
});
