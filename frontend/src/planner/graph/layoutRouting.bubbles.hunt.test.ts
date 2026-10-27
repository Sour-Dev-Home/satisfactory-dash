import { beforeEach, describe, expect, it } from "vitest";
import { BUBBLE_D, bubblesWidth } from "./bubbleRow";
import type { Card, CanvasFlow, Scene } from "./canvasScene";
import { segmentHitsRect } from "./edgeShapes";
import { LABEL_PAD, clearLayoutMemo, layoutScene, layoutStats } from "./layoutSite";

beforeEach(clearLayoutMemo);

const card = (key: string): Card =>
  ({ key, kind: "group", nodeKeys: [key], title: key, lines: [key], count: 1, className: undefined, glyph: "machines", label: key, description: key, facts: [], loop: false, frame: undefined, bubbleKey: undefined }) as Card;
const link = (from: string, to: string, cls: string | null, name: string | null, rate: number | null, extra: Partial<CanvasFlow> = {}): CanvasFlow => ({
  from, to, itemClassName: cls, itemName: name, carrier: "belt", flow: "supply", mixed: false, rate: rate === null ? "unknown" : "measured",
  label: name ?? "Item unknown", labelLines: [name ?? "Item unknown"], ratePerMinute: rate, unit: "items/min", quality: rate === null ? "unknown" : "measured", ...extra,
});
const many = (from: string, to: string, n: number, extra: Partial<CanvasFlow> = {}) =>
  Array.from({ length: n }, (_, i) => link(from, to, `Desc_${i}_C`, `Item ${i}`, 10 + i, extra));
const scene = (cards: Card[], flows: CanvasFlow[]): Scene => ({ level: "site", name: "t", cards, frames: [], flows, bubbleKeys: [], foldKeys: [], hasStorage: false, openByDefault: true, noun: "groups" });
type R = { x: number; y: number; width: number; height: number };
const overlap = (a: R, b: R) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const lbl = (e: { labelX: number; labelY: number; labelWidth: number; labelHeight: number }): R => ({ x: e.labelX - e.labelWidth / 2, y: e.labelY - e.labelHeight / 2, width: e.labelWidth, height: e.labelHeight });

describe("hunt: bubble rows (ADR-0060 PR 2)", () => {
  const flows = [
    ...many("a", "b", 7),
    ...many("a", "b", 5, { carrier: "truck" }),
    ...many("b", "c", 4, { flow: "excess", mixed: true }),
    link("a", "c", null, null, null),
    link("a", "c", "", "", 5),
    ...many("c", "d", 2, { carrier: "train" }),
    ...many("d", "a", 3, { carrier: "pipe" }),
    link("a", "d", "Desc_X_C", "X", Number.NaN),
    link("b", "d", "Desc_Y_C", "Y", Infinity),
  ];
  const l = layoutScene(scene(["a", "b", "c", "d"].map(card), flows));

  it("no label overlaps a card, another label, or a foreign line", () => {
    expect(layoutStats().routerFailures).toBe(0);
    for (const e of l.edges) {
      for (const n of l.nodes) expect(overlap(lbl(e), n)).toBe(false);
      for (const o of l.edges) {
        if (o === e) continue;
        expect(overlap(lbl(e), lbl(o))).toBe(false);
        for (let i = 1; i < o.points.length; i++) expect(segmentHitsRect(o.points[i - 1], o.points[i], lbl(e))).toBe(false);
      }
    }
  });

  it("every bubble row sits inside its pill", () => {
    for (const e of l.edges) {
      const w = bubblesWidth(e.bubbles);
      expect(e.textX - w / 2).toBeGreaterThanOrEqual(e.labelX - e.labelWidth / 2 - 0.01);
      expect(e.textX + w / 2).toBeLessThanOrEqual(e.labelX + e.labelWidth / 2 + 0.01);
      expect(e.labelHeight).toBeGreaterThanOrEqual(BUBBLE_D + LABEL_PAD);
      expect(e.bubbles.items.length).toBeLessThanOrEqual(3);
    }
  });
});
