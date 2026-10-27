import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { productionGraphFactories, serversRoleOwner } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { PlannerView } from "./PlannerView";

// The owner, 2026-10-27: going one level up should be easy, and zoom, fit and Select should be the usual icons.

afterEach(() => {
  vi.unstubAllGlobals();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

/** Stands in for the browser: its Back button and the address bar. */
function Browser() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => void navigate(-1)}>
        Browser back
      </button>
      <output aria-label="Address">{`${location.pathname}${location.search}${location.hash}`}</output>
    </>
  );
}

function renderView(entry = "/app/planner?scenario=x#top") {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), addEventListener: () => {}, removeEventListener: () => {} }));
  server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(productionGraphFactories)));
  return renderWithClient(
    <MemoryRouter initialEntries={["/app", entry]} initialIndex={1}>
      <Browser />
      <ServerContext value={serversRoleOwner.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
}

const address = () => screen.getByRole("status", { name: "Address" }).textContent;
const overview = () => screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
const groupsHeading = () => screen.findByRole("heading", { name: "Groups", hidden: true });

async function openFirstFactory() {
  const svg = await overview();
  fireEvent.click(svg.querySelector<SVGGElement>('[data-card="factory"]')!);
  await groupsHeading();
}

describe("going one level up", () => {
  it("opening a factory puts it in the address, keeping the other parameters and the fragment", async () => {
    renderView();
    await openFirstFactory();
    expect(address()).toMatch(/^\/app\/planner\?scenario=x&open=[^#]+#top$/);
  });

  it("the browser's Back returns to the overview and focuses its heading", async () => {
    renderView();
    await openFirstFactory();
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    await overview();
    expect(screen.queryByRole("heading", { name: "Groups", hidden: true })).not.toBeInTheDocument();
    expect(address()).toBe("/app/planner?scenario=x#top");
    expect(screen.getByRole("heading", { name: "Production planner" })).toHaveFocus();
  });

  it("the All factories button steps back through the entry opening made, so Back afterwards leaves the Planner", async () => {
    renderView();
    await openFirstFactory();
    fireEvent.click(screen.getByRole("button", { name: "All factories" }));
    await overview();
    expect(address()).toBe("/app/planner?scenario=x#top");
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    expect(address()).toBe("/app");
  });

  it("a link straight to a factory opens it, and All factories then replaces the address instead of leaving the page", async () => {
    const key = productionGraphFactories.data.factories![0]!.key;
    // A fresh visit to that address: no history entry made by the Planner.
    renderView(`/app/planner?scenario=x&open=${encodeURIComponent(key)}#top`);
    await groupsHeading();
    fireEvent.click(screen.getByRole("button", { name: "All factories" }));
    await overview();
    expect(address()).toBe("/app/planner?scenario=x#top");
    // Replaced, not pushed: Back leaves the Planner, as it would have before the link was followed.
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    expect(address()).toBe("/app");
  });
});

describe("edge cases in the address", () => {
  it("a stale key shows the overview, and opening a factory then replaces the key rather than adding a second", async () => {
    renderView("/app/planner?open=gone");
    const svg = await overview();
    expect(screen.queryByRole("heading", { name: "Groups", hidden: true })).not.toBeInTheDocument();
    fireEvent.click(svg.querySelector<SVGGElement>('[data-card="factory"]')!);
    await groupsHeading();
    expect(address()).not.toContain("gone");
    expect(address()!.match(/open=/g)).toHaveLength(1);
  });

  it("a key with reserved characters round-trips through the address", async () => {
    const key = "a&b=c#d e";
    const factories = productionGraphFactories.data.factories!;
    const data = { ...productionGraphFactories.data, factories: [{ ...factories[0]!, key }, ...factories.slice(1)] };
    renderView(`/app/planner?open=${encodeURIComponent(key)}`);
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...productionGraphFactories, data })));
    await groupsHeading();
    expect(address()).toBe("/app/planner?open=a%26b%3Dc%23d%20e");
  });
});

describe("the toolbar's icons", () => {
  it("zoom, fit and Select are icons at every width, named for assistive tech and titled for a pointer", async () => {
    renderView();
    await overview();
    const zoom = screen.getByRole("group", { name: "Zoom" });
    for (const name of ["Zoom in", "Zoom out", "Fit to view"]) {
      const button = within(zoom).getByRole("button", { name });
      expect(button).toHaveAttribute("title", name);
      expect(within(button).getByText(name)).toHaveClass("sr-only");
      expect(within(button).getByText(name)).not.toHaveClass("sm:not-sr-only");
      expect(button.querySelector("svg")).not.toHaveClass("sm:hidden");
    }
    const select = within(screen.getByRole("group", { name: "Merge" })).getByRole("button", { name: "Select" });
    expect(select).toHaveAttribute("title", "Select");
    expect(select).toHaveAttribute("aria-pressed", "false");
  });
});
