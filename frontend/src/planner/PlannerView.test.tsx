import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  bottlenecksBeltLevel,
  errorUpstreamAuthRejected,
  productionGraphEmpty,
  productionGraphTwoSites,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { PlannerView } from "./PlannerView";

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

function renderView() {
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
}

const answer = (body: JsonBodyType) => server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(body)));

/** The default bottleneck finding, moved onto two machines of the iron site's constructor manifold. */
const findingOnIronSite = {
  ...bottlenecksBeltLevel,
  data: {
    ...bottlenecksBeltLevel.data,
    findings: [
      {
        ...bottlenecksBeltLevel.data.findings[0],
        buildingId: "Build_ConstructorMk1_C_3",
        affectedCount: 2,
        affected: [
          { buildingId: "Build_ConstructorMk1_C_3", buildingName: "Constructor", recipe: "Iron Plate" },
          { buildingId: "Build_ConstructorMk1_C_4", buildingName: "Constructor", recipe: "Iron Plate" },
        ],
      },
    ],
  },
};

const card = async (name: string) => (await screen.findByRole("heading", { name })).closest("li") as HTMLElement;

describe("PlannerView: the site overview", () => {
  it("shows a card per site with its machines, states and top outputs", async () => {
    renderView();
    const iron = await card("Iron Plate site");
    expect(iron).toHaveTextContent("15 machines · 12 Producing, 2 Underfed");
    expect(within(iron).getByRole("list", { name: "Top outputs of Iron Plate site" })).toHaveTextContent("Iron Plate: 72 / 160 items/min");
    const copper = await card("Copper Ingot site");
    expect(copper).toHaveTextContent("3 machines · 3 Producing");
    expect(screen.getByText(/2 sites · 18 machines in 7 groups/)).toBeInTheDocument();
  });

  it("counts a site's bottlenecks by joining the finder's findings on building id, and links to the Factory page", async () => {
    server.use(http.get(endpoints.bottlenecks.route, () => HttpResponse.json(findingOnIronSite)));
    renderView();
    const iron = await card("Iron Plate site");
    const link = await within(iron).findByRole("link", { name: /1 bottleneck in Iron Plate site/ });
    expect(link).toHaveAttribute("href", "/app/factory#bottlenecks-heading");
    expect(await within(await card("Copper Ingot site")).findByText("No bottlenecks")).toBeInTheDocument();
  });

  it("holds the bottleneck line empty, a line tall, while the finder's read has not answered", async () => {
    server.use(http.get(endpoints.bottlenecks.route, () => new Promise<never>(() => {})));
    renderView();
    const iron = await card("Iron Plate site");
    expect(within(iron).queryByText(/bottleneck/i)).not.toBeInTheDocument();
    const line = iron.querySelector("[data-bottleneck-line]");
    expect(line).toHaveClass("min-h-lh");
    expect(line).toBeEmptyDOMElement();
  });

  it("fills the reserved bottleneck line in place when the late read answers, so nothing below it moves", async () => {
    // The bottlenecks read is not one the reveal waits for: it can answer after the cards are on screen (#494).
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    server.use(
      http.get(endpoints.bottlenecks.route, async () => {
        await answered;
        return HttpResponse.json(findingOnIronSite);
      }),
    );
    renderView();
    const iron = await card("Iron Plate site");
    const before = iron.querySelector("[data-bottleneck-line]");
    const shape = Array.from(iron.children, (el) => el.tagName);
    expect(before).not.toBeNull();
    answer();
    await within(iron).findByRole("link", { name: /1 bottleneck in Iron Plate site/ });
    expect(iron.querySelector("[data-bottleneck-line]")).toBe(before);
    expect(Array.from(iron.children, (el) => el.tagName)).toEqual(shape);
  });

  it("says how many machines are on no conveyor, and the refresh note", async () => {
    renderView();
    const notes = await screen.findByRole("list", { name: "Planner notes" });
    expect(notes).toHaveTextContent("1 machine is on no conveyor the last read knew of, so it is in no group.");
    expect(notes).toHaveTextContent("Connections refresh every 10 minutes.");
  });
});

