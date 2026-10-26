import { beforeEach, describe, expect, it } from "vitest";
import type { Card, CanvasFlow, Frame, Scene } from "./canvasScene";
import { clearLayoutMemo, layoutScene, layoutStats } from "./layoutSite";

beforeEach(clearLayoutMemo);

const card = (key: string, extra: Partial<Card> = {}): Card => ({
  key,
  kind: "group",
  nodeKeys: [key],
  title: key,
  lines: ["line"],
  count: undefined,
  className: undefined,
  glyph: "unknown",
  label: key,
  description: key,
  facts: [],
  loop: false,
  frame: undefined,
  bubbleKey: undefined,
  ...extra,
});
const flow = (from: string, to: string, extra: Partial<CanvasFlow> = {}): CanvasFlow => ({
  from,
  to,
  itemClassName: "X",
  itemName: "X",
  carrier: "belt",
  flow: "supply",
  mixed: false,
  rate: "measured",
  label: "X",
  labelLines: ["X"],
  ...extra,
});
const sceneOf = (cards: Card[], flows: CanvasFlow[] = [], frames: Frame[] = []): Scene => ({
  level: "factory",
  name: "T",
  cards,
  frames,
  flows,
  bubbleKeys: [],
  foldKeys: [],
  hasStorage: false,
  openByDefault: true,
  noun: "group",
});
const finite = (n: number) => Number.isFinite(n);

describe("layoutScene adversarial scenes", () => {
  it("lays out an empty scene", () => {
    const l = layoutScene(sceneOf([]));
    expect(l).toMatchObject({ nodes: [], edges: [], frames: [], width: 0, height: 0 });
  });

  it("zero flows: every node has finite coordinates", () => {
    const l = layoutScene(sceneOf([card("a"), card("b")]));
    for (const n of l.nodes) expect([n.x, n.y].every(finite)).toBe(true);
  });

  it("drops a flow whose end is not a card and keeps the rest", () => {
    const l = layoutScene(sceneOf([card("a"), card("b")], [flow("a", "ghost"), flow("ghost", "b"), flow("a", "b")]));
    expect(l.edges).toHaveLength(1);
    expect(l.flows).toHaveLength(1);
    expect(l.edges[0].points.length).toBeGreaterThan(0);
  });

  it("prototype-ish keys lay out like any others", () => {
    const keys = ["__proto__", "constructor", "toString", "hasOwnProperty"];
    const l = layoutScene(sceneOf(keys.map((k) => card(k)), [flow("__proto__", "constructor"), flow("constructor", "toString"), flow("toString", "hasOwnProperty")]));
    expect(l.nodes.map((n) => n.key)).toEqual(keys);
    for (const n of l.nodes) expect([n.x, n.y].every(finite)).toBe(true);
    expect(l.edges.every((e) => e.points.length > 0)).toBe(true);
  });

  it("a self-loop flow does not throw and has a path", () => {
    const l = layoutScene(sceneOf([card("a"), card("b")], [flow("a", "a"), flow("a", "b")]));
    expect(l.edges).toHaveLength(2);
    expect(l.edges[0].points.every((p) => finite(p.x) && finite(p.y))).toBe(true);
  });

  it("parallel flows between one pair each get a path and distinct label heights", () => {
    const l = layoutScene(sceneOf([card("a"), card("b")], [flow("a", "b"), flow("a", "b", { labelLines: ["Y", "z"] }), flow("b", "a")]));
    expect(l.edges).toHaveLength(3);
    expect(l.edges.every((e) => e.points.length > 0 && finite(e.labelX) && finite(e.labelY))).toBe(true);
  });

  it("a cycle lays out", () => {
    const l = layoutScene(sceneOf([card("a"), card("b"), card("c")], [flow("a", "b"), flow("b", "c"), flow("c", "a")]));
    expect(l.edges.every((e) => e.points.length > 0)).toBe(true);
  });

  // Known gap, unreachable from factoryScene (a frame always has 2+ cards): dagre gives a childless compound node a NaN box.
  it.fails("an empty frame (no cards) does not break the layout and has finite or no box", () => {
    const l = layoutScene(sceneOf([card("a")], [], [{ key: "frame|e", bubbleKey: "e", title: "E", cardKeys: [] }]));
    expect(l.nodes).toHaveLength(1);
    for (const f of l.frames) expect([f.x, f.y, f.width, f.height].every(finite)).toBe(true);
    expect(finite(l.width) && finite(l.height)).toBe(true);
  });

  it("a frame naming a card that is not in the scene does not throw", () => {
    const l = layoutScene(sceneOf([card("a", { frame: "frame|f" })], [], [{ key: "frame|f", bubbleKey: "f", title: "F", cardKeys: ["a", "missing"] }]));
    expect(l.nodes).toHaveLength(1);
    expect([l.nodes[0].x, l.nodes[0].y].every(finite)).toBe(true);
    for (const f of l.frames) expect([f.x, f.y, f.width, f.height].every(finite)).toBe(true);
  });

  it("a frame holds its cards", () => {
    const cards = [card("a", { frame: "frame|f" }), card("b", { frame: "frame|f" }), card("c")];
    const l = layoutScene(sceneOf(cards, [flow("a", "b"), flow("b", "c")], [{ key: "frame|f", bubbleKey: "f", title: "F", cardKeys: ["a", "b"] }]));
    const f = l.frames[0];
    for (const n of l.nodes.filter((x) => x.key !== "c")) {
      expect(n.x).toBeGreaterThanOrEqual(f.x - 0.5);
      expect(n.x + n.width).toBeLessThanOrEqual(f.x + f.width + 0.5);
      expect(n.y).toBeGreaterThanOrEqual(f.y - 0.5);
      expect(n.y + n.height).toBeLessThanOrEqual(f.y + f.height + 0.5);
    }
  });

  it("a card listed twice yields no NaN", () => {
    const l = layoutScene(sceneOf([card("a"), card("a"), card("b")], [flow("a", "b")]));
    for (const n of l.nodes) expect([n.x, n.y, n.width, n.height].every(finite)).toBe(true);
  });

  it("many flows between two cards (huge count) still lay out", () => {
    const flows = Array.from({ length: 300 }, (_, i) => flow("a", "b", { labelLines: [`item ${i}`] }));
    const l = layoutScene(sceneOf([card("a"), card("b")], flows));
    expect(l.edges).toHaveLength(300);
    expect(l.edges.every((e) => finite(e.labelX) && finite(e.labelY))).toBe(true);
  });

  it("a very long title and many lines still give finite sizes", () => {
    const l = layoutScene(sceneOf([card("a", { title: "T".repeat(5000), lines: Array.from({ length: 500 }, () => "x".repeat(200)) })]));
    expect(finite(l.width) && finite(l.height)).toBe(true);
  });
});

