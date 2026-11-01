import { beforeEach, describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type PlannerNode, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { EMPTY_VIEW, factoryScene, groupCard, type CanvasFlow, type Scene } from "./canvasScene";
import { factoryModels } from "./hierarchy";
import { BUBBLE_D, CHIP_H, CHIP_W, bubbleOffsets } from "./bubbleRow";
import { motionPathAround, piecesOutside } from "./edgeShapes";
import { bubbleRowOrigin } from "./itemCardText";
import { LABEL_PAD, clearLayoutMemo, labelBox, labelWidth, layoutScene, type LaidEdge } from "./layoutSite";
import { GLYPH_HALO_RADIUS } from "./transportModes";

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
const inside = (p: { x: number; y: number }, b: Box) => p.x > b.x + 1e-6 && p.x < b.x + b.width - 1e-6 && p.y > b.y + 1e-6 && p.y < b.y + b.height - 1e-6;
/** Every point a path string names (its M, L and arc ends). */
const pointsOf = (d: string) => [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)(?= |$|[MLA])/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

beforeEach(clearLayoutMemo);

describe("piecesOutside", () => {
  const box = { x: 40, y: -10, width: 20, height: 20 };

  it("cuts a line that crosses the box into the part before it and the part after", () => {
    expect(piecesOutside([{ x: 0, y: 0 }, { x: 100, y: 0 }], box)).toEqual([
      [{ x: 0, y: 0 }, { x: 40, y: 0 }],
      [{ x: 60, y: 0 }, { x: 100, y: 0 }],
    ]);
  });

  it("keeps a path that never enters the box whole, and drops one wholly inside it", () => {
    const away = [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 90 }];
    expect(piecesOutside(away, box)).toEqual([away]);
    expect(piecesOutside([{ x: 45, y: 0 }, { x: 55, y: 0 }], box)).toEqual([]);
  });

  it("follows the bends of an orthogonal route through the box", () => {
    const route = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 120, y: 100 }];
    const pieces = piecesOutside(route, box);
    expect(pieces).toEqual([
      [{ x: 0, y: 0 }, { x: 40, y: 0 }],
      [{ x: 50, y: 10 }, { x: 50, y: 100 }, { x: 120, y: 100 }],
    ]);
  });

  it("leaves no sliver shorter than half a unit", () => {
    expect(piecesOutside([{ x: 39.8, y: 0 }, { x: 100, y: 0 }], box)).toEqual([[{ x: 60, y: 0 }, { x: 100, y: 0 }]]);
  });
});

describe("motionPathAround", () => {
  it("jumps the label box grown by the glyph's radius with a moveto, and never names a point inside it", () => {
    const box = { x: 90, y: -20, width: 40, height: 30 };
    const d = motionPathAround([{ x: 0, y: 0 }, { x: 300, y: 0 }], box, GLYPH_HALO_RADIUS)!;
    expect(d.match(/M/g)).toHaveLength(2);
    const grown = { x: box.x - GLYPH_HALO_RADIUS, y: box.y - GLYPH_HALO_RADIUS, width: box.width + 2 * GLYPH_HALO_RADIUS, height: box.height + 2 * GLYPH_HALO_RADIUS };
    for (const p of pointsOf(d)) expect(inside(p, grown)).toBe(false);
    expect(d).toBe("M0 0 L76 0 M144 0 L300 0");
  });

  it("is null when the whole route lies in the box (the glyph then stays at rest)", () => {
    expect(motionPathAround([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: -5, y: -5, width: 20, height: 10 }, 2)).toBeNull();
  });
});

const FIXTURE: ProductionGraph = ProductionGraphResponseSchema.parse(productionGraphFactories).data;

