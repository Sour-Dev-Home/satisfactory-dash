import { describe, expect, it } from "vitest";
import { capCandidates, capStops, marchingCaps } from "./capLayout";
import { CAP_MARCH_MAX } from "./marching";
import type { CapRate, DestinationCap } from "./capModel";
import { groupCard, type Card } from "./canvasScene";
import { CAP_BADGE_OVER, CAP_D, CAP_GAP, CAP_ROW_H, CAP_STUB, NODE_PAD_X, capRowWidth, capSlotAt, cardSize } from "./layoutSite";
import type { Stage, View } from "./viewport";

// ADR-0062 Decision 1: the caps on a laid-out canvas (which move, under their own budget, in view) and the card's footer row
// (one fixed row taller, so dagre and the router only see a bigger card).

const items = (ratePerMinute: number | null, quality: CapRate["quality"] = "measured"): CapRate => ({ unit: "items/min", ratePerMinute, quality });
const cap = (destination: string, rates: CapRate[], extra: Partial<DestinationCap> = {}): DestinationCap => ({ destination, count: 1, rates, ...extra });
const base: Card = groupCard({
  key: "g",
  kind: "machines",
  className: "Build_ConstructorMk1_C",
  name: "Constructor",
  recipe: "Iron Plate",
  count: 2,
  machineIds: [],
  stateCounts: {},
  products: [],
  ingredients: [],
  at: { x: 0, y: 0 },
  siteKey: "s",
  loop: false,
});
const node = (key: string, caps: DestinationCap[] | undefined, x = 0, y = 0) => ({ key, x, y, lines: base.lines, card: { ...base, key, label: `Card ${key}`, caps } });
const VIEW: View = { x: 0, y: 0, k: 1 };
const STAGE: Stage = { width: 800, height: 600 };

describe("the card's footer row (layoutSite)", () => {
  it("makes a card with caps exactly one cap row taller, and one without unchanged", () => {
    const plain = cardSize(base);
    const capped = cardSize({ ...base, caps: [cap("storage", [items(60)])] });
    expect(capped.height - plain.height).toBe(CAP_ROW_H);
    expect(cardSize({ ...base, caps: [] })).toEqual(plain);
  });

  it("is wide enough for its slots and the last badge, and places each slot's stub against its disc", () => {
    const kinds = ["storage", "depot", "sink", "power", "export"].map((d) => cap(d, [items(60)], { count: 120 }));
    const size = cardSize({ ...base, caps: kinds });
    // Five kinds draw four slots (three and a "+2").
    expect(capRowWidth(4)).toBe(4 * (CAP_STUB + CAP_D) + 3 * CAP_GAP + CAP_BADGE_OVER);
    expect(size.width).toBeGreaterThanOrEqual(capRowWidth(4) + 2 * NODE_PAD_X);
    const first = capSlotAt(0, 1);
    const second = capSlotAt(1, 1);
    expect(first.x0).toBe(NODE_PAD_X);
    expect(first.x1).toBe(first.cx - CAP_D / 2);
    expect(second.x0 - (first.cx + CAP_D / 2)).toBe(CAP_GAP);
    // The row is under the lines: one more line moves it down one line.
    expect(capSlotAt(0, 2).cy - first.cy).toBe(20);
  });
});

describe("capCandidates and marchingCaps: which caps move", () => {
  it("lists the caps that can move, fastest first then card order, leaving out unknown, stalled, zero and '+k' slots", () => {
    const nodes = [
      node("a", [cap("storage", [items(30)]), cap("sink", [items(null, "unknown")]), cap("depot", [items(600, "estimated")])]),
      node("b", [cap("storage", [items(200)], { stalled: "backedUp" }), cap("power", [items(0)]), cap("export", [items(150)])], 0, 200),
      node("c", undefined, 0, 400),
    ];
    const out = capCandidates(nodes);
    expect(out.map((c) => `${c.nodeKey}:${c.slot}:${c.step}:${c.quality}`)).toEqual(["a:2:fast:estimated", "b:2:mid:measured", "a:0:slow:measured"]);
    // Layout units: the card's corner plus the slot's place.
    const at = capSlotAt(2, base.lines.length);
    expect(out[0]).toMatchObject({ x0: at.x0, x1: at.x1, y: at.cy, width: 4, stroke: "stroke-muted" });
    expect(out[1].y).toBe(200 + at.cy);
    // A "+k" slot never moves: six kinds, the movers only among the first three.
    const six = capCandidates([node("d", ["storage", "depot", "sink", "power", "export", "unknown"].map((d) => cap(d, [items(60)])))]);
    expect(six.map((c) => c.slot)).toEqual([0, 1, 2]);
    // A group opened into its machines draws no caps.
    expect(capCandidates([{ ...nodes[0], card: { ...nodes[0].card, machines: { open: true, ids: ["x"], more: 0 } } }])).toEqual([]);
  });

  it("moves only caps in view, at most the budget, in the candidates' order", () => {
    const many = Array.from({ length: CAP_MARCH_MAX + 10 }, (_, i) => node(`n${i}`, [cap("storage", [items(60)])], 0, i * 10));
    const all = capCandidates(many);
    expect(marchingCaps(all, { x: 0, y: 0, k: 0.01 }, STAGE)).toHaveLength(CAP_MARCH_MAX);
    expect(marchingCaps(all, VIEW, STAGE, 5).map((c) => c.nodeKey)).toEqual(["n0", "n1", "n2", "n3", "n4"]);
    // Panned away: nothing in view moves.
    expect(marchingCaps(all, { x: -10_000, y: 0, k: 1 }, STAGE)).toEqual([]);
  });
});

describe("capStops: the keyboard's stops", () => {
  it("is one stop per drawn slot in the cards' order, named by the card and the cap's words", () => {
    const stops = capStops([node("a", [cap("storage", [items(48)]), cap("sink", [items(6, "estimated")])]), node("b", undefined), node("c", [cap("power", [])])]);
    expect(stops.map((s) => s.id)).toEqual(["0|a", "1|a", "0|c"]);
    expect(stops.map((s) => s.name)).toEqual(["Card a sends 48 items/min to storage", "Card a sends about 6 items/min to the Sink", "Card c sends 1 flow to power, rate unknown"]);
    const five = capStops([node("d", ["storage", "depot", "sink", "power", "export"].map((d) => cap(d, [items(60)])))]);
    expect(five).toHaveLength(4);
    expect(five[3].name).toMatch(/^Card d sends 2 more destinations \(1 flow to power, 1 flow leaving by station\), 2 flows$/);
  });
});
