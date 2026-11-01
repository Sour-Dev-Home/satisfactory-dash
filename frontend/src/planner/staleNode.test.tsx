import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints, type PlannerNode } from "@satisfactory-dash/shared";
import { factoryMixed, productionGraphStaleEnd, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { PlannerView } from "./PlannerView";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { groupCard, sceneFor, EMPTY_VIEW } from "./graph/canvasScene";
import { MAX_LINE_CHARS, MAX_WRAP_LINES, nodeFacts, STALE_NODE_NOTE } from "./graph/graphModel";
import { glyphKindOf } from "./graph/buildingIcons";
import { GroupPanel } from "./graph/GroupPanel";
import { GroupsTable } from "./PlannerTables";

// #728 cause 11: a node built only from conveyor ends that name machines the latest factory read lacks. The card says the
// conveyor data is older (muted), never an unknown "other" card; the tooltip, the side panel and the Tables view say the same.

const NOTE = "Conveyor data older than the factory read · refreshes within 10 minutes";
const node = (over: Partial<PlannerNode> = {}): PlannerNode => ({
  key: "machine||1|1",
  kind: "other",
  className: "machine",
  name: "machine",
  recipe: null,
  count: 1,
  machineIds: [],
  stateCounts: {},
  products: [],
  ingredients: [],
  at: { x: 1, y: 1 },
  siteKey: "s",
  loop: false,
  stale: true,
  ...over,
});
const stale = node();

describe("words for a stale node", () => {
  it("is the agreed sentence", () => {
    expect(STALE_NODE_NOTE).toBe(NOTE);
  });

  it("the card prints it muted, within the card's line limits, and wears the clock glyph, not the unknown one", () => {
    const card = groupCard(stale);
    expect(card.mutedFrom).toBe(0);
    expect(card.lines.length).toBeGreaterThan(0);
    expect(card.lines.length).toBeLessThanOrEqual(MAX_WRAP_LINES);
    for (const line of card.lines) expect(line.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
    expect(card.lines[0]).toBe("Conveyor data older");
    expect(card.lines).not.toContain("No output data");
    expect(card.glyph).toBe("stale");
    expect(card.description).toContain(NOTE);
    expect(card.description).not.toContain("No output data");
  });

  it("only a stale node gets it: an ordinary unknown node keeps its card", () => {
    const plain = node({ stale: undefined });
    expect(glyphKindOf(plain)).toBe("unknown");
    expect(groupCard(plain).lines).toEqual(["No output data"]);
    expect(nodeFacts(plain).outputs).toEqual(["No output data"]);
    expect(nodeFacts(stale).outputs).toEqual([NOTE]);
  });

  it("a bubble of stale nodes says it too, as does a factory whose only group is stale", () => {
    const graph = productionGraphStaleEnd.data;
    const twin = { ...node({ key: "machine||2|2", treeKey: "t" }), factoryKey: "f" };
    const g = {
      ...graph,
      nodes: [{ ...node({ treeKey: "t" }), factoryKey: "f" }, twin],
      edges: [],
      transports: [],
      factories: [{ ...graph.factories![0]!, key: "f", nodeKeys: ["machine||1|1", "machine||2|2"], products: [] }],
    };
    const opened = sceneFor(g, { factory: "f" }, { ...EMPTY_VIEW, flipped: new Set(["t"]) });
    const bubble = opened.cards.find((c) => c.kind === "bubble");
    expect(bubble?.glyph).toBe("stale");
    expect(bubble?.mutedFrom).toBe(0);
    expect(bubble?.lines[0]).toBe("Conveyor data older");
    expect(bubble?.description).toContain(NOTE);
    const overview = sceneFor(g, { factory: null }, EMPTY_VIEW);
    expect(overview.cards[0]?.glyph).toBe("stale");
  });
});

describe("Tables view (the text path)", () => {
  it("the Output cell says it, muted, instead of No output data", () => {
    render(<GroupsTable nodes={[stale]} findings={undefined} />);
    const row = screen.getAllByRole("row").find((r) => within(r).queryByRole("rowheader") !== null)!;
    expect(within(row).getByText(NOTE)).toHaveClass("text-muted");
    expect(within(row).queryByText("No output data")).toBeNull();
  });

  it("a bubble row of stale nodes says it once on the bubble row too", () => {
    render(<GroupsTable nodes={[node({ treeKey: "t" }), node({ key: "machine||2|2", treeKey: "t" })]} findings={undefined} />);
    const bubbleRow = screen.getAllByRole("row").find((r) => r.querySelector("th[scope=rowgroup]") !== null)!;
    expect(within(bubbleRow).getByText(NOTE)).toHaveClass("text-muted");
    expect(screen.queryByText("No output data")).toBeNull();
  });
});

describe("side panel", () => {
  it("lists it under Outputs", () => {
    server.use(http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)));
    renderWithClient(
      <ServerContext value={serversSingle.servers[0]}>
        <GroupPanel id="p" node={stale} findings={undefined} onClose={() => {}} />
      </ServerContext>,
    );
    const about = screen.getByRole("region", { name: /^About / });
    expect(within(within(about).getByRole("list", { name: "Outputs" })).getByText(NOTE)).toBeInTheDocument();
    expect(within(about).queryByText("No output data")).toBeNull();
  });
});

describe("canvas", () => {
  it("draws the stale card with a muted note and the clock glyph; its keyboard name says the whole sentence", async () => {
    server.use(
      http.get(endpoints.productionGraph.route, () => HttpResponse.json(productionGraphStaleEnd)),
      http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)),
    );
    renderWithClient(
      <MemoryRouter>
        <ServerContext value={serversSingle.servers[0]}>
          <PlannerView />
        </ServerContext>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open factory: Iron Rod factory" }));
    fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
    const svg = await screen.findByRole("img", { name: /^Graph of Iron Rod factory/ }, { timeout: 3_000 });
    const first = [...svg.querySelectorAll("text")].find((t) => t.textContent === "Conveyor data older")!;
    expect(first).toHaveClass("fill-muted");
    const card = first.closest("[data-card]")!;
    expect(card.querySelector("[data-building-glyph]")?.getAttribute("data-building-glyph")).toBe("stale");
    expect(card.querySelector("title")?.textContent).toContain(NOTE);
    expect(screen.getByRole("button", { name: new RegExp(NOTE) })).toBeInTheDocument();
  });
});
