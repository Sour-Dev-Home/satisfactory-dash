import { describe, expect, it } from "vitest";
import {
  BUBBLE_D,
  BUBBLE_GAP,
  bubbleDetail,
  bubbleItems,
  bubbleName,
  bubbleOffsets,
  bubbleRow,
  bubbleStops,
  bubblesWidth,
  edgeKeyOf,
  itemRateText,
  stopId,
} from "./bubbleRow";
import { bundleFlows, type CanvasFlow } from "./canvasScene";
import { LABEL_LINE_H, LABEL_PAD, bubbleRowSize, labelWidth } from "./layoutSite";

const flow = (itemClassName: string | null, itemName: string | null, ratePerMinute: number | null, extra: Partial<CanvasFlow> = {}): CanvasFlow => ({
  from: "a",
  to: "b",
  itemClassName,
  itemName,
  carrier: "belt",
  flow: "supply",
  mixed: false,
  rate: ratePerMinute === null ? "unknown" : "measured",
  label: itemName ?? "Item unknown",
  labelLines: [itemName ?? "Item unknown"],
  ratePerMinute,
  unit: "items/min",
  quality: ratePerMinute === null ? "unknown" : "measured",
  ...extra,
});

// A flow standing for several links. `bundleFlows` bundles links of one item only, but `bubbleItems` reads whatever
// `parts` holds, so these build them directly to pin its merge and order.
const bundle = (...parts: CanvasFlow[]): CanvasFlow => ({ ...parts[0], parts });

describe("bubbleItems", () => {
  it("is the link's own item when the line draws one link", () => {
    expect(bubbleItems(flow("Desc_IronPlate_C", "Iron Plate", 30))).toEqual([{ key: "c:Desc_IronPlate_C", className: "Desc_IronPlate_C", name: "Iron Plate", text: "IP", rate: 30, quality: "measured" }]);
  });

  it("lists each distinct item once, by summed rate (highest first), then by name", () => {
    const items = bubbleItems(bundle(flow("Desc_A_C", "Alpha", 10), flow("Desc_B_C", "Beta", 20), flow("Desc_A_C", "Alpha", 15), flow("Desc_C_C", "Gamma", 20)));
    expect(items.map((i) => [i.className, i.rate])).toEqual([
      ["Desc_A_C", 25],
      ["Desc_B_C", 20],
      ["Desc_C_C", 20],
    ]);
  });

  it("folds links of no known item into one '?' bubble, ordered after named ones at the same rate", () => {
    const items = bubbleItems(bundle(flow(null, null, null), flow("Desc_A_C", "Alpha", null), flow(null, "", null)));
    expect(items).toEqual([
      { key: "c:Desc_A_C", className: "Desc_A_C", name: "Alpha", text: "A", rate: 0, quality: "unknown" },
      { key: "n:", className: null, name: null, text: "?", rate: 0, quality: "unknown" },
    ]);
  });

  it("counts a non-finite or unknown rate as 0, never NaN", () => {
    const items = bubbleItems(bundle(flow("Desc_A_C", "Alpha", Number.NaN, { quality: "measured" }), flow("Desc_B_C", "Beta", 1)));
    expect(items.map((i) => i.rate)).toEqual([1, 0]);
  });

  it("counts an Infinity rate as 0 too", () => {
    const items = bubbleItems(bundle(flow("Desc_A_C", "Alpha", Infinity), flow("Desc_B_C", "Beta", 1)));
    expect(items.map((i) => i.rate)).toEqual([1, 0]);
  });

  it("keeps a class and a classless item that share a string as two items", () => {
    const items = bubbleItems(bundle(flow("Ore", "Y", 5), flow(null, "Ore", 3)));
    expect(items.map((i) => [i.className, i.name])).toEqual([["Ore", "Y"], [null, "Ore"]]);
  });

  it("merges one class under two names into one bubble, keeping the first name", () => {
    const items = bubbleItems(bundle(flow("Desc_A_C", "Alpha", 1), flow("Desc_A_C", "Other", 2)));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Alpha", rate: 3 });
  });

  it("treats an empty class name like null", () => {
    expect(bubbleItems(bundle(flow("", "Alpha", 1), flow(null, "Alpha", 1)))).toHaveLength(1);
  });
});

