import dagre from "@dagrejs/dagre";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionGraphResponseSchema, type PlannerNode, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { EMPTY_VIEW, factoryScene, overviewScene, type Scene } from "./canvasScene";
import { factoryModels } from "./hierarchy";
import { FRAME_HEADER_H, GLYPH_AT, GLYPH_CLEARANCE, GLYPH_INSET, LABEL_GAP, clearLayoutMemo, labelPlacement, layoutScene, layoutStats, pathMidpoint } from "./layoutSite";

const FIXTURE: ProductionGraph = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const models = factoryModels(FIXTURE);

/** Decision 3's worker trigger, and this test's own (generous) bound for slow machines. */
const WORKER_TRIGGER_MS = 100;
const TEST_BOUND_MS = 3_000;

beforeEach(clearLayoutMemo);
afterEach(() => vi.restoreAllMocks());

const rate = { className: "Desc_X_C", name: "X", unit: "items/min" as const, currentPerMinute: 1, maxPerMinute: 2 };

/** A made-up factory of `n` groups in layers of ten, in `trees` source trees of one recipe each, wired to the layer before. */
function generatedFactory(n: number, trees: number): ProductionGraph {
  const nodes: PlannerNode[] = Array.from({ length: n }, (_, i) => ({
    key: `n${i}`,
    kind: "machines",
    className: "Build_ConstructorMk1_C",
    name: "Constructor",
    recipe: `Recipe ${i % trees}`,
    count: 1 + (i % 9),
    machineIds: [`m${i}`],
    stateCounts: { producing: 1 },
    products: [rate],
    ingredients: [],
    at: { x: i, y: i },
    siteKey: "s",
    loop: false,
    factoryKey: "f",
    treeKey: `tree|${i % trees}`,
    collapseUnder: i + 10 < n ? `n${i + 10}` : null,
  }));
  const edges: ProductionGraph["edges"] = [];
  for (let i = 10; i < n; i++) {
    for (const j of [i - 10, i - 9]) {
      edges.push({ from: `n${j}`, to: `n${i}`, kind: "belt", itemClassName: `Desc_${i % 6}_C`, itemName: `Item ${i % 6}`, ratePerMinute: 30, rate: "estimated", mixed: false, capacityPerMinute: null, conveyorCount: 1, flow: "supply" });
    }
  }
  const site = { key: "s", name: "Site", at: { x: 0, y: 0 }, machineCount: n, stateCounts: {}, topOutputs: [], nodeKeys: nodes.map((x) => x.key) };
  return {
    nodes,
    edges,
    sites: [site],
    unconnectedMachineIds: [],
    beltData: "present",
    connectionsRefreshMinutes: 10,
    notes: [],
    factories: [{ key: "f", name: "Big factory", designationId: null, products: [], sideProducts: [], nodeKeys: nodes.map((x) => x.key), siteKeys: ["s"], machineCount: n, sharedNodeCount: 0 }],
    transports: [],
    topologyHash: "gen",
  };
}

const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

