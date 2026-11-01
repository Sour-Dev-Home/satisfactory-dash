import { act, configure, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { serversRoleOwner } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { designated, T, treeGraphResponse, treeWorld } from "../test/plannerTree";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { NESTING_KEY } from "./graph/plannerPrefs";
import { PlannerView } from "./PlannerView";

configure({ asyncUtilTimeout: 3_000 });

beforeEach(() => window.localStorage.setItem(NESTING_KEY, "on"));
afterEach(() => {
  window.localStorage.removeItem(NESTING_KEY);
  vi.unstubAllGlobals();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

function Where() {
  const location = useLocation();
  return <output aria-label="Address">{location.search}</output>;
}

describe("the open path's separator", () => {
  it("a key that holds the internal separator is trimmed, not shown as its valid prefix", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    const { graph, designations } = treeWorld();
    server.use(
      http.get(endpoints.productionGraph.route, () => HttpResponse.json(treeGraphResponse(graph))),
      http.get(endpoints.plannerDesignations.list.route, () => HttpResponse.json({ designations, matches: [] })),
    );
    const bad = `${designated(T)}\u0001junk`;
    renderWithClient(
      <MemoryRouter initialEntries={[`/app/planner?open=${encodeURIComponent(bad)}`]}>
        <Where />
        <ServerContext value={serversRoleOwner.servers[0]}>
          <PlannerView />
        </ServerContext>
      </MemoryRouter>,
    );
    expect(await screen.findByText("That factory is no longer here.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status", { name: "Address" }).textContent).toBe(`?open=${encodeURIComponent(designated(T))}`));
  });
});