/** Two groups joined by a train carrying `items` distinct items (one bundle, one label). */
function trainScene(items: number, rateText = true): Scene {
  const node = (key: string): PlannerNode => ({
    key,
    kind: "machines",
    className: "Build_ConstructorMk1_C",
    name: "Constructor",
    recipe: "Iron Plate",
    count: 2,
    machineIds: [`${key}1`, `${key}2`],
    stateCounts: { producing: 2 },
    products: [],
    ingredients: [],
    at: { x: 0, y: 0 },
    siteKey: "s",
    loop: false,
  });
  const flow = (i: number): CanvasFlow => ({
    from: "a",
    to: "b",
    itemClassName: `Desc_Item${i}_C`,
    itemName: `Item ${i}`,
    carrier: "train",
    flow: "supply",
    mixed: false,
    rate: rateText ? "measured" : "unknown",
    label: `Item ${i}`,
    labelLines: [`Item ${i}`],
    ratePerMinute: rateText ? 1000 + i : null,
    unit: "items/min",
    quality: rateText ? "measured" : "unknown",
  });
  return {
    level: "factory",
    name: "Trains",
    cards: [groupCard(node("a")), groupCard(node("b"))],
    frames: [],
    flows: Array.from({ length: items }, (_, i) => flow(i)),
    bubbleKeys: [],
    foldKeys: [],
    hasStorage: false,
    openByDefault: true,
    noun: "group",
  };
}

/** The glyph's halo at rest, each bubble (and the chip) and the rate text, as boxes. */
function restBoxes(e: LaidEdge) {
  const glyph = { x: e.mid.x - GLYPH_HALO_RADIUS, y: e.mid.y - GLYPH_HALO_RADIUS, width: 2 * GLYPH_HALO_RADIUS, height: 2 * GLYPH_HALO_RADIUS };
  const { left, cy } = bubbleRowOrigin(e);
  const at = bubbleOffsets(e.bubbles);
  const bubbles = at.bubbles.map((x) => ({ x: left + x - BUBBLE_D / 2, y: cy - BUBBLE_D / 2, width: BUBBLE_D, height: BUBBLE_D }));
  if (at.chip !== null) bubbles.push({ x: left + at.chip - CHIP_W / 2, y: cy - CHIP_H / 2, width: CHIP_W, height: CHIP_H });
  const top = e.labelY - e.labelHeight / 2 + LABEL_PAD / 2;
  const text = e.bubbles.rateText === null ? null : { x: e.textX - labelWidth(e.bubbles.rateText) / 2, y: top + BUBBLE_D, width: labelWidth(e.bubbles.rateText), height: 16 };
  return { glyph, bubbles, text };
}

describe("a transport glyph at rest", () => {
  it.each([1, 2, 3, 5])("stands inside its pill and clear of the bubbles and the rate text (%i items)", (items) => {
    for (const withRate of [true, false]) {
      const e = layoutScene(trainScene(items, withRate)).edges[0];
      const { glyph, bubbles, text } = restBoxes(e);
      const pill = labelBox(e);
      expect(glyph.x).toBeGreaterThanOrEqual(pill.x);
      expect(glyph.y).toBeGreaterThanOrEqual(pill.y - 0.01);
      for (const b of bubbles) expect(overlap(glyph, b)).toBe(false);
      if (text !== null) expect(overlap(glyph, text)).toBe(false);
    }
  });

  it("holds on the fixture factory's trains too", () => {
    const layout = layoutScene(factoryScene(FIXTURE, factoryModels(FIXTURE)[0], EMPTY_VIEW), FIXTURE.topologyHash);
    const trains = layout.edges.filter((e) => e.flow.carrier === "train");
    expect(trains.length).toBeGreaterThan(0);
    for (const e of trains) for (const b of restBoxes(e).bubbles) expect(overlap(restBoxes(e).glyph, b)).toBe(false);
  });

  it("rides a motion path that skips its own label box", () => {
    const e = layoutScene(trainScene(3)).edges[0];
    const d = motionPathAround(e.points, labelBox(e), GLYPH_HALO_RADIUS + 1);
    // The router runs the line through its label, so the path has to be cut there.
    expect(d).not.toBeNull();
    const pill = labelBox(e);
    const grown = { x: pill.x - GLYPH_HALO_RADIUS, y: pill.y - GLYPH_HALO_RADIUS, width: pill.width + 2 * GLYPH_HALO_RADIUS, height: pill.height + 2 * GLYPH_HALO_RADIUS };
    for (const p of pointsOf(d!)) expect(inside(p, grown)).toBe(false);
  });
});
