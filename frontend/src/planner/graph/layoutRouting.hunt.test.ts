import { beforeEach, describe, expect, it } from "vitest";
import type { Card, CanvasFlow, Frame, Scene } from "./canvasScene";
import { segmentHitsRect } from "./edgeShapes";
import { clearLayoutMemo, layoutScene, layoutStats, returnFlows } from "./layoutSite";

beforeEach(clearLayoutMemo);

const card = (key: string, frame?: string): Card => ({
  key, kind: "group", nodeKeys: [key], title: key, lines: [key], count: 1, className: undefined, glyph: "machines",
  label: key, description: key, facts: [], loop: false, frame, bubbleKey: undefined,
});
const flow = (from: string, to: string, carrier = "belt", n = 1): CanvasFlow => ({
  from, to, itemClassName: "i", itemName: "Item", carrier, flow: "supply", mixed: false, rate: "measured",
  label: `Item ${n}`, labelLines: Array.from({ length: n }, (_, i) => `Item line ${i}`),
});
const scene = (cards: Card[], flows: CanvasFlow[], frames: Frame[] = []): Scene => ({
  level: "site", name: "t", cards, frames, flows, bubbleKeys: [], foldKeys: [], hasStorage: false, openByDefault: true, noun: "groups",
});
type R = { x: number; y: number; width: number; height: number };
const overlap = (a: R, b: R) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const lbl = (e: { labelX: number; labelY: number; labelWidth: number; labelHeight: number }) => ({ x: e.labelX - e.labelWidth / 2, y: e.labelY - e.labelHeight / 2, width: e.labelWidth, height: e.labelHeight });

function check(l: ReturnType<typeof layoutScene>) {
  for (const e of l.edges) {
    const others = l.nodes.filter((n) => n.key !== e.flow.from && n.key !== e.flow.to);
    for (let i = 1; i < e.points.length; i++) {
      const [a, b] = [e.points[i - 1], e.points[i]];
      expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true);
      for (const n of others) expect(segmentHitsRect(a, b, n)).toBe(false);
    }
    for (const n of l.nodes) expect(overlap(lbl(e), n)).toBe(false);
    for (const o of l.edges) if (o !== e) expect(overlap(lbl(e), lbl(o))).toBe(false);
  }
  for (const n of l.nodes) expect(n.x + n.width).toBeLessThanOrEqual(l.width + 0.5);
}

