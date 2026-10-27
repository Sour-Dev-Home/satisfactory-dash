import { beforeEach, expect, it, vi } from "vitest";
import type { Card, CanvasFlow, Scene } from "./canvasScene";
import { segmentHitsRect } from "./edgeShapes";
import { clearLayoutMemo, layoutScene, layoutStats } from "./layoutSite";

// Make dagre throw on its first layout per scene, so the merged form (the fallback) runs.
const state = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@dagrejs/dagre", async (orig) => {
  const mod = await orig<{ default: { layout: (g: unknown, o?: unknown) => void } }>();
  const real = mod.default.layout;
  mod.default.layout = (g, o) => {
    if (state.calls++ % 2 === 0) throw new Error("forced");
    real(g, o);
  };
  return mod;
});

beforeEach(() => {
  clearLayoutMemo();
  state.calls = 0;
});

const card = (key: string): Card =>
  ({ key, kind: "group", nodeKeys: [key], title: key, lines: [key], count: 1, className: undefined, glyph: "machines", label: key, description: key, facts: [], loop: false, frame: undefined, bubbleKey: undefined }) as Card;
const flow = (from: string, to: string, n = 1): CanvasFlow => ({
  from, to, itemClassName: "i", itemName: "I", carrier: "belt", flow: "supply", mixed: false, rate: "measured", label: "I", labelLines: Array.from({ length: n }, (_, i) => `line ${i}`), ratePerMinute: 1, unit: "items/min", quality: "measured",
});
type R = { x: number; y: number; width: number; height: number };
const overlap = (a: R, b: R) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const lbl = (e: { labelX: number; labelY: number; labelWidth: number; labelHeight: number }): R => ({ x: e.labelX - e.labelWidth / 2, y: e.labelY - e.labelHeight / 2, width: e.labelWidth, height: e.labelHeight });

it("merged fallback: stacked labels of parallel flows that skip ranks stay apart after straightening", () => {
  const cards = ["a", "b", "c", "d", "e"].map(card);
  const flows = [flow("a", "b"), flow("b", "c"), flow("c", "d"), flow("d", "e"), flow("a", "e", 2), flow("a", "e", 2), flow("a", "e", 1), flow("a", "d", 2), flow("a", "d")];
  const scene: Scene = { level: "site", name: "t", cards, frames: [], flows, bubbleKeys: [], foldKeys: [], hasStorage: false, openByDefault: true, noun: "groups" };
  const l = layoutScene(scene);
  expect(state.calls).toBe(2);
  for (const e of l.edges) for (const o of l.edges) if (o !== e) expect(overlap(lbl(e), lbl(o))).toBe(false);
  for (const e of l.edges) for (const n of l.nodes) expect(overlap(lbl(e), n)).toBe(false);
});

it("merged fallback: links on different carriers between one pair each run through their own stacked label, not another's (2026-10-27)", () => {
  // The owner's screenshot: the merged form gave every flow of a pair the route through the middle of their stacked
  // labels, so each line crossed the middle label. A belt, a pipe and a train are never bundled, so they still stack here.
  const cards = ["a", "b", "c"].map(card);
  const flows = [flow("a", "b", 1), { ...flow("a", "b", 2), carrier: "pipe" }, { ...flow("a", "b", 2), carrier: "train" }, flow("b", "c"), flow("c", "a", 2)];
  const scene: Scene = { level: "site", name: "t", cards, frames: [], flows, bubbleKeys: [], foldKeys: [], hasStorage: false, openByDefault: true, noun: "groups" };
  const l = layoutScene(scene);
  expect(state.calls).toBe(2); // separate threw, merged ran
  expect(l.edges).toHaveLength(5);
  for (const e of l.edges) {
    for (const o of l.edges) {
      if (o === e) continue;
      for (let i = 1; i < e.points.length; i++) expect(segmentHitsRect(e.points[i - 1], e.points[i], lbl(o)), `${e.flow.carrier} ${e.flow.from}->${e.flow.to} through ${o.flow.carrier}'s label`).toBe(false);
    }
  }
});

it("merged fallback with a reversed pair (a->b, b->a) and a chain: routes run source to target, labels clear", () => {
  const cards = ["a", "b", "c"].map(card);
  const flows = [flow("a", "b"), flow("b", "a", 2), flow("a", "b", 3), flow("b", "c"), flow("c", "a")];
  const scene: Scene = { level: "site", name: "t", cards, frames: [], flows, bubbleKeys: [], foldKeys: [], hasStorage: false, openByDefault: true, noun: "groups" };
  const l = layoutScene(scene);
  expect(layoutStats().routerFailures).toBe(0);
  expect(state.calls).toBe(2); // separate threw, merged ran
  for (const e of l.edges) {
    const from = l.nodes.find((n) => n.key === e.flow.from)!;
    const to = l.nodes.find((n) => n.key === e.flow.to)!;
    const side = (p: { x: number }, n: R) => Math.abs(p.x - n.x) < 0.5 || Math.abs(p.x - n.x - n.width) < 0.5;
    expect(side(e.points[0], from)).toBe(true);
    expect(side(e.points[e.points.length - 1], to)).toBe(true);
    for (const n of l.nodes) {
      if (n === from || n === to) continue;
      for (let i = 1; i < e.points.length; i++) expect(segmentHitsRect(e.points[i - 1], e.points[i], n)).toBe(false);
    }
    for (const n of l.nodes) expect(overlap(lbl(e), n)).toBe(false);
    for (const o of l.edges) if (o !== e) expect(overlap(lbl(e), lbl(o))).toBe(false);
  }
});
