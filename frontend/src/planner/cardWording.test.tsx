import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints, type PlannerNode } from "@satisfactory-dash/shared";
import { factoryMixed, productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { PlannerView } from "./PlannerView";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { groupCard } from "./graph/canvasScene";
import { extractorOutput, nodeFacts, nodeSummary } from "./graph/graphModel";
import { GroupPanel } from "./graph/GroupPanel";
import { GroupsTable } from "./PlannerTables";

// Issue #728 Phase 1, steps 1 and 3: an extractor says what it mines (inferred from the node, no rate), and a machine
// with no recipe says "Not configured". The card, the tooltip, the side panel and the Tables view say the same.

const IRON = { className: "Desc_OreIron_C", name: "Iron Ore" };
const node = (over: Partial<PlannerNode> = {}): PlannerNode => ({
  key: "k",
  kind: "extractor",
  className: "Build_MinerMk2_C",
  name: "Miner Mk.2",
  recipe: null,
  count: 2,
  machineIds: ["m1", "m2"],
  stateCounts: { producing: 2 },
  products: [],
  ingredients: [],
  at: { x: 0, y: 0 },
  siteKey: "s",
  loop: false,
  ...over,
});
const miner = node({ resource: IRON });
const unknownMiner = node({ key: "u", resource: null });
const unassigned = node({ key: "a", kind: "machines", className: "Build_ConstructorMk1_C", name: "Constructor", recipe: null });
const storage = node({ key: "st", kind: "storage", className: "Build_StorageContainerMk1_C", name: "Storage Container", count: 1, machineIds: ["s1"] });

describe("card words", () => {
  it("an extractor's line is its inferred resource, with no rate and no 'No output data'", () => {
    expect(nodeSummary(miner)).toBe("Iron Ore");
    expect(extractorOutput(miner)).toEqual({ name: "Iron Ore", inferred: true });
    expect(nodeFacts(miner).outputs).toEqual(["Iron Ore (inferred from the node)"]);
  });

  it("an extractor whose resource was not found says so honestly", () => {
    expect(nodeSummary(unknownMiner)).toBe("Resource not identified");
    expect(nodeSummary(node({ resource: undefined }))).toBe("Resource not identified");
    expect(nodeFacts(unknownMiner).outputs).toEqual(["Resource not identified"]);
  });

  it("an extractor that has output data keeps it (the resource is only the fallback)", () => {
    const rated = node({ resource: IRON, products: [{ className: "Desc_OreIron_C", name: "Iron Ore", unit: "items/min", currentPerMinute: 60, maxPerMinute: 60 }] });
    expect(nodeSummary(rated)).toBe("Iron Ore · 60/min");
    expect(extractorOutput(rated)).toBeNull();
  });

  it("no recipe is 'Not configured' for a machine, and no recipe line at all for an extractor or storage", () => {
    expect(nodeFacts(unassigned).recipe).toBe("Not configured");
    expect(nodeFacts({ ...unassigned, recipe: " " }).recipe).toBe("Not configured");
    expect(nodeFacts(miner).recipe).toBeNull();
    expect(nodeFacts(storage).recipe).toBeNull();
  });

  it("the canvas card prints the resource, then the muted inference note; the tooltip says both", () => {
    const card = groupCard(miner);
    expect(card.lines).toEqual(["Iron Ore", "(inferred from the node)"]);
    expect(card.mutedFrom).toBe(1);
    expect(card.description).toContain("Iron Ore (inferred from the node)");
    expect(card.description).not.toMatch(/No recipe|No output data/);
    const unknown = groupCard(unknownMiner);
    expect(unknown.lines).toEqual(["Resource not identified"]);
    expect(unknown.mutedFrom).toBeUndefined();
  });
});

describe("Tables view (the text path)", () => {
  const rowOf = (name: string) => screen.getAllByRole("row").find((r) => within(r).queryByRole("rowheader", { name: new RegExp(`^${name}`) }) !== null)!;

  it("says the same as the card: resource, the inference note, and Not configured", () => {
    render(<GroupsTable nodes={[miner, node({ key: "u", className: "Build_OilPump_C", name: "Oil Extractor", resource: null }), unassigned, storage]} findings={undefined} />);
    const minerRow = rowOf("Miner Mk.2");
    expect(within(minerRow).getByText("Iron Ore")).toBeInTheDocument();
    expect(within(minerRow).getByText("(inferred from the node)")).toHaveClass("text-muted");
    expect(within(minerRow).getByText("Not applicable")).toBeInTheDocument();
    expect(within(rowOf("Oil Extractor")).getByText("Resource not identified")).toBeInTheDocument();
    expect(within(rowOf("Constructor")).getByText("Not configured")).toBeInTheDocument();
    expect(screen.queryByText("No recipe")).toBeNull();
  });

  it("a bubble of extractors names their resource on its own row", () => {
    const twin = node({ key: "k2", resource: IRON, treeKey: "t" });
    render(<GroupsTable nodes={[{ ...miner, treeKey: "t" }, twin]} findings={undefined} />);
    const bubbleRow = screen.getAllByRole("row").find((r) => r.querySelector("th[scope=rowgroup]") !== null)!;
    expect(within(bubbleRow).getByText("Iron Ore")).toBeInTheDocument();
    expect(within(bubbleRow).getByText("(inferred from the node)")).toHaveClass("text-muted");
    expect(screen.queryByText("No output data")).toBeNull();
  });

  it("a building of unknown kind with no recipe says Not known, not Not applicable", () => {
    render(<GroupsTable nodes={[node({ key: "o", kind: "other", className: "X", name: "Mystery", resource: null })]} findings={undefined} />);
    expect(within(rowOf("Mystery")).getByText("Not known")).toBeInTheDocument();
  });
});

describe("canvas", () => {
  it("draws the extractor's resource and a muted inference note on its card", async () => {
    const [first, ...rest] = productionGraphTwoSites.data.nodes;
    const graph = { ...productionGraphTwoSites, data: { ...productionGraphTwoSites.data, nodes: [{ ...first, products: [], resource: IRON }, ...rest] } };
    server.use(
      http.get(endpoints.productionGraph.route, () => HttpResponse.json(graph)),
      http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)),
    );
    renderWithClient(
      <MemoryRouter>
        <ServerContext value={serversSingle.servers[0]}>
          <PlannerView />
        </ServerContext>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
    fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
    const svg = await screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 3_000 });
    const note = [...svg.querySelectorAll("text")].find((t) => t.textContent === "(inferred from the node)")!;
    expect(note).toHaveClass("fill-muted");
    expect([...svg.querySelectorAll("text")].some((t) => t.textContent === "Iron Ore")).toBe(true);
    expect(screen.getByRole("button", { name: /Miner Mk\.2.*Iron Ore \(inferred from the node\)/ })).toBeInTheDocument();
  });
});

describe("side panel", () => {
  const panel = (n: PlannerNode) => {
    server.use(http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)));
    renderWithClient(
      <ServerContext value={serversSingle.servers[0]}>
        <GroupPanel id="p" node={n} findings={undefined} onClose={() => {}} />
      </ServerContext>,
    );
    return screen.getByRole("region", { name: /^About / });
  };

  it("an extractor lists its inferred resource and no recipe line", () => {
    const about = panel(miner);
    expect(within(within(about).getByRole("list", { name: "Outputs" })).getByText("Iron Ore (inferred from the node)")).toBeInTheDocument();
    expect(within(about).queryByText(/Recipe/)).toBeNull();
  });

  it("a machine with no recipe reads Not configured", () => {
    const about = panel(unassigned);
    expect(within(about).getByText("Not configured")).toBeInTheDocument();
    expect(within(about).queryByText("No recipe")).toBeNull();
  });
});