describe("layoutScene memo", () => {
  it("same hash, different content (a card added) is not served from the memo", () => {
    const a = layoutScene(sceneOf([card("a")]), "H");
    const b = layoutScene(sceneOf([card("a"), card("b")]), "H");
    expect(a.nodes).toHaveLength(1);
    expect(b.nodes).toHaveLength(2);
    expect(layoutStats().computed).toBe(2);
  });

  it("same hash, same cards, different flows is not served from the memo", () => {
    layoutScene(sceneOf([card("a"), card("b")], []), "H");
    const b = layoutScene(sceneOf([card("a"), card("b")], [flow("a", "b")]), "H");
    expect(b.edges[0].points.length).toBeGreaterThan(0);
  });

  it("same hash, reversed flow direction is a different layout", () => {
    layoutScene(sceneOf([card("a"), card("b")], [flow("a", "b")]), "H");
    const b = layoutScene(sceneOf([card("a"), card("b")], [flow("b", "a")]), "H");
    expect(layoutStats().computed).toBe(2);
    expect(b.nodes.find((n) => n.key === "b")!.x).toBeLessThan(b.nodes.find((n) => n.key === "a")!.x);
  });

  it("same hash and level, a frame's membership changed is recomputed", () => {
    const cards = [card("a"), card("b")];
    layoutScene(sceneOf(cards, [], [{ key: "frame|f", bubbleKey: "f", title: "F", cardKeys: ["a"] }]), "H");
    layoutScene(sceneOf(cards, [], [{ key: "frame|f", bubbleKey: "f", title: "F", cardKeys: ["a", "b"] }]), "H");
    expect(layoutStats().computed).toBe(2);
  });

  it("the hit returns the current words, not the remembered ones", () => {
    layoutScene(sceneOf([card("a", { title: "old" })]), "H");
    const l = layoutScene(sceneOf([card("a", { title: "new" })]), "H");
    expect(layoutStats().reused).toBe(1);
    expect(l.nodes[0].card.title).toBe("new");
    expect(l.nodes[0].title).toBe("new");
  });

  it("different levels with the same hash and cards do not share an entry", () => {
    layoutScene({ ...sceneOf([card("a")]), level: "overview" }, "H");
    layoutScene({ ...sceneOf([card("a")]), level: "factory" }, "H");
    expect(layoutStats().computed).toBe(2);
  });

  it("evicts the oldest past the limit and recomputes it, still correct", () => {
    const mk = (i: number) => sceneOf([card(`k${i}`)]);
    for (let i = 0; i < 30; i++) layoutScene(mk(i), "H");
    expect(layoutStats().computed).toBe(30);
    layoutScene(mk(0), "H");
    expect(layoutStats().computed).toBe(31);
    layoutScene(mk(29), "H");
    expect(layoutStats().reused).toBe(1);
  });

  it("a used entry is kept young and survives eviction", () => {
    const mk = (i: number) => sceneOf([card(`k${i}`)]);
    layoutScene(mk(0), "H");
    for (let i = 1; i < 12; i++) layoutScene(mk(i), "H");
    layoutScene(mk(0), "H"); // refresh
    for (let i = 12; i < 15; i++) layoutScene(mk(i), "H");
    const before = layoutStats().computed;
    layoutScene(mk(0), "H");
    expect(layoutStats().computed).toBe(before);
  });

  it("cards with identical sizes but different keys in the same hash are distinct entries", () => {
    const a = layoutScene(sceneOf([card("a"), card("b")]), "H");
    const b = layoutScene(sceneOf([card("c"), card("d")]), "H");
    expect(b.nodes.map((n) => n.key)).toEqual(["c", "d"]);
    expect(a.nodes.map((n) => n.key)).toEqual(["a", "b"]);
  });

  it("card order matters to the signature but both lay out every card", () => {
    const l = layoutScene(sceneOf([card("b"), card("a")], [flow("a", "b")]), "H");
    expect(l.nodes.map((n) => n.key)).toEqual(["b", "a"]);
  });

  it("two cards whose keys concatenate to the same text do not collide", () => {
    layoutScene(sceneOf([card("ab"), card("c")]), "H");
    layoutScene(sceneOf([card("a"), card("bc")]), "H");
    expect(layoutStats().computed).toBe(2);
  });
});
