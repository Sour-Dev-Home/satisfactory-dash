import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { alertRulesList, factoryMixed, historyItems7d, powerOk, settingsEditable } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { keepForServer, queries } from "../api/queries";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { pageQueries } from "./pageQueries";

// Instant tab changes (#494): hovering or focusing a tab's link starts its page's primary queries.

function countRequests() {
  const hits = { power: 0, factory: 0, settings: 0, rules: 0 };
  server.use(
    http.get(endpoints.power.route, () => {
      hits.power += 1;
      return HttpResponse.json(powerOk);
    }),
    http.get(endpoints.factory.route, () => {
      hits.factory += 1;
      return HttpResponse.json(factoryMixed);
    }),
    http.get(endpoints.settings.get.route, () => {
      hits.settings += 1;
      return HttpResponse.json(settingsEditable);
    }),
    http.get(endpoints.alerts.rules.list.route, () => {
      hits.rules += 1;
      return HttpResponse.json(alertRulesList);
    }),
    http.get(endpoints.history.items.route, () => HttpResponse.json(historyItems7d)),
  );
  return hits;
}

async function mainNav() {
  return within(await screen.findByRole("navigation", { name: "Main" }));
}

describe("nav prefetch", () => {
  // Settings and its rules are read only by the Settings page, so nothing else (a poll, the open page) can
  // add a request: the count is the prefetch's alone.
  it("starts a tab's queries on hover, before it is clicked", async () => {
    window.history.pushState(null, "", "/app");
    const hits = countRequests();
    const { client } = renderWithClient(<App />);
    const nav = await mainNav();
    await screen.findByRole("region", { name: "Overview" }, { timeout: 3_000 });
    expect(hits.settings).toBe(0);

    fireEvent.mouseEnter(nav.getByRole("link", { name: "Settings" }));
    await waitFor(() => expect(client.getQueryData(queries.settings("default").queryKey)).toBeDefined());
    expect(hits.settings).toBe(1);
  });

  it("starts them on keyboard focus too", async () => {
    window.history.pushState(null, "", "/app");
    const hits = countRequests();
    renderWithClient(<App />);
    const nav = await mainNav();
    await screen.findByRole("region", { name: "Overview" }, { timeout: 3_000 });
    expect(hits.rules).toBe(0);

    fireEvent.focus(nav.getByRole("link", { name: "Settings" }));
    await waitFor(() => expect(hits.rules).toBe(1));
  });

  it("does not refetch on every hover: a fresh answer is reused", async () => {
    window.history.pushState(null, "", "/app");
    const hits = countRequests();
    renderWithClient(<App />);
    const nav = await mainNav();
    await screen.findByRole("region", { name: "Overview" });
    const power = nav.getByRole("link", { name: "Power" });
    fireEvent.mouseEnter(power);
    await waitFor(() => expect(hits.power).toBeGreaterThan(0));
    const after = hits.power;
    fireEvent.mouseEnter(power);
    fireEvent.focus(power);
    await new Promise((r) => setTimeout(r, 50));
    expect(hits.power).toBe(after);
  });

  it("does not prefetch the page that is already open", async () => {
    window.history.pushState(null, "", "/app/power");
    const hits = countRequests();
    renderWithClient(<App />);
    const nav = await mainNav();
    await screen.findByRole("region", { name: "Power" });
    await waitFor(() => expect(hits.power).toBeGreaterThan(0));
    const settled = hits.power;
    fireEvent.mouseEnter(nav.getByRole("link", { name: "Power" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(hits.power).toBe(settled);
  });
});

describe("pageQueries", () => {
  it("names each tab's primary queries by the cache's own keys", () => {
    const keys = (path: string) => pageQueries(path, "s1").map((q) => q.queryKey.join("/"));
    expect(keys("/app")).toEqual(["servers/s1/status", "servers/s1/power", "servers/s1/factory"]);
    expect(keys("/app/power")).toEqual(["servers/s1/power"]);
    expect(keys("/app/map")).toEqual(["servers/s1/factory", "servers/s1/map/world/rails", "servers/s1/map/world/resourceNodes", "servers/s1/map/world/mapMarkers", "servers/s1/map/live"]);
    expect(keys("/app/factory")).toContain("servers/s1/factory");
    expect(keys("/app/factory")).toContain("servers/s1/history/items/7d");
    expect(keys("/app/settings")).toContain("servers/s1/settings");
    expect(keys("/app/settings")).toContain("servers/s1/alerts/rules");
    expect(keys("/app/servers")).toEqual(["serverManagement"]);
    expect(keys("/app/nowhere")).toEqual([]);
  });
});

describe("keepForServer", () => {
  const previous = { queryKey: ["servers", "s1", "history", "items", "24h"] };

  it("keeps the last answer for the same server (a range change)", () => {
    expect(keepForServer("s1")("old", previous)).toBe("old");
  });

  it("drops it for another server, so one server's data is never shown as another's", () => {
    expect(keepForServer("s2")("old", previous)).toBeUndefined();
  });

  it("has nothing to keep on a first load", () => {
    expect(keepForServer("s1")(undefined, undefined)).toBeUndefined();
  });
});