describe("layoutScene", () => {
  it("lays out the factory overview with the flow between the two cards", () => {
    const layout = layoutScene(overviewScene(FIXTURE, models), FIXTURE.topologyHash);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].points.length).toBeGreaterThanOrEqual(2);
    expect(layout.frames).toEqual([]);
  });

  it("puts a transport's glyph on the middle of its path and its label clear of the glyph", () => {
    const layout = layoutScene(factoryScene(FIXTURE, models[0], EMPTY_VIEW), FIXTURE.topologyHash);
    const train = layout.edges.find((e) => e.flow.carrier === "train")!;
    const first = train.points[0];
    const last = train.points[train.points.length - 1];
    expect(train.length).toBeGreaterThan(0);
    expect(train.mid.x).toBeGreaterThanOrEqual(Math.min(first.x, last.x) - 1);
    expect(train.mid.x).toBeLessThanOrEqual(Math.max(first.x, last.x) + 1);
    const flat = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    const plain = labelPlacement(flat, 50, 18);
    expect(plain.y).toBe(-(9 + LABEL_GAP));
    expect(labelPlacement(flat, 50, 18, GLYPH_CLEARANCE).y).toBe(plain.y - GLYPH_CLEARANCE);
  });

  it("stands a transport's glyph inside its own label pill, left of the words, and clear of every other label", () => {
    const layout = layoutScene(factoryScene(FIXTURE, models[0], EMPTY_VIEW), FIXTURE.topologyHash);
    const transports = layout.edges.filter((e) => e.flow.carrier !== "belt" && e.flow.carrier !== "pipe");
    expect(transports.length).toBeGreaterThan(0);
    for (const t of transports) {
      const left = t.labelX - t.labelWidth / 2;
      expect(t.mid.y).toBe(t.labelY);
      expect(t.mid.x - GLYPH_CLEARANCE).toBeGreaterThanOrEqual(left);
      // The words start after the glyph: their centre moved right by half the glyph's room.
      expect(t.textX).toBeCloseTo(t.labelX + GLYPH_INSET / 2);
      expect(t.mid.x + GLYPH_CLEARANCE).toBeLessThanOrEqual(left + GLYPH_INSET);
      for (const e of layout.edges) {
        if (e === t) continue;
        const apartX = Math.abs(t.mid.x - e.labelX) >= e.labelWidth / 2 + GLYPH_CLEARANCE - 0.01;
        const apartY = Math.abs(t.mid.y - e.labelY) >= e.labelHeight / 2 + GLYPH_CLEARANCE - 0.01;
        expect(apartX || apartY).toBe(true);
      }
    }
    // A plain belt's words stay centred.
    for (const e of layout.edges.filter((x) => !transports.includes(x))) expect(e.textX).toBe(e.labelX);
  });

  it("stands a glyph a third along its path, clear of the label at the middle, and clamps the fraction", () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(pathMidpoint(line, GLYPH_AT).x).toBeCloseTo(100 * GLYPH_AT);
    expect(pathMidpoint(line).x).toBeCloseTo(50);
    expect(pathMidpoint(line, 3).x).toBe(100);
    expect(pathMidpoint(line, -1).x).toBe(0);
  });

  it("draws an expanded bubble's groups inside a frame, with room above for its header", () => {
    const g = generatedFactory(24, 3);
    const scene = factoryScene(g, factoryModels(g)[0], EMPTY_VIEW);
    expect(scene.frames).toHaveLength(3);
    const layout = layoutScene(scene, g.topologyHash);
    expect(layout.frames).toHaveLength(3);
    const byKey = new Map(layout.nodes.map((n) => [n.key, n]));
    for (const f of layout.frames) {
      const frame = scene.frames.find((s) => s.key === f.key)!;
      for (const key of frame.cardKeys) {
        const n = byKey.get(key)!;
        expect(n.x).toBeGreaterThanOrEqual(f.x);
        expect(n.x + n.width).toBeLessThanOrEqual(f.x + f.width);
        // Room inside for the lower half of the frame's tab.
        expect(n.y).toBeGreaterThanOrEqual(f.y + FRAME_HEADER_H / 2);
        expect(n.y + n.height).toBeLessThanOrEqual(f.y + f.height);
      }
      expect(f.y).toBeGreaterThanOrEqual(0);
    }
    // Frames do not run into each other, and a card outside a frame is not inside one.
    for (const a of layout.frames) for (const b of layout.frames) if (a !== b) expect(overlap(a, b)).toBe(false);
    expect(layout.width).toBeGreaterThan(0);
  });

  it("is deterministic and keeps cards apart", () => {
    const g = generatedFactory(40, 4);
    const scene = factoryScene(g, factoryModels(g)[0], EMPTY_VIEW);
    const a = layoutScene(scene, "x");
    clearLayoutMemo();
    expect(layoutScene(scene, "x")).toEqual(a);
    for (const p of a.nodes) for (const q of a.nodes) if (p !== q) expect(overlap(p, q)).toBe(false);
  });

  it("lays out an empty scene", () => {
    const empty: Scene = { ...overviewScene(FIXTURE, []), cards: [], flows: [] };
    expect(layoutScene(empty)).toMatchObject({ nodes: [], edges: [], frames: [], width: 0, height: 0 });
  });
});

describe("the layout memo", () => {
  it("runs dagre once for a topology and answers a poll that only moves rates from memory", () => {
    const first = factoryScene(FIXTURE, models[0], EMPTY_VIEW);
    layoutScene(first, "hash-1");
    expect(layoutStats()).toMatchObject({ computed: 1, reused: 0 });
    // The next poll: same topology, new numbers in the words (the sizes stay the same).
    const polled = FIXTURE.nodes.map((n) => ({ ...n, products: n.products.map((p) => ({ ...p, currentPerMinute: p.currentPerMinute + 1 })) }));
    const again = factoryScene({ ...FIXTURE, nodes: polled }, factoryModels({ ...FIXTURE, nodes: polled })[0], EMPTY_VIEW);
    const layout = layoutScene(again, "hash-1");
    expect(layoutStats()).toMatchObject({ computed: 1, reused: 1 });
    // The words are the new ones even though the positions came from memory.
    expect(layout.nodes.some((n) => n.lines.some((l) => /49\/min/.test(l)))).toBe(true);
  });

  it("lays out again when the view changes the cards, or the sizes change", () => {
    const g = generatedFactory(24, 3);
    layoutScene(factoryScene(g, factoryModels(g)[0], EMPTY_VIEW), "h");
    // One tree folded into a card: other cards, so another layout.
    layoutScene(factoryScene(g, factoryModels(g)[0], { ...EMPTY_VIEW, flipped: new Set(["tree|0"]) }), "h");
    expect(layoutStats().computed).toBe(2);
    layoutScene(factoryScene(FIXTURE, models[0], EMPTY_VIEW), "h");
    expect(layoutStats().computed).toBe(3);
    const wider = FIXTURE.nodes.map((n) => ({ ...n, products: n.name === "Smelter" ? n.products.map((p) => ({ ...p, name: "Iron Ingot with a much longer name" })) : n.products }));
    layoutScene(factoryScene({ ...FIXTURE, nodes: wider }, factoryModels({ ...FIXTURE, nodes: wider })[0], EMPTY_VIEW), "h");
    expect(layoutStats().computed).toBe(4);
  });

  it("does not mix two topologies that share a hash by accident", () => {
    const a = generatedFactory(12, 2);
    const b = generatedFactory(13, 2);
    layoutScene(factoryScene(a, factoryModels(a)[0], EMPTY_VIEW), "same");
    const laid = layoutScene(factoryScene(b, factoryModels(b)[0], EMPTY_VIEW), "same");
    expect(laid.nodes).toHaveLength(13);
    expect(layoutStats().computed).toBe(2);
  });

  it("keeps only a handful of layouts", () => {
    for (let i = 2; i < 30; i++) {
      const g = generatedFactory(i, 1);
      layoutScene(factoryScene(g, factoryModels(g)[0], EMPTY_VIEW), `h${i}`);
    }
    // The first is gone, the latest is kept.
    const base = layoutStats();
    const latest = generatedFactory(29, 1);
    layoutScene(factoryScene(latest, factoryModels(latest)[0], EMPTY_VIEW), "h29");
    expect(layoutStats().reused - base.reused).toBe(1);
    const old = generatedFactory(2, 1);
    layoutScene(factoryScene(old, factoryModels(old)[0], EMPTY_VIEW), "h2");
    expect(layoutStats().computed - base.computed).toBe(1);
  });
});

