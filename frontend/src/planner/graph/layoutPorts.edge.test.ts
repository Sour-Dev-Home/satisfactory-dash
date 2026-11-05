import { beforeEach, describe, expect, it } from "vitest";
import type { CanvasFlow, Card, Scene } from "./canvasScene";
import { clearLayoutMemo, layoutScene, type SiteLayout } from "./layoutSite";
import { PORT_INSET, PORT_PITCH, PORTS_MAX } from "./ports";

beforeEach(clearLayoutMemo);

// ADR-0063 build PR 2, edge cases the main tests skip: self-loops, a card with in and out on one side, a fold on both
// directions of one side, a focused layout, unknown items, and the memo across the flag.

const card = (key: string): Card => ({
  key, kind: "factory", nodeKeys: [key], title: key, lines: [key, "Product · 0/min"], count: 6, className: undefined, glyph: "machines",
  label: key, description: key, facts: [], loop: false, frame: undefined, bubbleKey: undefined,
});
const link = (from: string, to: string, itemName: string | null, ratePerMinute: number | null = 10): CanvasFlow => ({
  from, to, itemClassName: itemName === null ? null : `Desc_${itemName.replace(/ /g, "")}_C`, itemName, carrier: "belt", flow: "supply", mixed: false,
  rate: "measured", label: itemName ?? "?", labelLines: [itemName ?? "?"], ratePerMinute, unit: "items/min", quality: ratePerMinute === null ? "unknown" : "measured",
});
const scene = (keys: string[], flows: CanvasFlow[]): Scene => ({
  level: "overview", name: "Factories", frames: [], bubbleKeys: [], foldKeys: [], hasStorage: false, openByDefault: true, noun: "factories",
  cards: keys.map(card), flows,
});
const on = { ports: true };

function sane(l: SiteLayout) {
  const at = new Map(l.nodes.flatMap((n) => (n.ports ?? []).map((p) => [p.id, p] as const)));
  for (const n of l.nodes) {
    expect(Number.isFinite(n.height) && Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    for (const p of n.ports ?? []) expect(Number.isFinite(p.y)).toBe(true);
  }
  for (const e of l.edges) {
    expect(at.has(e.srcPort!)).toBe(true);
    expect(at.has(e.tgtPort!)).toBe(true);
    for (const p of e.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  }
  expect(Number.isFinite(l.width) && Number.isFinite(l.height)).toBe(true);
}

describe("ports edge cases", () => {
  it("lays out a self-loop with ports on", () => {
    const l = layoutScene(scene(["A"], [link("A", "A", "Iron Plate")]), undefined, undefined, on);
    sane(l);
    expect(l.edges).toHaveLength(1);
  });

  it("lays out a card with an item in and out on one side (a return) without losing a port", () => {
    const l = layoutScene(scene(["A", "B"], [link("A", "B", "Iron Plate"), link("B", "A", "Iron Plate"), link("B", "A", "Screw")]), undefined, undefined, on);
    sane(l);
    const a = l.nodes.find((n) => n.key === "A")!;
    // A: out right (Iron Plate), in right (return Iron Plate, Screw): three ports on its right edge, a pitch apart.
    const ys = (a.ports ?? []).filter((p) => p.side === "r").map((p) => p.y).sort((x, y) => x - y);
    expect(ys).toHaveLength(3);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(PORT_PITCH, 6);
    expect(ys[0]).toBeGreaterThanOrEqual(PORT_INSET - 1e-6);
    expect(a.height - ys[2]).toBeGreaterThanOrEqual(PORT_INSET - 1e-6);
  });

  it("holds a card's two '+N' ports (in and out on one side) inside its height", () => {
    const items = Array.from({ length: 8 }, (_, i) => `Item ${i}`);
    const flows = [...items.map((n, i) => link("B", "A", n, 100 - i)), ...items.map((n, i) => link("A", "B", n, 50 - i))];
    const l = layoutScene(scene(["A", "B"], flows), undefined, undefined, on);
    sane(l);
    for (const n of l.nodes) {
      const right = (n.ports ?? []).filter((p) => p.side === "r");
      for (const p of right) {
        expect(p.y).toBeGreaterThanOrEqual(PORT_INSET - 1e-6);
        expect(n.height - p.y).toBeGreaterThanOrEqual(PORT_INSET - 1e-6);
      }
    }
  });

  it("folds items of unknown name onto one 'n:' port and still draws it", () => {
    const flows = [link("A", "B", null, null), link("A", "B", null, 5)];
    const l = layoutScene(scene(["A", "B"], flows), undefined, undefined, on);
    sane(l);
    expect(l.edges).toHaveLength(1);
  });

  it("lays out many items on one pair (past the cap) with every line on a port", () => {
    const flows = Array.from({ length: PORTS_MAX + 3 }, (_, i) => link("A", "B", `Item ${i}`, i + 1));
    const l = layoutScene(scene(["A", "B"], flows), undefined, undefined, on);
    sane(l);
    expect(l.edges).toHaveLength(PORTS_MAX + 3);
    expect(l.nodes.find((n) => n.key === "A")!.ports).toHaveLength(PORTS_MAX);
  });

  it("keeps a focused line findable by its item and lays out with ports", () => {
    const s = scene(["A", "B"], [link("A", "B", "Iron Plate"), link("A", "B", "Screw")]);
    const base = layoutScene(s, undefined, undefined, on);
    const target = base.edges.find((e) => e.flow.itemName === "Screw")!;
    const key = `${target.flow.from}|${target.flow.to}|${target.flow.carrier}|${target.flow.flow}|${target.flow.unit}|${target.flow.portItem}`;
    const l = layoutScene(s, undefined, { edgeKey: key, width: 300, height: 200 }, on);
    sane(l);
    const focused = l.edges.find((e) => e.flow.itemName === "Screw")!;
    const plain = l.edges.find((e) => e.flow.itemName === "Iron Plate")!;
    expect(focused.labelHeight).toBeGreaterThanOrEqual(0);
    expect(plain).toBeDefined();
  });

  it("never returns a placement across the flag, in either order, for the same scene", () => {
    const s = scene(["A", "B"], [link("A", "B", "Iron Plate"), link("A", "B", "Screw")]);
    for (const order of [[false, true, false], [true, false, true]]) {
      for (const flag of order) {
        const l = layoutScene(s, "topo", undefined, { ports: flag });
        expect(l.edges.length).toBe(flag ? 2 : 1);
        expect(l.nodes.every((n) => (n.ports !== undefined) === flag)).toBe(true);
      }
    }
  });

  it("separates two ports-on requests that differ only in one line's item", () => {
    const a = layoutScene(scene(["A", "B"], [link("A", "B", "Iron Plate")]), "t", undefined, on);
    const b = layoutScene(scene(["A", "B"], [link("A", "B", "Screw")]), "t", undefined, on);
    expect(a.edges[0].flow.portItem).not.toBe(b.edges[0].flow.portItem);
    expect(a.nodes[0].ports?.[0].item).not.toBe(b.nodes[0].ports?.[0].item);
  });
});
