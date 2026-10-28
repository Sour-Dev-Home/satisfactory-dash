import { describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type PlannerNode, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphTwoSites } from "@satisfactory-dash/shared/fixtures";
import { bundleFlows, flowTitle, siteScene, stalledSourceText, type CanvasFlow } from "./canvasScene";

// ADR-0062 build PR 2: `stalled` on cards and flows, from the source group's state counts (`stalledOf`).
const DATA = ProductionGraphResponseSchema.parse(productionGraphTwoSites).data;
const SMELTER = "Build_SmelterMk1_C|Iron Ingot|1200|-400";
const PLATES = "Build_ConstructorMk1_C|Iron Plate|1250|-400";

/** The iron site with the smelters' state and product rate replaced. */
function sceneWith(stateCounts: Record<string, number>, current = 0, edgeRate?: { ratePerMinute: number | null; rate: "measured" | "estimated" | "unknown" }) {
  const graph: ProductionGraph = {
    ...DATA,
    nodes: DATA.nodes.map((n): PlannerNode => (n.key === SMELTER ? { ...n, stateCounts, products: [{ ...n.products[0], currentPerMinute: current }] } : n)),
    edges: DATA.edges.map((e) => (e.from === SMELTER && edgeRate !== undefined ? { ...e, ...edgeRate } : e)),
  };
  return siteScene(DATA.sites[0], graph);
}
const smelterCard = (scene: ReturnType<typeof sceneWith>) => scene.cards.find((c) => c.key === SMELTER)!;
const smelterFlow = (scene: ReturnType<typeof sceneWith>) => scene.flows.find((f) => f.from === SMELTER)!;

describe("stalled cards and flows", () => {
  it.each([
    ["backedUp", "Backed up"],
    ["underfed", "Underfed"],
    ["paused", "Paused"],
    ["idle", "Idle"],
  ] as const)("marks a group whose machines are all %s, keeping the word as its muted note", (state, word) => {
    const scene = sceneWith({ [state]: 4 });
    const card = smelterCard(scene);
    expect(card.stalled).toBe(state);
    expect(card.lines[card.mutedFrom!]).toBe(word);
    expect(card.description).toContain(`· ${word.toLowerCase()}`);
    expect(smelterFlow(scene).stalled).toBe(state);
  });

  it("has no mark where the words have none: mixed states, unpowered, an unknown state", () => {
    for (const counts of [{ backedUp: 2, underfed: 2 }, { unpowered: 4 }, { someNewState: 4 }]) {
      const scene = sceneWith(counts);
      const card = smelterCard(scene);
      expect(card.stalled).toBeUndefined();
      expect(card.mutedFrom).toBeDefined(); // the word is still drawn
      expect(smelterFlow(scene).stalled).toBeUndefined();
    }
  });

  it("has no mark while the product reads above 0, whatever the state counts say", () => {
    const scene = sceneWith({ backedUp: 4 }, 30);
    expect(smelterCard(scene).stalled).toBeUndefined();
    expect(smelterCard(scene).mutedFrom).toBeUndefined();
    expect(smelterFlow(scene).stalled).toBeUndefined();
  });

  it("leaves a line the game measured moving unstalled, and stalls a measured 0, an estimate and an unknown", () => {
    expect(smelterFlow(sceneWith({ backedUp: 4 }, 0, { ratePerMinute: 30, rate: "measured" })).stalled).toBeUndefined();
    expect(smelterFlow(sceneWith({ backedUp: 4 }, 0, { ratePerMinute: 0, rate: "measured" })).stalled).toBe("backedUp");
    expect(smelterFlow(sceneWith({ backedUp: 4 }, 0, { ratePerMinute: 102, rate: "estimated" })).stalled).toBe("backedUp");
    expect(smelterFlow(sceneWith({ backedUp: 4 }, 0, { ratePerMinute: null, rate: "unknown" })).stalled).toBe("backedUp");
  });

  it("stalls only the lines that leave the stalled card", () => {
    const scene = sceneWith({ backedUp: 4 });
    expect(scene.flows.filter((f) => f.stalled !== undefined).map((f) => [f.from, f.to])).toEqual([[SMELTER, PLATES]]);
  });

  it("says the state in the line's title, so the stop bar is never the only carrier", () => {
    const flow = smelterFlow(sceneWith({ backedUp: 4 }));
    expect(flowTitle(flow, "4× Smelter", "8× Constructor")).toContain("The source is backed up");
    expect(stalledSourceText("paused")).toBe("The source is paused");
    expect(flowTitle(smelterFlow(sceneWith({ producing: 4 }, 120)), "a", "b")).not.toContain("The source is");
  });
});

describe("a bundle's stalled state", () => {
  const link = (over: Partial<CanvasFlow>): CanvasFlow => ({
    from: "a",
    to: "b",
    itemClassName: "Desc_IronIngot_C",
    itemName: "Iron Ingot",
    carrier: "belt",
    flow: "supply",
    mixed: false,
    rate: "estimated",
    label: "Iron Ingot",
    labelLines: ["Iron Ingot"],
    ratePerMinute: 10,
    unit: "items/min",
    quality: "estimated",
    ...over,
  });

  it("is stalled when every part is, and not when one part was measured moving", () => {
    const both = bundleFlows([link({ stalled: "backedUp" }), link({ itemName: "Iron Plate", itemClassName: "Desc_IronPlate_C", stalled: "backedUp" })]);
    expect(both).toHaveLength(1);
    expect(both[0].flow.stalled).toBe("backedUp");
    const one = bundleFlows([link({ stalled: "backedUp" }), link({ itemName: "Iron Plate", itemClassName: "Desc_IronPlate_C", rate: "measured", quality: "measured" })]);
    expect(one[0].flow.stalled).toBeUndefined();
  });
});