describe("bubbleRow", () => {
  it("draws one bubble for a line of several links of one item, under their summed rate", () => {
    const [line] = bundleFlows([flow("Desc_A_C", "A", 10), flow("Desc_A_C", "A", 30)]);
    const row = bubbleRow(line.flow);
    expect(row.items.map((i) => [i.name, i.rate])).toEqual([["A", 40]]);
    expect(row.rateText).toBe("40/min");
  });

  it("draws the short rate only: mixed and excess stay in the words, and an unknown rate reads ?/min (ADR-0063 amendment)", () => {
    expect(bubbleRow(flow("Desc_A_C", "A", 5, { mixed: true, flow: "excess" })).rateText).toBe("5/min");
    expect(bubbleRow(flow("Desc_A_C", "A", null)).rateText).toBe("?/min");
  });
});

describe("bubbleDetail", () => {
  it("draws plain discs below zoom 0.4, and the 64 px icon once a 32 px one would stretch", () => {
    expect(bubbleDetail(0.39, 1)).toEqual({ full: false, iconSize: 32 });
    expect(bubbleDetail(0.4, 1)).toEqual({ full: true, iconSize: 32 });
    // The 36 px icon passes 32 screen px just under zoom 0.89 (32 / 36).
    expect(bubbleDetail(0.88, 1)).toEqual({ full: true, iconSize: 32 });
    expect(bubbleDetail(0.89, 1)).toEqual({ full: true, iconSize: 64 });
    expect(bubbleDetail(1, 1)).toEqual({ full: true, iconSize: 64 });
    expect(bubbleDetail(0.5, 2)).toEqual({ full: true, iconSize: 64 });
    expect(bubbleDetail(1, 2)).toEqual({ full: true, iconSize: 64 });
    expect(bubbleDetail(1.7, 1)).toEqual({ full: true, iconSize: 64 });
  });
});

describe("the row's geometry", () => {
  it("is as wide as its bubbles, with the gaps between", () => {
    expect(bubblesWidth({ items: [] })).toBe(0);
    const one = bubbleRow(flow("Desc_A_C", "A", 1));
    expect(bubblesWidth(one)).toBe(BUBBLE_D);
    expect(bubbleOffsets(one)).toEqual([BUBBLE_D / 2]);
    const three = { items: bubbleItems(bundle(flow("Desc_A_C", "A", 3), flow("Desc_B_C", "B", 2), flow("Desc_C_C", "C", 1))) };
    expect(bubblesWidth(three)).toBe(3 * BUBBLE_D + 2 * BUBBLE_GAP);
    const at = bubbleOffsets(three);
    expect(at).toEqual([BUBBLE_D / 2, BUBBLE_D * 1.5 + BUBBLE_GAP, BUBBLE_D * 2.5 + 2 * BUBBLE_GAP]);
    // The last bubble's right edge is the row's.
    expect(at[2] + BUBBLE_D / 2).toBe(bubblesWidth(three));
  });

  it("reserves a box for the bubbles over one line of rate text, as wide as the wider", () => {
    const row = bubbleRow(flow("Desc_A_C", "A", 123.4));
    expect(bubbleRowSize(row)).toEqual({ width: Math.max(BUBBLE_D + LABEL_PAD, labelWidth(row.rateText)), height: BUBBLE_D + LABEL_LINE_H + LABEL_PAD });
    // The text's row is kept for every line, an unknown one's "?/min" too: showing it on hover moves nothing.
    expect(bubbleRowSize(bubbleRow(flow("Desc_A_C", "A", null))).height).toBe(BUBBLE_D + LABEL_LINE_H + LABEL_PAD);
    const wide = bubbleRow(flow("Desc_A_C", "A", 1234567.8));
    expect(bubbleRowSize(wide).width).toBe(Math.max(BUBBLE_D + LABEL_PAD, labelWidth("1,234,567.8/min")));
  });
});