describe("when dagre cannot route a shape", () => {
  it("draws parallel flows over one path with their labels one above the other", () => {
    // Four bubble cards joined by 24 flows in both directions: dagre 3 throws "Not possible to find intersection".
    const g = generatedFactory(40, 4);
    const scene = factoryScene(g, factoryModels(g)[0], EMPTY_VIEW);
    const layout = layoutScene(scene, g.topologyHash);
    expect(layout.edges).toHaveLength(scene.flows.length);
    const seen = new Set<string>();
    for (const e of layout.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2);
      for (const p of e.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      const spot = `${Math.round(e.labelX)}|${Math.round(e.labelY)}`;
      expect(seen.has(spot), `two labels at ${spot}`).toBe(false);
      seen.add(spot);
    }
  });

  it("falls back to a plain grid when dagre throws every time, with frames round their cards", () => {
    vi.spyOn(dagre, "layout").mockImplementation(() => {
      throw new Error("dagre is broken");
    });
    const g = generatedFactory(24, 3);
    const scene = factoryScene(g, factoryModels(g)[0], EMPTY_VIEW);
    const layout = layoutScene(scene, g.topologyHash);
    expect(layout.nodes).toHaveLength(24);
    expect(layout.frames).toHaveLength(3);
    for (const a of layout.nodes) for (const b of layout.nodes) if (a !== b) expect(overlap(a, b)).toBe(false);
    const byKey = new Map(layout.nodes.map((n) => [n.key, n]));
    for (const f of layout.frames) {
      for (const key of scene.frames.find((s) => s.key === f.key)!.cardKeys) {
        const n = byKey.get(key)!;
        expect(n.x).toBeGreaterThanOrEqual(f.x);
        expect(n.x + n.width).toBeLessThanOrEqual(f.x + f.width);
        expect(n.y).toBeGreaterThanOrEqual(f.y);
        expect(n.y + n.height).toBeLessThanOrEqual(f.y + f.height);
      }
    }
    for (const e of layout.edges) expect(e.points).toHaveLength(2);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe("the timing guard (Decision 3's worker trigger)", () => {
  it("lays out a 150-group factory (the size of a real site), collapsed and fully open, within the bound, and the memo makes a repeat free", () => {
    const g = generatedFactory(150, 15);
    const model = factoryModels(g)[0];
    const timings: Record<string, number> = {};
    for (const [name, flipped] of [
      ["collapsed (15 bubbles)", new Set<string>()],
      ["open (150 groups in 15 frames)", new Set(Array.from({ length: 15 }, (_, i) => `tree|${i}`))],
    ] as const) {
      const scene = factoryScene(g, model, { ...EMPTY_VIEW, flipped });
      clearLayoutMemo();
      const start = performance.now();
      const layout = layoutScene(scene, g.topologyHash);
      timings[name] = performance.now() - start;
      expect(layout.nodes.length).toBe(scene.cards.length);
      const repeat = performance.now();
      layoutScene(scene, g.topologyHash);
      expect(performance.now() - repeat).toBeLessThan(timings[name] + 1);
      expect(layoutStats().reused).toBe(1);
    }
    for (const [name, ms] of Object.entries(timings)) {
      expect(ms, name).toBeLessThan(TEST_BOUND_MS);
      if (ms > WORKER_TRIGGER_MS) console.warn(`layoutScene: ${name} took ${Math.round(ms)} ms (over Decision 3's ${WORKER_TRIGGER_MS} ms worker trigger)`);
    }
    console.info(`layoutScene timings (ms): ${JSON.stringify(Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v)])))}`);
  });
});
