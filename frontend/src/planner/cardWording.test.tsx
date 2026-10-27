import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints, type PlannerEdge, type PlannerNode } from "@satisfactory-dash/shared";
import { factoryMixed, productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { PlannerView } from "./PlannerView";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { groupCard } from "./graph/canvasScene";
import { extractorOutput, groupsExtractorOutput, minedRates, nodeFacts, nodeSummary } from "./graph/graphModel";
import { GroupPanel } from "./graph/GroupPanel";
import { GroupsTable } from "./PlannerTables";

// Issue #728 Phase 1, steps 1 and 3: an extractor says what it mines (inferred from the node) and the rate its links carry,
// or "rate not read" (getFactory lists no extractor), and a machine with no recipe says "Not configured". The card, the
// tooltip, the side panel and the Tables view say the same.

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
  it("an extractor's line is its inferred resource, 'rate not read' without a rate on its links, and no 'No output data'", () => {
    expect(nodeSummary(miner)).toBe("Iron Ore · rate not read");
    expect(extractorOutput(miner)).toEqual({ name: "Iron Ore", inferred: true, rate: null });
    expect(nodeFacts(miner).outputs).toEqual(["Iron Ore: rate not read (inferred from the node)"]);
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
    expect(card.lines).toEqual(["Iron Ore · rate not read", "(inferred from the node)"]);
    expect(card.mutedFrom).toBe(1);
    expect(card.description).toContain("Iron Ore: rate not read (inferred from the node)");
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
    expect(within(minerRow).getByText("Iron Ore: rate not read")).toBeInTheDocument();
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
    expect(within(bubbleRow).getByText("Iron Ore: rate not read")).toBeInTheDocument();
    expect(within(bubbleRow).getByText("(inferred from the node)")).toHaveClass("text-muted");
    expect(screen.queryByText("No output data")).toBeNull();
  });

  it("a building of unknown kind with no recipe says Not known, not Not applicable", () => {
    render(<GroupsTable nodes={[node({ key: "o", kind: "other", className: "X", name: "Mystery", resource: null })]} findings={undefined} />);
    expect(within(rowOf("Mystery")).getByText("Not known")).toBeInTheDocument();
  });
});

describe("canvas", () => {
  it("draws the extractor's resource, the rate its belt carries and a muted inference note on its card", async () => {
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
    // The fixture's miner feeds the smelters one belt measured at 120 items/min.
    expect([...svg.querySelectorAll("text")].some((t) => t.textContent === "Iron Ore · 120 items/min")).toBe(true);
    expect(screen.getByRole("button", { name: /Miner Mk\.2.*Iron Ore: 120 items\/min \(inferred from the node\)/ })).toBeInTheDocument();
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
    expect(within(within(about).getByRole("list", { name: "Outputs" })).getByText("Iron Ore: rate not read (inferred from the node)")).toBeInTheDocument();
    expect(within(about).queryByText(/Recipe/)).toBeNull();
  });

  it("a machine with no recipe reads Not configured", () => {
    const about = panel(unassigned);
    expect(within(about).getByText("Not configured")).toBeInTheDocument();
    expect(within(about).queryByText("No recipe")).toBeNull();
  });
});

describe("extractor rates from their links", () => {
  const link = (from: string, kind: PlannerEdge["kind"], ratePerMinute: number | null, rate: PlannerEdge["rate"] = "measured"): PlannerEdge => ({
    from,
    to: "dest",
    kind,
    itemClassName: null,
    itemName: null,
    ratePerMinute,
    rate: ratePerMinute === null ? "unknown" : rate,
    mixed: false,
    capacityPerMinute: null,
    conveyorCount: 1,
  });
  const WATER = { className: "Desc_Water_C", name: "Water" };
  const pump = node({ key: "w", className: "Build_WaterPump_C", name: "Water Extractor", resource: WATER });

  it("a water extractor's card shows the pipes' summed rate in m³/min; the words say 'about' for an estimate", () => {
    const rates = minedRates([link("w", "pipe", 120), link("w", "pipe", 60, "estimated")]);
    expect(rates.get("w")).toEqual({ perMinute: 180, unit: "m3/min", measured: false });
    expect(groupCard(pump, [], rates).lines).toEqual(["Water · 180 m³/min", "(inferred from the node)"]);
    expect(nodeFacts(pump, rates).outputs).toEqual(["Water: about 180 m³/min (inferred from the node)"]);
  });

  it("a miner's belt rate is in items/min, the name giving way to the rate on a narrow card", () => {
    const rates = minedRates([link("k", "belt", 120)]);
    expect(nodeSummary(miner, rates)).toBe("Iron Ore · 120 items/min");
    const caterium = node({ resource: { className: "Desc_OreGold_C", name: "Caterium Ore" } });
    expect(nodeSummary(caterium, minedRates([link("k", "belt", 1234.5)]))).toBe("Cater… · 1,234.5 items/min");
    expect(nodeFacts(miner, rates).outputs).toEqual(["Iron Ore: 120 items/min (inferred from the node)"]);
  });

  it("one link without a number, or belts and pipes together, leaves the rate unknown: 'rate not read', never a partial sum", () => {
    expect(minedRates([link("k", "belt", 120), link("k", "belt", null)]).get("k")).toBeNull();
    expect(minedRates([link("k", "belt", null), link("k", "belt", 120)]).get("k")).toBeNull();
    expect(minedRates([link("k", "belt", 120), link("k", "pipe", 10)]).get("k")).toBeNull();
    expect(nodeSummary(miner, minedRates([link("k", "belt", null)]))).toBe("Iron Ore · rate not read");
    // An unidentified resource with no rate keeps its honest words alone.
    expect(nodeSummary(unknownMiner, minedRates([link("u", "belt", null)]))).toBe("Resource not identified");
  });

  it("a bubble of extractors sums its groups' rates, and only when every group has one", () => {
    const twin = node({ key: "k2", resource: IRON });
    expect(groupsExtractorOutput([miner, twin], minedRates([link("k", "belt", 60), link("k2", "belt", 30)]))?.rate).toEqual({
      perMinute: 90,
      unit: "items/min",
      measured: true,
    });
    expect(groupsExtractorOutput([miner, twin], minedRates([link("k", "belt", 60)]))?.rate).toBeNull();
  });
});

describe("edge cases (hunt)", () => {
  it("a whitespace-only recipe on a machine reads Not configured; padded names are trimmed so extractors still agree", () => {
    expect(nodeFacts({ ...unassigned, recipe: "   " }).recipe).toBe("Not configured");
    expect(extractorOutput(node({ resource: { className: "Desc_OreIron_C", name: " Iron Ore " } }))).toEqual({ name: "Iron Ore", inferred: true, rate: null });
    expect(extractorOutput(node({ resource: { className: "  ", name: "  " } }))).toEqual({ name: "Resource not identified", inferred: false, rate: null });
  });
  it("extractors with mixed or partly missing resources claim no single resource", () => {
    const water = node({ resource: { className: "Desc_Water_C", name: "Water" } });
    expect(groupsExtractorOutput([miner, water])).toBeNull();
    expect(groupsExtractorOutput([miner, unknownMiner])).toBeNull();
    expect(groupsExtractorOutput([miner, unassigned])).toBeNull();
    expect(groupsExtractorOutput([])).toBeNull();
  });
});
