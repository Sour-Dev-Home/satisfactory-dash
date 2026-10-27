import { beforeEach, describe, expect, it } from "vitest";
import type { PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import { edgeKeyOf } from "./bubbleRow";
import { siteScene } from "./canvasScene";
import { FOCUS_CARD_H, FOCUS_CARD_W, clearLayoutMemo, layoutScene, layoutStats, type LaidEdge, type SiteLayout } from "./layoutSite";

beforeEach(clearLayoutMemo);

const rate = { className: "Desc_X_C", name: "X", unit: "items/min" as const, currentPerMinute: 1, maxPerMinute: 2 };

/**
 * A synthetic site the size of the measured one (ADR-0055: the "Versatile Framework site", 160 groups and 204 edges; its
 * data is the owner's save and is not committed): groups in layers of `width`, each fed by the one a layer before, every
 * third also by a neighbour of that one, and a few returns.
 */
function measuredSizeSite(groups = 160, width = 10, wanted = 204): ProductionGraph {
  const nodes: PlannerNode[] = Array.from({ length: groups }, (_, i) => ({
    key: `n${i}`,
    kind: "machines",
    className: "Build_ConstructorMk1_C",
    name: "Constructor",
    recipe: `Recipe ${i}`,
    count: 1 + (i % 9),
    machineIds: [`m${i}`],
    stateCounts: { producing: 1 },
    products: [rate],
    ingredients: [],
    at: { x: i, y: i },
    siteKey: "s",
    loop: false,
    treeKey: `tree|${i}`,
    collapseUnder: null,
  }));
  const edges: ProductionGraph["edges"] = [];
  const edge = (from: number, to: number, item: number) =>
    edges.push({ from: `n${from}`, to: `n${to}`, kind: "belt", itemClassName: `Desc_${item}_C`, itemName: `Item ${item}`, ratePerMinute: 30, rate: "measured", mixed: false, capacityPerMinute: null, conveyorCount: 1, flow: "supply" });
  for (let i = width; i < groups; i++) edge(i - width, i, i % 12);
  for (let i = width; i < groups && edges.length < wanted - 4; i += 3) edge(i - width + (i % width === width - 1 ? -1 : 1), i, (i + 5) % 12);
  for (let r = 0; edges.length < wanted; r++) edge(groups - 1 - r * width, r, 20 + r);
  const site = { key: "s", name: "Measured-size site", at: { x: 0, y: 0 }, machineCount: 385, stateCounts: {}, topOutputs: [], nodeKeys: nodes.map((x) => x.key) };
  return { nodes, edges, sites: [site], unconnectedMachineIds: [], beltData: "present", connectionsRefreshMinutes: 10, notes: [], factories: [], transports: [], topologyHash: "measured-size" };
}

const graph = measuredSizeSite();
const scene = siteScene(graph.sites[0], graph);
type Rect = { x: number; y: number; width: number; height: number };
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const reserved = (e: LaidEdge): Rect => ({ x: e.labelX - FOCUS_CARD_W / 2, y: e.labelY - FOCUS_CARD_H / 2, width: FOCUS_CARD_W, height: FOCUS_CARD_H });
const focusOn = (e: LaidEdge) => ({ edgeKey: edgeKeyOf(e.flow), width: FOCUS_CARD_W, height: FOCUS_CARD_H });
/** A line in the middle of the site, so the room is made among neighbours on every side. */
const middle = (l: SiteLayout) => [...l.edges].sort((a, b) => Math.hypot(a.labelX - l.width / 2, a.labelY - l.height / 2) - Math.hypot(b.labelX - l.width / 2, b.labelY - l.height / 2))[0];

describe("make room (ADR-0060 build PR 4)", () => {
  it("is the measured site's size", () => {
    expect(graph.nodes).toHaveLength(160);
    expect(graph.edges).toHaveLength(204);
  });

  it("reserves the detail card's box for the focused line: no card in it, the pill still drawn at its own size", () => {
    const overview = layoutScene(scene, graph.topologyHash);
    const target = middle(overview);
    const focused = layoutScene(scene, graph.topologyHash, focusOn(target));
    const e = focused.edges.find((x) => edgeKeyOf(x.flow) === edgeKeyOf(target.flow))!;
    expect(e.labelWidth).toBe(target.labelWidth);
    expect(e.labelHeight).toBe(target.labelHeight);
    const box = reserved(e);
    for (const n of focused.nodes) expect(overlap(box, n), `card ${n.key} in the room`).toBe(false);
    // The overview had cards there to move: the focused layout is a real re-layout, not the same picture.
    expect(overview.nodes.some((n) => overlap(box, n)) || focused.width !== overview.width || focused.height !== overview.height).toBe(true);
  });

  it("remembers both layouts: closing focus returns to the overview with no new dagre run", () => {
    const overview = layoutScene(scene, graph.topologyHash);
    const target = middle(overview);
    layoutScene(scene, graph.topologyHash, focusOn(target));
    const runs = layoutStats().computed;
    const again = layoutScene(scene, graph.topologyHash);
    expect(layoutStats().computed).toBe(runs);
    expect(again.nodes.map((n) => [n.x, n.y])).toEqual(overview.nodes.map((n) => [n.x, n.y]));
    expect(again.placeMs).toBe(overview.placeMs);
  });

  it("measures the focused layout of the measured-size site (the number recorded in ADR-0060 Decision 3)", () => {
    const overview = layoutScene(scene, graph.topologyHash);
    const target = middle(overview);
    const focused = layoutScene(scene, graph.topologyHash, focusOn(target));
    // Logged for the ADR; the budget check is the guard's job, so this only fails on a gross regression.
    console.info(`[ADR-0060 benchmark] overview ${overview.placeMs.toFixed(1)} ms, focused ${focused.placeMs.toFixed(1)} ms (160 groups, 204 edges)`);
    expect(focused.placeMs).toBeGreaterThan(0);
    expect(focused.placeMs).toBeLessThan(5_000);
    expect(layoutStats().routerFailures).toBe(0);
  });
});