describe("PlannerView: a site's detail", () => {
  async function openIron() {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
    return screen.findByRole("heading", { name: "Iron Plate site", level: 4 });
  }

  it("moves focus to the site's heading and goes back to the overview", async () => {
    const heading = await openIron();
    expect(heading).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "All sites" }));
    expect(await screen.findByRole("button", { name: "Open site: Copper Ingot site" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Production planner" })).toHaveFocus();
  });

  it("lists the groups with count, recipe, actual over max, states and the loop marker", async () => {
    await openIron();
    const rows = within(screen.getAllByRole("table")[0]).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    const plates = rows.find((r) => r.textContent?.includes("Iron Plate: 72 / 160 items/min")) as HTMLElement;
    expect(plates).toHaveTextContent("Constructor");
    expect(plates).toHaveTextContent("In a loop");
    expect(plates).toHaveTextContent("6 Producing, 2 Underfed");
    // The miner is not in a loop.
    expect(rows[0]).toHaveTextContent("Miner Mk.2");
    expect(within(rows[0]).getByText("No")).toBeInTheDocument();
  });

  it("words each connection's rate: measured plain, 'about' for estimated, 'unknown' with no number; marks the mixed belt", async () => {
    await openIron();
    const rows = within(screen.getAllByRole("table")[1]).getAllByRole("row");
    const rowFor = (item: string, rate: string) => rows.find((r) => r.textContent?.includes(item) && r.textContent?.includes(rate));
    expect(rowFor("Iron Ore", "120 items/min")).toBeDefined();
    expect(rowFor("Iron Ingot", "about 102.2 items/min")).toBeDefined();
    const mixed = rows.find((r) => r.textContent?.includes("Iron Plate (mixed belt)")) as HTMLElement;
    expect(mixed).toHaveTextContent("unknown");
    expect(mixed.textContent).not.toMatch(/\d+ items\/min/);
    expect(within(mixed).getByRole("rowheader")).toHaveTextContent("8× Constructor, Iron Plate");
    expect(mixed).toHaveTextContent("Storage Container");
  });

  it("badges a group whose machines have a finding, and not the others", async () => {
    server.use(http.get(endpoints.bottlenecks.route, () => HttpResponse.json(findingOnIronSite)));
    await openIron();
    const rows = within(screen.getAllByRole("table")[0]).getAllByRole("row").slice(1);
    const badged = await screen.findAllByRole("link", { name: /1 bottleneck in 8× Constructor, Iron Plate/ });
    expect(badged).toHaveLength(1);
    expect(rows.filter((r) => within(r).queryByRole("link") !== null)).toHaveLength(1);
  });

  it("renders game-server names as text, never as markup", async () => {
    const name = '<img src=x onerror="alert(1)">';
    const nodes = productionGraphTwoSites.data.nodes.map((n, i) => (i === 1 ? { ...n, name } : n));
    answer({ ...productionGraphTwoSites, data: { ...productionGraphTwoSites.data, nodes } });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
    expect((await screen.findAllByText(name, { exact: false })).length).toBeGreaterThan(0);
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("PlannerView: states", () => {
  it("says so for an empty factory", async () => {
    answer(productionGraphEmpty);
    renderView();
    expect(await screen.findByText(/No sites yet/)).toBeInTheDocument();
  });

  it.each([
    ["unsupported", "Item-level results only. Update FRM to 1.5.4 or newer for belt detail."],
    ["tooLarge", "Item-level results only: this factory's connection data is too large to read."],
    ["notReceived", "Item-level results only. The agent hasn't sent belt data yet; if this stays, update the agent."],
  ] as const)("shows the %s mode's note and no sites", async (beltData, note) => {
    answer({ ...productionGraphEmpty, data: { ...productionGraphEmpty.data, beltData, notes: [] } });
    renderView();
    expect(await screen.findByText(/needs belt data/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Planner notes" })).toHaveTextContent(note);
  });

  it("says when the data is stale", async () => {
    answer({ ...productionGraphTwoSites, stale: true });
    renderView();
    expect(await screen.findByText(/Showing last known planner data from/)).toBeInTheDocument();
  });

  it("shows the read's error in the panel", async () => {
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(errorUpstreamAuthRejected, { status: 502 })));
    renderView();
    expect(await screen.findByText(/credentials for the game server were rejected/)).toBeInTheDocument();
  });
});
