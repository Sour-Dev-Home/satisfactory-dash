import { describe, expect, it } from "vitest";
import { BUBBLE_D, BUBBLE_GAP, CHIP_W, bubbleDetail, bubbleItems, bubbleOffsets, bubbleRow, bubblesWidth } from "./bubbleRow";
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
    expect(bubbleItems(flow("Desc_IronPlate_C", "Iron Plate", 30))).toEqual([{ className: "Desc_IronPlate_C", name: "Iron Plate", text: "IP", rate: 30 }]);
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
      { className: "Desc_A_C", name: "Alpha", text: "A", rate: 0 },
      { className: null, name: null, text: "?", rate: 0 },
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
    expect(bubbleDetail(1, 1)).toEqual({ full: true, iconSize: 32 });
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