describe("hunt: ADR-0059 router", () => {
  it("empty scene", () => {
    const l = layoutScene(scene([], []));
    expect(l.nodes).toEqual([]);
    expect(l.width).toBe(0);
  });
  it("one card", () => {
    const l = layoutScene(scene([card("a")], []));
    expect(l.nodes.length).toBe(1);
    expect(layoutStats().routerFailures).toBe(0);
  });
  it("self-loop does not run through its own card", () => {
    const l = layoutScene(scene([card("a"), card("b")], [flow("a", "b"), flow("b", "b")]));
    const e = l.edges[1];
    const n = l.nodes.find((x) => x.key === "b")!;
    for (let i = 1; i < e.points.length; i++) expect(segmentHitsRect(e.points[i - 1], e.points[i], n)).toBe(false);
    expect(layoutStats().routerFailures).toBe(0);
  });
  it("self-loop on a lone card", () => {
    const l = layoutScene(scene([card("a")], [flow("a", "a")]));
    const e = l.edges[0];
    const n = l.nodes[0];
    for (const p of e.points) expect(p.y).toBeLessThanOrEqual(l.height);
    for (const p of e.points) expect(p.x).toBeGreaterThanOrEqual(0);
    expect(n).toBeDefined();
    for (let i = 1; i < e.points.length; i++) expect(segmentHitsRect(e.points[i - 1], e.points[i], n)).toBe(false);
  });
  it("A->B and B->A pair, separate and with parallel flows", () => {
    const l = layoutScene(scene([card("a"), card("b")], [flow("a", "b"), flow("b", "a"), flow("a", "b", "train", 2), flow("b", "a", "belt", 3)]));
    check(l);
    expect(layoutStats().routerFailures).toBe(0);
    const a = l.nodes.find((n) => n.key === "a")!;
    for (const e of l.edges) {
      const from = l.nodes.find((n) => n.key === e.flow.from)!;
      expect(Math.abs(e.points[0].x - from.x) < 0.5 || Math.abs(e.points[0].x - from.x - from.width) < 0.5).toBe(true);
      expect(a).toBeDefined();
    }
  });
  it("cycle of three + disconnected + flow to unknown card", () => {
    const l = layoutScene(scene([card("a"), card("b"), card("c"), card("d"), card("e")], [flow("a", "b"), flow("b", "c"), flow("c", "a"), flow("d", "e"), flow("a", "zzz")]));
    check(l);
    expect(l.edges.length).toBe(4);
    for (const e of l.edges) {
      const f = l.nodes.find((n) => n.key === e.flow.from)!;
      const t = l.nodes.find((n) => n.key === e.flow.to)!;
      const p0 = e.points[0];
      const pn = e.points[e.points.length - 1];
      expect(p0.y >= f.y - 0.5 && p0.y <= f.y + f.height + 0.5).toBe(true);
      expect(pn.y >= t.y - 0.5 && pn.y <= t.y + t.height + 0.5).toBe(true);
    }
  });
  it("frames still contain their cards", () => {
    const cs = ["a", "b", "c", "d", "e", "f"].map((k, i) => card(k, i >= 1 && i <= 4 ? "frame|x" : undefined));
    const fl = [flow("a", "b"), flow("b", "c"), flow("a", "c"), flow("c", "d"), flow("a", "d"), flow("a", "e"), flow("b", "e"), flow("e", "f"), flow("d", "f"), flow("a", "f"), flow("f", "b")];
    const l = layoutScene(scene(cs, fl, [{ key: "frame|x", bubbleKey: "x", title: "x", cardKeys: ["b", "c", "d", "e"] }]));
    const f = l.frames[0];
    for (const k of ["b", "c", "d", "e"]) {
      const n = l.nodes.find((x) => x.key === k)!;
      expect(n.x).toBeGreaterThanOrEqual(f.x - 0.5);
      expect(n.x + n.width).toBeLessThanOrEqual(f.x + f.width + 0.5);
      expect(n.y).toBeGreaterThanOrEqual(f.y - 0.5);
      expect(n.y + n.height).toBeLessThanOrEqual(f.y + f.height + 0.5);
    }
    check(l);
  });
  it("150-card scene is fast", () => {
    const keys = Array.from({ length: 150 }, (_, i) => `n${i}`);
    const fl: CanvasFlow[] = [];
    for (let i = 10; i < 150; i++) {
      fl.push(flow(keys[i - 10], keys[i]));
      fl.push(flow(keys[i - 9 < i - (i % 10) ? i - 9 : i - 10], keys[i]));
      if (i % 5 === 0 && i >= 20) fl.push(flow(keys[i - 20], keys[i]));
    }
    fl.push(flow("n140", "n0"));
    const l = layoutScene(scene(keys.map((k) => card(k)), fl));
    check(l);
    // ~50 ms alone, ~110 ms with the whole directory's suites running in parallel: a loose bound against a blow-up.
    expect(layoutStats().routerFailures).toBe(0);
    expect(layoutStats().lastMs).toBeLessThan(500);
  });
  it("rate-only change reuses placement", () => {
    const s = scene([card("a"), card("b")], [flow("a", "b")]);
    layoutScene(s, "h");
    layoutScene(s, "h");
    expect(layoutStats().computed).toBe(1);
    expect(layoutStats().reused).toBe(1);
  });
});

describe("hunt: returnFlows", () => {
  it("self-loop and parallel flows", () => {
    expect([...returnFlows(["a", "b"], [{ from: "a", to: "a" }, { from: "a", to: "b" }, { from: "a", to: "b" }])]).toEqual([0]);
  });
  it("2-cycle with parallel", () => {
    expect([...returnFlows(["a", "b"], [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "b", to: "a" }, { from: "a", to: "b" }])].sort()).toEqual([1, 2]);
  });
});
