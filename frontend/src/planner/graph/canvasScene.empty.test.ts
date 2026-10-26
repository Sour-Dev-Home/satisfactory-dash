import { describe, expect, it } from "vitest";
import type { PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import { COLLAPSE_AT, EMPTY_VIEW, factoryScene, overviewScene, siteScene, type Card, type FactoryView, type Scene } from "./canvasScene";
import { GLYPH_KINDS, buildingIconUrl, glyphKindOf } from "./buildingIcons";
import { factoryModels } from "./hierarchy";
import { layoutScene } from "./layoutSite";

/**
 * The owner's complaint: "some are missing any info at all including picture, just edges going into empty node". Every
 * card a scene can hold, however odd the group behind it, has something to read and something to look at.
 */

const rate = { className: "Desc_X_C", name: "X", unit: "items/min" as const, currentPerMinute: 1, maxPerMinute: 2 };
const view = (extra: Partial<FactoryView> = {}): FactoryView => ({ ...EMPTY_VIEW, ...extra });

function node(key: string, extra: Partial<PlannerNode> = {}): PlannerNode {
  return {
    key,
    kind: "machines",
    className: "Build_ConstructorMk1_C",
    name: "Constructor",
    recipe: "Iron Plate",
    count: 1,
    machineIds: [`m-${key}`],
    stateCounts: { producing: 1 },
    products: [rate],
    ingredients: [],
    at: { x: 0, y: 0 },
    siteKey: "s",
    loop: false,
    factoryKey: "f",
    ...extra,
  };
}

function graphOf(nodes: PlannerNode[], factoryName = "F factory"): ProductionGraph {
  const keys = nodes.map((n) => n.key);
  const edges = keys.slice(1).map((to, i) => ({ from: keys[i], to, kind: "belt" as const, itemClassName: "Desc_X_C", itemName: "X", ratePerMinute: 60, rate: "measured" as const, mixed: false, capacityPerMinute: null, conveyorCount: 1, flow: "supply" }));
  return {
    nodes,
    edges,
    sites: [{ key: "s", name: "Site", at: { x: 0, y: 0 }, machineCount: nodes.length, stateCounts: {}, topOutputs: [], nodeKeys: keys }],
    unconnectedMachineIds: [],
    beltData: "present",
    connectionsRefreshMinutes: 10,
    notes: [],
    factories: [{ key: "f", name: factoryName, designationId: null, products: [], sideProducts: [], nodeKeys: keys, siteKeys: ["s"], machineCount: nodes.length, sharedNodeCount: 0 }],
    transports: [],
    topologyHash: "h",
  } as ProductionGraph;
}

/** The odd groups: a blank name, a blank recipe, no products, an unknown class and kind, a name of only spaces. */
const ODD: Partial<PlannerNode>[] = [
  { name: "" },
  { name: "   ", recipe: "" },
  { recipe: "", products: [] },
  { className: "Build_Unheard_Of_C", kind: "somethingNew", recipe: null, products: [] },
  { className: "", name: "", kind: "", recipe: null, products: [] },
  { products: [{ ...rate, name: "" }] },
  { kind: "storage", role: "sink", className: "Build_Mystery_C", recipe: null, products: [] },
];

const visibleText = (c: Card): string[] => c.lines.filter((l) => l.trim() !== "");

function expectReadableAndSeen(card: Card) {
  expect(visibleText(card), `${card.kind} ${card.key} prints a line`).not.toHaveLength(0);
  expect(card.lines.every((l) => l.trim() !== ""), `${card.kind} ${card.key} has no blank line`).toBe(true);
  expect(card.label.trim(), `${card.kind} ${card.key} has a label`).not.toBe("");
  expect(card.description.trim(), `${card.kind} ${card.key} has a description`).not.toBe("");
  expect(card.title.trim(), `${card.kind} ${card.key} has a title`).not.toBe("");
  // A picture: the building's icon, or a glyph for its kind (the canvas draws one whenever there is no icon).
  const icon = card.className === undefined ? undefined : buildingIconUrl(card.className);
  expect(icon !== undefined || (GLYPH_KINDS as readonly string[]).includes(card.glyph), `${card.kind} ${card.key} has an icon or a glyph`).toBe(true);
}

function expectLaidOut(scene: Scene) {
  const laid = layoutScene(scene, "h");
  const keys = new Set(laid.nodes.map((n) => n.key));
  expect(keys.size).toBe(scene.cards.length);
  for (const n of laid.nodes) {
    for (const v of [n.x, n.y, n.width, n.height]) expect(Number.isFinite(v)).toBe(true);
    expect(n.width).toBeGreaterThan(0);
    expect(n.height).toBeGreaterThan(0);
  }
  // Every line ends on a card, and a frame always holds a card.
  for (const e of laid.edges) {
    expect(keys.has(e.flow.from) && keys.has(e.flow.to)).toBe(true);
    expect(e.points.length).toBeGreaterThanOrEqual(2);
  }
  for (const f of scene.frames) expect(f.cardKeys.length).toBeGreaterThan(0);
}

describe("no card is empty", () => {
  it.each(ODD.map((o, i) => [i, o] as const))("a group card from odd group %i has a line, a name, a description and a picture", (_i, odd) => {
    const nodes = [node("a", odd), node("b"), node("c", odd)];
    const g = graphOf(nodes);
    const scenes = [factoryScene(g, factoryModels(g)[0], view()), siteScene(g.sites[0], g), overviewScene(g, factoryModels(g))];
    for (const scene of scenes) {
      expect(scene.cards.length).toBeGreaterThan(0);
      for (const card of scene.cards) expectReadableAndSeen(card);
      expectLaidOut(scene);
    }
  });

  it.each(ODD.map((o, i) => [i, o] as const))("a bubble card from odd group %i is not empty either", (_i, odd) => {
    const g = graphOf([node("a", { ...odd, treeKey: "t" }), node("b", { ...odd, treeKey: "t" }), node("c", { treeKey: "u" })]);
    const scene = factoryScene(g, factoryModels(g)[0], view({ flipped: new Set(["t"]) }));
    expect(scene.cards.some((c) => c.kind === "bubble")).toBe(true);
    for (const card of scene.cards) expectReadableAndSeen(card);
    expectLaidOut(scene);
  });

  it("a fold card and a factory with no name are not empty", () => {
    const many = Array.from({ length: COLLAPSE_AT + 2 }, (_, i) => [node(`p${i}a`, { ...ODD[0], treeKey: `tree|${i}` }), node(`p${i}b`, { ...ODD[0], treeKey: `tree|${i}` })]).flat();
    const g = graphOf(many, "  ");
    const scene = factoryScene(g, factoryModels(g)[0], view({ flipped: new Set(many.map((n) => n.treeKey!)) }));
    expect(scene.cards.some((c) => c.kind === "fold")).toBe(true);
    for (const card of scene.cards) expectReadableAndSeen(card);
    expectLaidOut(scene);
    const overview = overviewScene(g, factoryModels(g));
    expect(overview.cards[0].label).toBe("Unnamed factory");
    expectReadableAndSeen(overview.cards[0]);
  });

  it("a group with no name is named by its class, then by 'Unknown building'", () => {
    const g = graphOf([node("a", { name: "", className: "Build_Foo_C" }), node("b", { name: "", className: "" })]);
    const [a, b] = factoryScene(g, factoryModels(g)[0], view()).cards;
    expect(a.label).toContain("Build_Foo_C");
    expect(b.label).toContain("Unknown building");
  });
});

describe("the glyph for a class with no icon", () => {
  it("is drawn for the kind of node, by role first, and 'unknown' for anything else", () => {
    expect(glyphKindOf({ kind: "machines" })).toBe("machines");
    expect(glyphKindOf({ kind: "extractor" })).toBe("extractor");
    expect(glyphKindOf({ kind: "storage" })).toBe("storage");
    expect(glyphKindOf({ kind: "station" })).toBe("station");
    expect(glyphKindOf({ kind: "consumer" })).toBe("consumer");
    expect(glyphKindOf({ kind: "storage", role: "sink" })).toBe("consumer");
    expect(glyphKindOf({ kind: "consumer", role: "power" })).toBe("power");
    expect(glyphKindOf({ kind: "storage", role: "depot" })).toBe("storage");
    expect(glyphKindOf({ kind: "storage", role: "export" })).toBe("station");
    expect(glyphKindOf({ kind: "other" })).toBe("unknown");
    expect(glyphKindOf({ kind: "" })).toBe("unknown");
    // Game-server strings are looked up as own keys only.
    expect(glyphKindOf({ kind: "__proto__", role: "constructor" })).toBe("unknown");
    expect(glyphKindOf({ kind: "toString" })).toBe("unknown");
  });
});
