import { describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { AUTO_KEY, P, T, designated, treeId, treeWorld, wideTreeWorld } from "../../test/plannerTree";
import { buildFactoryTree, ownKeyOf } from "../factoryTree";
import { EXPAND_MAX_CARDS, EXPAND_MAX_DEPTH, expandAllKeys, overviewScene, sceneSummary, type Scene } from "./canvasScene";

// ADR-0061 Decision 5, build PR 4: a card blown up in place into a frame of its parts, on the overview.

const { graph, designations } = treeWorld();
const tree = buildFactoryTree(graph, designations);
const top = (expanded?: ReadonlySet<string>) => overviewScene(graph, [], [], tree, expanded);
const MAIN = designated(T);
const SMELTERS = designated(P);
const pairs = (s: Scene) => s.flows.map((f) => `${f.from} > ${f.to}`).sort();

describe("blowing up a card on the overview", () => {
  it("offers nothing without `expanded` (the flag off): the scene is the level's cards, as before", () => {
    const scene = top();
    expect(scene.cards.map((c) => c.key)).toEqual([MAIN, AUTO_KEY]);
    expect(scene.cards.every((c) => c.blowUp === undefined)).toBe(true);
    expect(scene.frames).toEqual([]);
  });

  it("offers a parent its child factories and a factory its groups, with the count", () => {
    const scene = top(new Set());
    expect(scene.cards.map((c) => [c.key, c.blowUp])).toEqual([
      [MAIN, { parts: 1, noun: "factories", fits: true }],
      [AUTO_KEY, { parts: 1, noun: "groups", fits: true }],
    ]);
    expect(scene.frames).toEqual([]);
  });

  it("replaces a blown-up parent by a frame of its children, and the flows re-aggregate at them", () => {
    const scene = top(new Set([MAIN]));
    expect(scene.frames).toEqual([
      { key: `frame|${MAIN}`, bubbleKey: MAIN, expands: MAIN, title: "Main base", cardKeys: [SMELTERS], description: "Main base, blown up into 1 factory" },
    ]);
    expect(scene.cards.map((c) => [c.key, c.frame])).toEqual([
      [SMELTERS, `frame|${MAIN}`],
      [AUTO_KEY, undefined],
    ]);
    // Smelters' Rods feed Screws, outside: the line now leaves the part, not the closed parent.
    expect(pairs(scene)).toEqual([`${SMELTERS} > ${AUTO_KEY}`]);
    expect(scene.cards[0].description).toMatch(/In Main base$/);
    expect(scene.noun).toBe("factories");
  });

  it("nests a second blow-up inside the first, two frames deep, and offers no third", () => {
    const scene = top(new Set([MAIN, SMELTERS, designated(treeId(3))]));
    expect(scene.frames.map((f) => [f.key, f.parent])).toEqual([
      [`frame|${MAIN}`, undefined],
      [`frame|${SMELTERS}`, `frame|${MAIN}`],
    ]);
    const inner = scene.frames[1];
    expect(inner.cardKeys).toEqual([ownKeyOf(SMELTERS), designated(treeId(3)), designated(treeId(4))]);
    expect(inner.description).toBe("Smelters, blown up into 3 factories. In Main base");
    // The cards inside the second frame cannot blow up again (EXPAND_MAX_DEPTH), even when asked: Plates stays a card.
    expect(EXPAND_MAX_DEPTH).toBe(2);
    for (const k of inner.cardKeys) expect(scene.cards.find((c) => c.key === k)?.blowUp).toBeUndefined();
    expect(scene.cards.find((c) => c.key === designated(treeId(3)))?.kind).toBe("factory");
    // The flows inside Smelters now run between its parts, and out of Rods to Screws.
    expect(pairs(scene)).toEqual(
      [`${designated(treeId(4))} > ${AUTO_KEY}`, `${ownKeyOf(SMELTERS)} > ${designated(treeId(3))}`, `${ownKeyOf(SMELTERS)} > ${designated(treeId(4))}`].sort(),
    );
  });

  it("blows up a factory into its groups, each a group card, and lines join them", () => {
    const scene = top(new Set([AUTO_KEY]));
    expect(scene.frames.map((f) => [f.key, f.cardKeys, f.description])).toEqual([[`frame|${AUTO_KEY}`, ["n4"], "Screws, blown up into 1 group"]]);
    const group = scene.cards.find((c) => c.key === "n4");
    expect(group?.kind).toBe("group");
    expect(group?.machines).toBeUndefined();
    expect(pairs(scene)).toEqual([`${MAIN} > n4`]);
    expect(scene.noun).toBe("card");
  });

  it("keeps a key for a card that is not on the level harmless, and the expanded set is never changed", () => {
    const asked = new Set(["nothing", SMELTERS]);
    const scene = top(asked);
    // Smelters is inside Main base, which is closed: nothing opens.
    expect(scene.frames).toEqual([]);
    expect([...asked]).toEqual(["nothing", SMELTERS]);
  });

  it("names the blow-ups in the canvas's accessible label", () => {
    expect(sceneSummary(top(new Set([MAIN, SMELTERS])), 0)).toBe(
      "Graph of Factories: 4 factories, 3 connections. Blown up in place: Main base, Smelters. The Tables view lists this level's factories.",
    );
    expect(sceneSummary(top(new Set()), 0)).toBe("Graph of Factories: 2 factories, 1 connection. The Tables view lists the same.");
  });

  it("offers a plain factory of the shared fixture its groups (the e2e case: Iron Rod factory, 2 groups)", () => {
    const fixture = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
    const flat = buildFactoryTree(fixture, undefined);
    const scene = overviewScene(fixture, [], [], flat, new Set());
    const rod = scene.cards.find((c) => c.label === "Iron Rod factory");
    expect(rod?.blowUp).toEqual({ parts: 2, noun: "groups", fits: true });
    const blown = overviewScene(fixture, [], [], flat, new Set([rod!.key]));
    expect(blown.frames[0].cardKeys).toHaveLength(2);
    // Every group is drawn once, and the flow from the plate factory ends on one of the rod factory's groups.
    expect(new Set(blown.cards.flatMap((c) => c.nodeKeys)).size).toBe(blown.cards.flatMap((c) => c.nodeKeys).length);
    expect(blown.flows.every((f) => blown.cards.some((c) => c.key === f.from) && blown.cards.some((c) => c.key === f.to))).toBe(true);
  });

  it("works on a nested level too (the path), blowing up a child", () => {
    const scene = overviewScene(graph, [], [MAIN, SMELTERS], tree, new Set([designated(treeId(3))]));
    expect(scene.name).toBe("Factories in Smelters");
    expect(scene.frames.map((f) => f.cardKeys)).toEqual([["n2"]]);
    expect(pairs(scene)).toEqual([`${ownKeyOf(SMELTERS)} > n2`, `${ownKeyOf(SMELTERS)} > ${designated(treeId(4))}`].sort());
  });
});

const wide = (parents: number, leaves: number, groups: number) => {
  const w = wideTreeWorld(parents, leaves, groups);
  return { ...w, tree: buildFactoryTree(w.graph, w.designations) };
};

describe("the cap (EXPAND_MAX_CARDS)", () => {
  it("does not offer a blow-up that would pass the cap, and the scene refuses it even when asked", () => {
    // One parent of two factories of 35 groups each: blowing up one fits (2 - 1 + 35 = 36), then the other does not (70).
    expect(EXPAND_MAX_CARDS).toBe(60);
    const w = wide(1, 2, 35);
    const area = w.tree.rootKeys[0];
    const [a, b] = w.tree.nodes.get(area)!.childKeys;
    const opened = overviewScene(w.graph, [], [], w.tree, new Set([area]));
    expect(opened.cards.map((c) => c.blowUp)).toEqual([
      { parts: 35, noun: "groups", fits: true },
      { parts: 35, noun: "groups", fits: true },
    ]);
    const one = overviewScene(w.graph, [], [], w.tree, new Set([area, a]));
    expect(one.cards).toHaveLength(36);
    expect(one.cards.find((c) => c.key === b)?.blowUp).toEqual({ parts: 35, noun: "groups", fits: false });
    // Exactly at the cap is allowed: with one factory of 30 open (31 cards), the other makes 31 - 1 + 30 = 60.
    const c = wide(1, 2, 30);
    const [ca, cb] = c.tree.nodes.get(c.tree.rootKeys[0])!.childKeys;
    const at = overviewScene(c.graph, [], [], c.tree, new Set([c.tree.rootKeys[0], ca]));
    expect(at.cards.find((x) => x.key === cb)?.blowUp).toEqual({ parts: 30, noun: "groups", fits: true });
    const full = overviewScene(c.graph, [], [], c.tree, new Set([c.tree.rootKeys[0], ca, cb]));
    expect(full.cards).toHaveLength(EXPAND_MAX_CARDS);
    expect(full.frames).toHaveLength(3);
    // Asked for both (a stale session entry, say): the first in order opens, the second stays a card.
    const both = overviewScene(w.graph, [], [], w.tree, new Set([area, a, b]));
    expect(both.cards.length).toBeLessThanOrEqual(EXPAND_MAX_CARDS);
    expect(both.frames.map((f) => f.expands)).toEqual([area, a]);
  });

  it("Expand all opens what fits, the level first and then the parts, and stays within the cap", () => {
    const w = wide(4, 4, 10);
    const keys = expandAllKeys(w.graph, [], [], w.tree, new Set());
    const scene = overviewScene(w.graph, [], [], w.tree, keys);
    // 4 areas, then 4 lines each (16 cards), then lines of 10 groups while they fit: 16 + 9k <= 60, so 4 lines.
    expect(scene.frames.filter((f) => f.parent === undefined)).toHaveLength(4);
    expect(scene.frames.filter((f) => f.parent !== undefined)).toHaveLength(4);
    expect(scene.cards).toHaveLength(16 + 9 * 4);
    expect(scene.cards.length).toBeLessThanOrEqual(EXPAND_MAX_CARDS);
    // What is left closed says it would not fit.
    expect(scene.cards.filter((c) => c.blowUp !== undefined).every((c) => c.blowUp!.fits === false)).toBe(true);
  });
});
