import { describe, expect, it } from "vitest";
import {
  BUBBLE_D,
  BUBBLE_GAP,
  CHIP_W,
  bubbleDetail,
  bubbleItems,
  bubbleName,
  bubbleOffsets,
  bubbleRow,
  bubbleStops,
  bubblesWidth,
  chipName,
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

const bundle = (...parts: CanvasFlow[]): CanvasFlow => bundleFlows(parts)[0].flow;

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
  it("shows at most three bubbles, then counts the rest on the chip", () => {
    const row = bubbleRow(bundle(...["A", "B", "C", "D", "E"].map((n, i) => flow(`Desc_${n}_C`, n, 10 - i))));
    expect(row.items.map((i) => i.name)).toEqual(["A", "B", "C"]);
    expect(row.more).toBe(2);
    expect(row.rateText).toBe("40 items/min");
  });

  it("says mixed and excess beside the rate, and has no rate text when the rate is unknown", () => {
    expect(bubbleRow(flow("Desc_A_C", "A", 5, { mixed: true, flow: "excess" })).rateText).toBe("5 items/min · mixed · excess");
    expect(bubbleRow(flow("Desc_A_C", "A", null)).rateText).toBeNull();
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
  it("is as wide as its bubbles and chip, with the gaps between", () => {
    expect(bubblesWidth({ items: [], more: 0 })).toBe(0);
    expect(bubblesWidth(bubbleRow(flow("Desc_A_C", "A", 1)))).toBe(BUBBLE_D);
    const full = { items: bubbleItems(bundle(flow("Desc_A_C", "A", 3), flow("Desc_B_C", "B", 2), flow("Desc_C_C", "C", 1))), more: 4 };
    expect(bubblesWidth(full)).toBe(3 * BUBBLE_D + 3 * BUBBLE_GAP + CHIP_W);
    const at = bubbleOffsets(full);
    expect(at.bubbles).toEqual([BUBBLE_D / 2, BUBBLE_D * 1.5 + BUBBLE_GAP, BUBBLE_D * 2.5 + 2 * BUBBLE_GAP]);
    // The chip's right edge is the row's.
    expect(at.chip! + CHIP_W / 2).toBe(bubblesWidth(full));
    expect(bubbleOffsets({ items: full.items, more: 0 }).chip).toBeNull();
  });

  it("reserves a box for the bubbles over one line of rate text, as wide as the wider", () => {
    const row = bubbleRow(flow("Desc_A_C", "A", 123.4));
    expect(bubbleRowSize(row)).toEqual({ width: Math.max(BUBBLE_D + LABEL_PAD, labelWidth(row.rateText!)), height: BUBBLE_D + LABEL_LINE_H + LABEL_PAD });
    expect(bubbleRowSize({ ...row, rateText: null })).toEqual({ width: BUBBLE_D + LABEL_PAD, height: BUBBLE_D + LABEL_PAD });
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

  it("keeps every item in `all` and the first three in `items`", () => {
    const row = bubbleRow(bundle(...["A", "B", "C", "D"].map((n, i) => flow(`Desc_${n}_C`, n, 10 - i))));
    expect(row.all.map((i) => i.name)).toEqual(["A", "B", "C", "D"]);
    expect(row.items).toEqual(row.all.slice(0, 3));
  });

  it("keys a line by its ends, carrier and kind, so a reorder keeps it", () => {
    expect(edgeKeyOf(flow("Desc_A_C", "A", 1))).toBe("a|b|belt|supply|items/min");
    expect(edgeKeyOf(flow("Desc_A_C", "A", 1, { carrier: "truck", flow: "excess" }))).toBe("a|b|truck|excess|items/min");
  });

  it("keeps an items line and a fluid line between the same cards, carrier and kind apart (as bundleFlows does)", () => {
    const items = flow("Desc_A_C", "A", 1);
    const fluid = flow("Desc_W_C", "Water", 1, { unit: "m3/min" });
    expect(bundleFlows([items, fluid])).toHaveLength(2);
    expect(edgeKeyOf(items)).not.toBe(edgeKeyOf(fluid));
    const ids = bubbleStops([items, fluid].map((f) => ({ flow: f, bubbles: bubbleRow(f) })), ["a", "b"]).map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("orders the stops by the cards' tab order, each line's bubbles then its chip", () => {
    const line = (from: string, to: string, n: number) => {
      const f = bundle(...Array.from({ length: n }, (_, i) => flow(`Desc_${i}_C`, `I${i}`, 10 - i, { from, to })));
      return { flow: f, bubbles: bubbleRow(f) };
    };
    const stops = bubbleStops([line("c", "a", 1), line("a", "b", 4), line("a", "c", 1)], ["a", "b", "c"]);
    expect(stops.map((s) => s.id)).toEqual([
      stopId("a|b|belt|supply|items/min", "c:Desc_0_C"),
      stopId("a|b|belt|supply|items/min", "c:Desc_1_C"),
      stopId("a|b|belt|supply|items/min", "c:Desc_2_C"),
      stopId("a|b|belt|supply|items/min", null),
      stopId("a|c|belt|supply|items/min", "c:Desc_0_C"),
      stopId("c|a|belt|supply|items/min", "c:Desc_0_C"),
    ]);
  });

  it("names a bubble by its item, rate and ends, an unknown one 'Item unknown', and the chip by its count", () => {
    const [plate] = bubbleItems(flow("Desc_IronPlate_C", "Iron Plate", 30));
    expect(bubbleName(plate, "items/min", "Smelters", "Constructors")).toBe("Iron Plate, 30 items/min, from Smelters to Constructors");
    const [unknown] = bubbleItems(flow(null, null, null));
    expect(bubbleName(unknown, "items/min", "A", "B")).toBe("Item unknown, rate unknown, from A to B");
    expect(chipName(1, "A", "B")).toBe("1 more item from A to B");
    expect(chipName(4, "A", "B")).toBe("4 more items from A to B");
  });
});
