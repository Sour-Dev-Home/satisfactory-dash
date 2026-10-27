import { describe, expect, it } from "vitest";
import { BUBBLE_D, bubbleItems, bubbleOffsets, bubbleRow } from "./bubbleRow";
import { bundleFlows, type CanvasFlow } from "./canvasScene";
import { CARD_MAX_LINES, bubbleCentre, bubbleRowOrigin, fit, itemCardText } from "./itemCardText";
import { LABEL_PAD } from "./layoutSite";

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

describe("itemCardText (ADR-0060 Decision 4)", () => {
  it("names the item and says its rate, how sure it is, and where the line runs", () => {
    const f = flow("Desc_IronPlate_C", "Iron Plate", 30);
    const [plate] = bubbleItems(f);
    const text = itemCardText(plate, f, 0, "Smelters", "Constructors");
    expect(text.title).toBe("Iron Plate");
    expect(text.lines).toEqual(["30 items/min", "From Smelters", "To Constructors"]);
    expect(text.full).toBe("Iron Plate. 30 items/min. From Smelters. To Constructors");
  });

  it("says 'about' when estimated, 'at least' when a part has no rate, and 'Rate unknown' with no number", () => {
    const est = flow("Desc_A_C", "A", 12, { rate: "estimated", quality: "estimated" });
    expect(itemCardText(bubbleItems(est)[0], est, 0, "x", "y").lines[0]).toBe("about 12 items/min");
    const some = bundleFlows([flow("Desc_A_C", "A", 10), flow("Desc_A_C", "A", null)])[0].flow;
    expect(itemCardText(bubbleItems(some)[0], some, 0, "x", "y").lines[0]).toBe("at least 10 items/min");
    const none = flow("Desc_A_C", "A", null);
    expect(itemCardText(bubbleItems(none)[0], none, 0, "x", "y").lines[0]).toBe("Rate unknown");
  });

  it("names a transport and its route, and counts the other items on the line", () => {
    const f = flow("Desc_Coal_C", "Coal", 60, { carrier: "train", routeName: "Coal Run" });
    expect(itemCardText(bubbleItems(f)[0], f, 2, "Mine", "Plant").lines).toEqual(["60 items/min", "From Mine", "To Plant", "Train, route Coal Run", "2 other items here"]);
    expect(itemCardText(bubbleItems(f)[0], f, 1, "Mine", "Plant").lines.at(-1)).toBe("1 other item here");
  });

  it("never invents a name for an unknown item: 'Item unknown', with the raw class when the server sent one", () => {
    const classed = flow("Desc_Mystery_C", null, null);
    const a = itemCardText(bubbleItems(classed)[0], classed, 0, "x", "y");
    expect(a.title).toBe("Item unknown");
    expect(a.lines).toContain("Class Desc_Mystery_C");
    const bare = flow(null, null, null);
    const b = itemCardText(bubbleItems(bare)[0], bare, 0, "x", "y");
    expect(b.title).toBe("Item unknown");
    expect(b.lines).toContain("Not reported by the game");
    expect(b.full).not.toMatch(/Desc_/);
  });

  it("cuts long words to fit and keeps them whole in the full text; never more lines than fit", () => {
    const long = "A".repeat(80);
    const f = flow("Desc_A_C", long, 1, { carrier: "truck", routeName: "R".repeat(80) });
    const text = itemCardText(bubbleItems(f)[0], f, 3, "F".repeat(80), "T".repeat(80));
    expect(text.title.endsWith("…")).toBe(true);
    expect(text.title.length).toBeLessThan(long.length);
    for (const l of text.lines) expect(l.length).toBeLessThan(40);
    expect(text.lines.length).toBeLessThanOrEqual(CARD_MAX_LINES);
    expect(text.full).toContain(long);
    expect(text.full).toContain("R".repeat(80));
    expect(fit("short", 10)).toBe("short");
    expect(fit("abcdef", 4)).toBe("abc…");
  });
});

describe("bubbleCentre", () => {
  const edge = (f: CanvasFlow) => ({ labelX: 100, labelY: 50, labelHeight: 44, textX: 100, bubbles: bubbleRow(f) });

  it("is a shown bubble's centre, the row laid out as the label draws it", () => {
    const f = bundleFlows([flow("Desc_A_C", "A", 3), flow("Desc_B_C", "B", 2)])[0].flow;
    const e = edge(f);
    const { left, cy } = bubbleRowOrigin(e);
    expect(cy).toBe(50 - 22 + LABEL_PAD / 2 + BUBBLE_D / 2);
    expect(bubbleCentre(e, "c:Desc_B_C")).toEqual({ x: left + bubbleOffsets(e.bubbles).bubbles[1], y: cy });
  });

  it("is the chip's for an item only in the full list", () => {
    const f = bundleFlows(["A", "B", "C", "D"].map((n, i) => flow(`Desc_${n}_C`, n, 10 - i)))[0].flow;
    const e = edge(f);
    const { left, cy } = bubbleRowOrigin(e);
    expect(bubbleCentre(e, "c:Desc_D_C")).toEqual({ x: left + bubbleOffsets(e.bubbles).chip!, y: cy });
  });
});
