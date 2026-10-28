import { beforeEach, describe, expect, it } from "vitest";
import { AUTO_KEY, P, T, designated, treeId, treeWorld, wideTreeWorld } from "../../test/plannerTree";
import { buildFactoryTree } from "../factoryTree";
import { EXPAND_MAX_CARDS, expandAllKeys, overviewScene } from "./canvasScene";
import { COLLAPSE_W, FRAME_HEADER_H, NODE_PAD_X, PILL_HIT, clearLayoutMemo, layoutScene, layoutStats, type LaidFrame, type LaidNode } from "./layoutSite";
import { marchHoles } from "./marching";

// ADR-0061 build PR 4: a blown-up card's frame on the overview, laid out as a dagre compound node (nested for a blow-up
// inside a blow-up), and the layout benchmark the ADR records.

beforeEach(() => clearLayoutMemo());

const { graph, designations } = treeWorld();
const tree = buildFactoryTree(graph, designations);
const MAIN = designated(T);
const SMELTERS = designated(P);

type Box = { x: number; y: number; width: number; height: number };
const inside = (inner: Box, outer: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

describe("a blown-up card's frame", () => {
  it("holds its parts, a nested frame inside its parent's with room for both header tabs", () => {
    const scene = overviewScene(graph, [], [], tree, new Set([MAIN, SMELTERS]));
    const layout = layoutScene(scene, graph.topologyHash);
    const frames = new Map<string, LaidFrame>(layout.frames.map((f) => [f.key, f]));
    const nodes = new Map<string, LaidNode>(layout.nodes.map((n) => [n.key, n]));
    expect([...frames.keys()]).toEqual([`frame|${MAIN}`, `frame|${SMELTERS}`]);
    const outer = frames.get(`frame|${MAIN}`)!;
    const inner = frames.get(`frame|${SMELTERS}`)!;
    expect(inner).toMatchObject({ expands: SMELTERS, parent: outer.key, description: "Smelters, blown up into 3 factories. In Main base" });
    // The inner frame, with the half of its tab that stands above its top edge, sits inside the outer one below its tab.
    expect(inside({ ...inner, y: inner.y - FRAME_HEADER_H / 2, height: inner.height + FRAME_HEADER_H / 2 }, outer)).toBe(true);
    expect(inner.y - FRAME_HEADER_H / 2).toBeGreaterThanOrEqual(outer.y + FRAME_HEADER_H / 2);
    for (const f of scene.frames) for (const k of f.cardKeys) expect(inside(nodes.get(k)!, frames.get(f.key)!), k).toBe(true);
    // A card outside the frames is outside them.
    const screws = nodes.get(AUTO_KEY)!;
    for (const f of layout.frames) expect(inside(screws, f)).toBe(false);
  });

  it("routes the lines to the parts inside, with every end on a drawn card", () => {
    const scene = overviewScene(graph, [], [], tree, new Set([MAIN, SMELTERS]));
    const layout = layoutScene(scene, graph.topologyHash);
    const keys = new Set(layout.nodes.map((n) => n.key));
    expect(layout.edges).toHaveLength(3);
    for (const e of layout.edges) {
      expect(keys.has(e.flow.from) && keys.has(e.flow.to)).toBe(true);
      expect(e.points.length).toBeGreaterThanOrEqual(2);
      for (const p of e.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it("keeps the frame's cards in the march layer's mask (a hole per card)", () => {
    const scene = overviewScene(graph, [], [], tree, new Set([AUTO_KEY]));
    const layout = layoutScene(scene, graph.topologyHash);
    const group = layout.nodes.find((n) => n.key === "n4")!;
    expect(group.card.frame).toBe(`frame|${AUTO_KEY}`);
    expect(marchHoles(layout.nodes, layout.edges)).toContainEqual(expect.objectContaining({ x: group.x, y: group.y, width: group.width, height: group.height }));
  });

  it("gives factory cards one height and leaves a blown-up factory's groups their own", () => {
    const layout = layoutScene(overviewScene(graph, [], [], tree, new Set([AUTO_KEY])), graph.topologyHash);
    const heights = new Set(layout.nodes.filter((n) => n.card.kind === "factory").map((n) => n.height));
    expect(heights.size).toBe(1);
  });
});

describe("nested frames' header controls (ui-review, 2026-10-28)", () => {
  // The Collapse pill's touch target and the title tab, as `Frame` in SiteGraph.tsx draws them.
  const collapseHit = (f: LaidFrame): Box => ({ x: f.x + f.width - COLLAPSE_W - NODE_PAD_X, y: f.y - PILL_HIT / 2, width: COLLAPSE_W, height: PILL_HIT });
  const tabBand = (f: LaidFrame) => ({ top: f.y - FRAME_HEADER_H / 2, bottom: f.y + FRAME_HEADER_H / 2 });
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const wide = wideTreeWorld(2, 2, 3);
  const wideTree = buildFactoryTree(wide.graph, wide.designations);
  const cases: [string, typeof graph, typeof tree, string[]][] = [
    ["Main base > Smelters", graph, tree, [MAIN, SMELTERS]],
    ["Area 0 > Area 0 line 0", wide.graph, wideTree, [designated(treeId(100)), designated(treeId(101))]],
    ["both areas, each with a line", wide.graph, wideTree, [designated(treeId(100)), designated(treeId(101)), designated(treeId(103)), designated(treeId(104))]],
  ];

  for (const [name, g, t, open] of cases) {
    it(`no two Collapse targets meet and nested tabs keep apart: ${name}`, () => {
      const scene = overviewScene(g, [], [], t, new Set(open));
      const layout = layoutScene(scene, g.topologyHash);
      expect(layout.frames.some((f) => f.parent !== undefined)).toBe(true);
      for (let i = 0; i < layout.frames.length; i++) {
        for (let j = i + 1; j < layout.frames.length; j++) {
          const [a, b] = [layout.frames[i], layout.frames[j]];
          expect(overlaps(collapseHit(a), collapseHit(b)), `${a.key} / ${b.key}`).toBe(false);
        }
      }
      for (const inner of layout.frames.filter((f) => f.parent !== undefined)) {
        const outer = layout.frames.find((f) => f.key === inner.parent)!;
        // A clear gap between the two tabs, not just no overlap.
        expect(tabBand(inner).top - tabBand(outer).bottom).toBeGreaterThanOrEqual(PILL_HIT - FRAME_HEADER_H);
        // Every pill's target stays inside the canvas.
        expect(collapseHit(outer).y).toBeGreaterThanOrEqual(0);
      }
      // Growing a frame upward for its nested one never covers a card drawn outside it.
      const nodes = layout.nodes;
      for (const f of layout.frames) {
        const own = new Set(scene.frames.filter((s) => s.key === f.key || s.parent === f.key).flatMap((s) => s.cardKeys));
        for (const n of nodes) if (!own.has(n.key)) expect(overlaps(n, f), `${n.key} under ${f.key}`).toBe(false);
      }
    });
  }
});

describe("the layout memo with blow-ups", () => {
  it("lays out again when a card blows up or collapses, and answers a repeat from memory", () => {
    const closed = overviewScene(graph, [], [], tree, new Set());
    layoutScene(closed, "h");
    layoutScene(overviewScene(graph, [], [], tree, new Set([MAIN])), "h");
    layoutScene(overviewScene(graph, [], [], tree, new Set([MAIN, SMELTERS])), "h");
    expect(layoutStats().computed).toBe(3);
    // Collapsing back is the first placement again; a key for a card not drawn changes nothing.
    layoutScene(overviewScene(graph, [], [], tree, new Set(["nothing"])), "h");
    layoutScene(overviewScene(graph, [], [], tree, new Set([MAIN])), "h");
    expect(layoutStats()).toMatchObject({ computed: 3, reused: 2 });
  });

  it("tells apart the same cards nested differently (the frame's parent is in the signature)", () => {
    const a = overviewScene(graph, [], [], tree, new Set([MAIN, SMELTERS]));
    layoutScene(a, "h");
    const flat = { ...a, frames: a.frames.map((f) => ({ ...f, parent: undefined })) };
    layoutScene(flat, "h");
    expect(layoutStats().computed).toBe(2);
  });
});

/** ADR-0061 Decision 5's guard: ADR-0050 Decision 3's 100 ms. CI machines vary, so the test's own bound is looser. */
const BUDGET_MS = 100;
const TEST_BOUND_MS = 3_000;

describe("the blow-up benchmark (ADR-0061 Decision 5, recorded in the ADR)", () => {
  it("lays out the 160-group site blown up to the cap, two frames deep, within the bound", { timeout: 30_000 }, () => {
    // ADR-0060's synthetic size: 160 groups (4 areas of 4 lines of 10) and 211 lines.
    const w = wideTreeWorld(4, 4, 10);
    const t = buildFactoryTree(w.graph, w.designations);
    expect(w.graph.nodes).toHaveLength(160);
    // One factory of 59 groups at the top level, blown up: the most cards one frame can hold under the cap.
    const one = wideTreeWorld(1, 1, EXPAND_MAX_CARDS - 1);
    const flat = buildFactoryTree(one.graph, one.designations, false);
    const timings: Record<string, number> = {};
    const cases: [string, typeof w.graph, typeof t, ReadonlySet<string>][] = [
      ["closed", w.graph, t, new Set()],
      ["areas blown up", w.graph, t, new Set(t.rootKeys)],
      ["Expand all (to the cap)", w.graph, t, expandAllKeys(w.graph, [], [], t, new Set())],
      ["one factory of 59 groups", one.graph, flat, new Set(flat.rootKeys)],
    ];
    for (const [name, g, tr, expanded] of cases) {
      const scene = overviewScene(g, [], [], tr, expanded);
      expect(scene.cards.length).toBeLessThanOrEqual(EXPAND_MAX_CARDS);
      // The median of five cold layouts (the memo cleared each time), after one to warm the JIT.
      const runs: number[] = [];
      let layout = layoutScene(scene, g.topologyHash);
      for (let i = 0; i < 5; i++) {
        clearLayoutMemo();
        const start = performance.now();
        layout = layoutScene(scene, g.topologyHash);
        runs.push(performance.now() - start);
      }
      timings[`${name}: ${scene.cards.length} cards, ${scene.frames.length} frames, ${layout.edges.length} lines`] = runs.sort((a, b) => a - b)[2];
      expect(layout.nodes).toHaveLength(scene.cards.length);
      expect(layout.frames).toHaveLength(scene.frames.length);
    }
    for (const [name, ms] of Object.entries(timings)) {
      expect(ms, name).toBeLessThan(TEST_BOUND_MS);
      if (ms > BUDGET_MS) console.warn(`blow-up layout: ${name} took ${Math.round(ms)} ms (over the ${BUDGET_MS} ms budget)`);
    }
    console.info(`blow-up layout timings (ms): ${JSON.stringify(Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v)])))}`);
  });
});
