import { describe, expect, it } from "vitest";
import { bundleFlows, type CanvasFlow } from "./canvasScene";
import { LABEL_LINE_H, PILL_HIT } from "./layoutSite";
import { TRANSPORT_W } from "./lineWidth";
import { END_LABEL_CLEAR, END_LABEL_ROW_GAP, PORT_D, PORT_INSET, PORT_PITCH, PORTS_MAX, portModel, portOffsets, portsHeight, portsPerCard, portTitle } from "./ports";

const flow = (from: string, to: string, itemName: string | null, ratePerMinute: number | null, extra: Partial<CanvasFlow> = {}): CanvasFlow => ({
  from,
  to,
  itemClassName: itemName === null ? null : `Desc_${itemName.replace(/ /g, "")}_C`,
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
const drawnOf = (flows: CanvasFlow[]) => bundleFlows(flows, true).map((b) => b.flow);

// ADR-0063 Decision 1.
describe("the port spacing", () => {
  it("fits two label rows round the widest line, their gaps and a clearance in one pitch", () => {
    expect(PORT_PITCH).toBeGreaterThanOrEqual(2 * LABEL_LINE_H + TRANSPORT_W + 2 * END_LABEL_ROW_GAP + END_LABEL_CLEAR);
  });

  it("keeps a port clear of the count badge and a pill's touch target", () => {
    expect(PORT_INSET).toBe(PILL_HIT / 2 + PORT_D / 2);
  });

  it("spreads n ports a pitch apart, centred on the edge, and sizes a card to hold them inset", () => {
    expect(portOffsets(1, 100)).toEqual([50]);
    expect(portOffsets(3, 200)).toEqual([100 - PORT_PITCH, 100, 100 + PORT_PITCH]);
    const h = portsHeight(3);
    const ys = portOffsets(3, h);
    expect(ys[0]).toBe(PORT_INSET);
    expect(h - ys[2]).toBe(PORT_INSET);
    expect(portsHeight(0)).toBe(0);
  });
});

describe("bundleFlows by item", () => {
  it("draws a line per item between the same two cards, each naming its item; with ports off, one line", () => {
    const flows = [flow("a", "b", "Iron Plate", 30), flow("a", "b", "Screw", 60), flow("a", "b", "Iron Plate", 10)];
    expect(bundleFlows(flows)).toHaveLength(1);
    const byItem = bundleFlows(flows, true);
    expect(byItem.map((b) => [b.flow.portItem, b.members])).toEqual([
      ["c:Desc_IronPlate_C", [0, 2]],
      ["c:Desc_Screw_C", [1]],
    ]);
    expect(byItem[0].flow.ratePerMinute).toBe(40);
  });

  it("keeps links of no known item on one '?' line", () => {
    const byItem = bundleFlows([flow("a", "b", null, null), flow("a", "b", null, 5)], true);
    expect(byItem).toHaveLength(1);
    expect(byItem[0].flow.portItem).toBe("n:");
  });
});

describe("portModel", () => {
  it("gives a card one port per item per side: out on the right, in on the left", () => {
    const drawn = drawnOf([flow("a", "b", "Iron Plate", 30), flow("a", "b", "Screw", 60), flow("c", "b", "Iron Plate", 10)]);
    const { ports, ends } = portModel(drawn, new Set());
    const at = (card: string) => ports.filter((p) => p.card === card).map((p) => `${p.side} ${p.dir} ${p.item} ${p.rate}`);
    expect(at("a")).toEqual(["r out c:Desc_IronPlate_C 30", "r out c:Desc_Screw_C 60"]);
    // Two sources of Iron Plate share b's one Iron Plate port, summed.
    expect(at("b").sort()).toEqual(["l in c:Desc_IronPlate_C 40", "l in c:Desc_Screw_C 60"]);
    expect(ends.map((e) => [e.srcSide, e.tgtSide])).toEqual([
      ["r", "l"],
      ["r", "l"],
      ["r", "l"],
    ]);
    expect(ends[0].tgt).toBe(ends[2].tgt);
    expect(ends[0].src).not.toBe(ends[1].src);
  });

  it("fans one item out of one port to several cards", () => {
    const { ports, ends } = portModel(drawnOf([flow("a", "b", "Iron Plate", 30), flow("a", "c", "Iron Plate", 30), flow("a", "d", "Iron Plate", 30)]), new Set());
    expect(new Set(ends.map((e) => e.src)).size).toBe(1);
    expect(ports.find((p) => p.id === ends[0].src)).toMatchObject({ rate: 90, flows: [0, 1, 2] });
  });

  it("puts a return flow's ends on the other sides, marked returning, apart from a forward port of the same item", () => {
    // a -> b forward, b -> a back, both Water.
    const { ports, ends } = portModel(drawnOf([flow("a", "b", "Water", 30), flow("b", "a", "Water", 10)]), new Set([1]));
    expect(ends[1]).toMatchObject({ srcSide: "l", tgtSide: "r" });
    const back = ports.filter((p) => p.flows.includes(1));
    expect(back.every((p) => p.returning)).toBe(true);
    // a's Water out (right, forward) and a's Water in (right, returning) are two ports on one edge.
    expect(ports.filter((p) => p.card === "a" && p.side === "r").map((p) => p.dir).sort()).toEqual(["in", "out"]);
  });

  it(`folds past ${PORTS_MAX} ports on an edge: the top ${PORTS_MAX - 1} by rate keep theirs, the rest share one '+N' port`, () => {
    const inputs = Array.from({ length: 7 }, (_, i) => flow(`s${i}`, "sink", `Item ${i}`, (i + 1) * 10));
    const { ports, ends } = portModel(drawnOf(inputs), new Set());
    const left = ports.filter((p) => p.card === "sink" && p.side === "l");
    expect(left).toHaveLength(PORTS_MAX);
    const fold = left.find((p) => p.item === "+")!;
    // The two lowest (Item 0 at 10, Item 1 at 20) fold, listed by rate.
    expect(fold.items.map((i) => i.name)).toEqual(["Item 1", "Item 0"]);
    expect(fold.rate).toBe(30);
    expect(ends[0].tgt).toBe(fold.id);
    expect(ends[1].tgt).toBe(fold.id);
    // The fold is per card: each source keeps its own port.
    expect(ends[0].src).not.toBe(fold.id);
    expect(portsPerCard({ ports, ends }).get("sink")).toBe(PORTS_MAX);
  });

  it("does not fold at exactly the cap", () => {
    const inputs = Array.from({ length: PORTS_MAX }, (_, i) => flow(`s${i}`, "sink", `Item ${i}`, 10));
    expect(portModel(drawnOf(inputs), new Set()).ports.some((p) => p.item === "+")).toBe(false);
  });

  it("names the summed rate of known parts only (an unknown rate counts as 0), and calls that sum 'at least'", () => {
    const { ports } = portModel(drawnOf([flow("a", "b", "Ore", null), flow("c", "b", "Ore", 12)]), new Set());
    const b = ports.find((p) => p.card === "b")!;
    expect(b.rate).toBe(12);
    expect(b.quality).toBe("atLeast");
  });
});

describe("portTitle", () => {
  it("says the item, the direction and the rate in words", () => {
    const p = portModel(drawnOf([flow("a", "b", "Iron Plate", 120)]), new Set()).ports[0];
    expect(portTitle({ ...p, unit: "items/min" })).toBe("Iron Plate out, 120 items/min");
    expect(portTitle({ ...p, dir: "in", quality: "unknown", unit: "items/min" })).toBe("Iron Plate in, rate unknown");
  });

  it("lists a fold's items, with a rate only when they share a unit", () => {
    const inputs = Array.from({ length: 7 }, (_, i) => flow(`s${i}`, "sink", `Item ${i}`, (i + 1) * 10));
    const fold = portModel(drawnOf(inputs), new Set()).ports.find((p) => p.item === "+")!;
    expect(portTitle({ ...fold, unit: "items/min" })).toBe("2 items in: Item 1, Item 0, 30 items/min");
    expect(portTitle({ ...fold, unit: null })).toBe("2 items in: Item 1, Item 0");
  });
});
