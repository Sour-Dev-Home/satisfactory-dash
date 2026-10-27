import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { endpoints, ProductionGraphResponseSchema, type PlannerNode, type PlannerRate } from "@satisfactory-dash/shared";
import { factoryMixed, productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { flowTitle, groupCard, type CanvasFlow } from "./graph/canvasScene";
import { nodeFacts, nodeSummary, productSummary } from "./graph/graphModel";
import { GroupPanel } from "./graph/GroupPanel";
import { PlannerPanel } from "./PlannerPanel";
import { GroupsTable } from "./PlannerTables";
import { PlannerView } from "./PlannerView";
import { mergeStateCounts, outputLine, stalledStateText, UNKNOWN_FLOW_NOTE } from "./plannerText";

// Issue #728 Phase 1, steps 2 and 5. Step 2: FRM's CurrentProd is instantaneous and drops to 0 while an input is
// missing (frm-getFactory.md E3), so a 0 reads "0 of <max>" with the machine's state, never a bare "0/min". Step 5: one
// plain line says why an item or a rate can be unknown. The card, the tooltip, the side panel and the Tables view agree.

const ingot = (current: number, max: number, unit: PlannerRate["unit"] = "items/min"): PlannerRate => ({
  className: "Desc_IronIngot_C",
  name: "Iron Ingot",
  unit,
  currentPerMinute: current,
  maxPerMinute: max,
});
const smelter = (over: Partial<PlannerNode> = {}): PlannerNode => ({
  key: "sm",
  kind: "machines",
  className: "Build_SmelterMk1_C",
  name: "Smelter",
  recipe: "Iron Ingot",
  count: 2,
  machineIds: ["s1", "s2"],
  stateCounts: { backedUp: 2 },
  products: [ingot(0, 60)],
  ingredients: [],
  at: { x: 0, y: 0 },
  siteKey: "s",
  loop: false,
  ...over,
});

describe("the state of a group whose rate reads 0", () => {
  it("names the one state every machine is in, else 'not producing'", () => {
    expect(stalledStateText({ backedUp: 3 })).toBe("backed up");
    expect(stalledStateText({ underfed: 2, producing: 0 })).toBe("underfed");
    expect(stalledStateText({ paused: 1 })).toBe("paused");
    expect(stalledStateText({})).toBe("not producing");
    expect(stalledStateText({ producing: 2 })).toBe("not producing");
    expect(stalledStateText({ underfed: 1, backedUp: 1 })).toBe("not producing");
    expect(stalledStateText({ backedUp: 1, producing: 1 })).toBe("not producing");
  });

  it("keeps a state this build does not know as the backend's own word", () => {
    expect(stalledStateText({ jammed: 2 })).toBe("jammed");
  });

  it("sums the states of several groups", () => {
    expect(stalledStateText(mergeStateCounts([{ paused: 1 }, { paused: 2 }]))).toBe("paused");
    expect(stalledStateText(mergeStateCounts([{ paused: 1 }, { idle: 2 }]))).toBe("not producing");
  });
});

describe("rate words", () => {
  it("a 0 reads '0 of max' with the state; a running rate is unchanged", () => {
    expect(outputLine(ingot(0, 30), {})).toBe("Iron Ingot: 0 of 30 items/min · not producing");
    expect(outputLine(ingot(0, 30), { backedUp: 4 })).toBe("Iron Ingot: 0 of 30 items/min · backed up");
    expect(outputLine(ingot(0.04, 30), { paused: 1 })).toBe("Iron Ingot: 0 of 30 items/min · paused");
    expect(outputLine(ingot(72, 160), { producing: 2 })).toBe("Iron Ingot: 72 / 160 items/min");
  });

  it("with no max says '0' and the state, and with no states says no state", () => {
    expect(outputLine(ingot(0, 0), {})).toBe("Iron Ingot: 0 items/min · not producing");
    expect(outputLine(ingot(0, 30))).toBe("Iron Ingot: 0 of 30 items/min");
    expect(outputLine(ingot(0, 30, null), {})).toBe("Iron Ingot: 0 of 30 per min · not producing");
  });

  it("the card's line says '0 of max' too, fluids in m³", () => {
    expect(productSummary(ingot(0, 30))).toBe("Iron Ingot · 0 of 30/min");
    expect(productSummary({ ...ingot(0, 120, "m3/min"), name: "Water" })).toBe("Water · 0 of 120 m³/min");
    expect(productSummary(ingot(0, 0))).toBe("Iron Ingot · 0/min");
    expect(productSummary(ingot(30, 30))).toBe("Iron Ingot · 30/min");
  });
});

describe("canvas card and tooltip", () => {
  it("a 0 card prints '0 of max' and the state as a muted line; the tooltip says the same", () => {
    const card = groupCard(smelter());
    expect(card.lines).toEqual(["Iron Ingot · 0 of 60/min", "Backed up"]);
    expect(card.mutedFrom).toBe(1);
    expect(card.description).toContain("Iron Ingot: 0 of 60 items/min · backed up");
    expect(nodeSummary(smelter())).toBe("Iron Ingot · 0 of 60/min");
    expect(nodeFacts(smelter()).outputs).toEqual(["Iron Ingot: 0 of 60 items/min · backed up"]);
  });

  it("a running card has one line and no state", () => {
    const card = groupCard(smelter({ products: [ingot(45, 60)], stateCounts: { producing: 2 } }));
    expect(card.lines).toEqual(["Iron Ingot · 45/min"]);
    expect(card.mutedFrom).toBeUndefined();
  });
});

describe("unknown items and rates say why", () => {
  const flow = (over: Partial<CanvasFlow> = {}): CanvasFlow => ({
    from: "a",
    to: "b",
    itemClassName: "Desc_IronIngot_C",
    itemName: "Iron Ingot",
    carrier: "belt",
    flow: "supply",
    mixed: false,
    rate: "measured",
    label: "Iron Ingot · 30 items/min",
    labelLines: ["Iron Ingot", "30 items/min"],
    routeName: undefined,
    ratePerMinute: 30,
    unit: "items/min",
    quality: "measured",
    ...over,
  });

  it("the sentence is plain and one line", () => {
    expect(UNKNOWN_FLOW_NOTE).toBe("The game doesn't report what's on a belt or how fast it moves; items and rates are inferred where possible.");
  });

  it("an edge tooltip adds it for an unknown item or rate, not for a known one", () => {
    expect(flowTitle(flow(), "A", "B")).not.toContain(UNKNOWN_FLOW_NOTE);
    expect(flowTitle(flow({ rate: "unknown", quality: "unknown", ratePerMinute: null }), "A", "B")).toContain(UNKNOWN_FLOW_NOTE);
    expect(flowTitle(flow({ itemName: null, itemClassName: null }), "A", "B")).toContain(UNKNOWN_FLOW_NOTE);
    const bundle = flow({ itemName: null, itemClassName: null, parts: [flow(), flow({ itemName: null, itemClassName: null })] });
    expect(flowTitle(bundle, "A", "B")).toContain(UNKNOWN_FLOW_NOTE);
    expect(flowTitle(flow({ itemName: null, itemClassName: null, parts: [flow(), flow({ itemName: "Iron Plate" })] }), "A", "B")).not.toContain(UNKNOWN_FLOW_NOTE);
  });
});

describe("Tables view (the text path)", () => {
  const rowOf = (name: string) => screen.getAllByRole("row").find((r) => within(r).queryByRole("rowheader", { name: new RegExp(`^${name}`) }) !== null)!;

  it("a group's output cell says '0 of max' and the state, like the card", () => {
    render(<GroupsTable nodes={[smelter()]} findings={undefined} />);
    expect(within(rowOf("Smelter")).getByText("Iron Ingot: 0 of 60 items/min · backed up")).toBeInTheDocument();
  });

  it("a bubble's row sums its groups' states", () => {
    render(<GroupsTable nodes={[smelter({ treeKey: "t" }), smelter({ key: "sm2", treeKey: "t", stateCounts: { backedUp: 1 } })]} findings={undefined} />);
    const bubbleRow = screen.getAllByRole("row").find((r) => r.querySelector("th[scope=rowgroup]") !== null)!;
    expect(within(bubbleRow).getByText("Iron Ingot: 0 of 120 items/min · backed up")).toBeInTheDocument();
  });

  it("explains unknowns under the connections when one is listed", () => {
    const parsed = ProductionGraphResponseSchema.parse(productionGraphTwoSites);
    render(
      <MemoryRouter>
        <PlannerPanel snapshot={parsed} selected={parsed.data.sites[0].key} onSelect={() => {}} />
      </MemoryRouter>,
    );
    const tablesButton = screen.queryByRole("button", { name: "Tables" });
    if (tablesButton !== null) fireEvent.click(tablesButton);
    const section = screen.getByRole("region", { name: "Connections" });
    expect(within(section).getByText(UNKNOWN_FLOW_NOTE)).toBeInTheDocument();
  });

  it("says nothing about unknowns when every connection is known", () => {
    const parsed = ProductionGraphResponseSchema.parse(productionGraphTwoSites);
    render(
      <MemoryRouter>
        <PlannerPanel snapshot={parsed} selected={parsed.data.sites[1].key} onSelect={() => {}} />
      </MemoryRouter>,
    );
    const tablesButton = screen.queryByRole("button", { name: "Tables" });
    if (tablesButton !== null) fireEvent.click(tablesButton);
    expect(screen.queryByText(UNKNOWN_FLOW_NOTE)).toBeNull();
  });
});

describe("side panel", () => {
  it("lists the output as '0 of max' and the state", () => {
    server.use(http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)));
    renderWithClient(
      <ServerContext value={serversSingle.servers[0]}>
        <GroupPanel id="p" node={smelter()} findings={undefined} onClose={() => {}} />
      </ServerContext>,
    );
    const about = screen.getByRole("region", { name: /^About / });
    expect(within(within(about).getByRole("list", { name: "Outputs" })).getByText("Iron Ingot: 0 of 60 items/min · backed up")).toBeInTheDocument();
  });
});

describe("canvas legend", () => {
  it("has one line on what 'Item unknown' and 'unknown' mean", async () => {
    server.use(http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)));
    renderWithClient(
      <MemoryRouter>
        <ServerContext value={serversSingle.servers[0]}>
          <PlannerView />
        </ServerContext>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
    fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
    const samples = await screen.findByRole("list", { name: "Line styles" }, { timeout: 3_000 });
    expect(within(samples.parentElement!).getByText(UNKNOWN_FLOW_NOTE)).toHaveClass("text-muted");
  });
});