describe("item focus helpers (ADR-0060 build PR 3)", () => {
  it("rates each item by the weakest of its parts: 'at least' when one has no number", () => {
    const items = bubbleItems(bundle(flow("Desc_A_C", "A", 10), flow("Desc_A_C", "A", null), flow("Desc_B_C", "B", 5, { quality: "estimated", rate: "estimated" })));
    expect(items.map((i) => [i.key, i.rate, i.quality])).toEqual([
      ["c:Desc_A_C", 10, "atLeast"],
      ["c:Desc_B_C", 5, "estimated"],
    ]);
    expect(itemRateText(items[0], "items/min")).toBe("at least 10 items/min");
    expect(itemRateText(items[1], "items/min")).toBe("about 5 items/min");
    expect(itemRateText({ rate: 0, quality: "unknown" }, "items/min")).toBe("rate unknown");
  });

  it("keys a line by its ends, carrier, kind and item, so a reorder keeps it", () => {
    expect(edgeKeyOf(flow("Desc_A_C", "A", 1))).toBe("a|b|belt|supply|items/min");
    expect(edgeKeyOf(flow("Desc_A_C", "A", 1, { carrier: "truck", flow: "excess" }))).toBe("a|b|truck|excess|items/min");
    const [line] = bundleFlows([flow("Desc_A_C", "A", 1)]);
    expect(edgeKeyOf(line.flow)).toBe("a|b|belt|supply|items/min|c:Desc_A_C");
  });

  it("keeps an items line and a fluid line between the same cards, carrier and kind apart (as bundleFlows does)", () => {
    const items = flow("Desc_A_C", "A", 1);
    const fluid = flow("Desc_W_C", "Water", 1, { unit: "m3/min" });
    expect(bundleFlows([items, fluid])).toHaveLength(2);
    expect(edgeKeyOf(items)).not.toBe(edgeKeyOf(fluid));
    const ids = bubbleStops([items, fluid].map((f) => ({ flow: f, bubbles: bubbleRow(f) })), ["a", "b"]).map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("orders the stops by the cards' tab order, a stop per line's item", () => {
    const lines = bundleFlows([
      flow("Desc_0_C", "I0", 1, { from: "c", to: "a" }),
      flow("Desc_0_C", "I0", 10, { from: "a", to: "b" }),
      flow("Desc_1_C", "I1", 9, { from: "a", to: "b" }),
      flow("Desc_0_C", "I0", 1, { from: "a", to: "c" }),
    ]).map((b) => ({ flow: b.flow, bubbles: bubbleRow(b.flow) }));
    const stops = bubbleStops(lines, ["a", "b", "c"]);
    expect(stops.map((s) => s.id)).toEqual([
      stopId("a|b|belt|supply|items/min|c:Desc_0_C", "c:Desc_0_C"),
      stopId("a|b|belt|supply|items/min|c:Desc_1_C", "c:Desc_1_C"),
      stopId("a|c|belt|supply|items/min|c:Desc_0_C", "c:Desc_0_C"),
      stopId("c|a|belt|supply|items/min|c:Desc_0_C", "c:Desc_0_C"),
    ]);
  });

  it("names a bubble by its item, rate and ends, an unknown one 'Item unknown'", () => {
    const [plate] = bubbleItems(flow("Desc_IronPlate_C", "Iron Plate", 30));
    expect(bubbleName(plate, "items/min", "Smelters", "Constructors")).toBe("Iron Plate, 30 items/min, from Smelters to Constructors");
    const [unknown] = bubbleItems(flow(null, null, null));
    expect(bubbleName(unknown, "items/min", "A", "B")).toBe("Item unknown, rate unknown, from A to B");
  });
});
