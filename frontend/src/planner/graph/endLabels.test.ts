import { beforeEach, describe, expect, it } from "vitest";
import * as demoWorld from "../../demo/world";
import { siteScene, type CanvasFlow, type Card, type Scene } from "./canvasScene";
import { END_LABEL_GAP, END_LABEL_NAME_CHARS, ROW_OFFSET, bandWidth, endLabelFit, endLabelWidth, endLabelWords, placeEndLabel } from "./endLabels";
import { LABEL_LINE_H, clearLayoutMemo, layoutScene, type LaidEdge, type SiteLayout } from "./layoutSite";
import { TRANSPORT_W } from "./lineWidth";
import { END_LABEL_CLEAR, END_LABEL_ROW_GAP, PORT_D, PORT_PITCH } from "./ports";

beforeEach(clearLayoutMemo);

// ADR-0063 build PR 3: end labels and the middle bubble as the fallback (Decision 2).

describe("endLabelWords", () => {
  const port = (name: string | null, rate: number, quality: "measured" | "estimated" | "unknown" = "measured") => ({ item: "c:X", items: [{ name }], rate, quality, unit: "items/min" as const });

  it("names the item and its rate in the canvas's short form", () => {
    expect(endLabelWords(port("Iron Plate", 120))).toEqual({ name: "Iron Plate", fullName: "Iron Plate", rate: "120/min" });
    expect(endLabelWords(port("Iron Plate", 120, "estimated")).rate).toBe("~120/min");
    expect(endLabelWords(port("Iron Plate", 0, "unknown")).rate).toBe("?/min");
    expect(endLabelWords({ ...port("Water", 30), unit: "m3/min" }).rate).toBe("30 m³/min");
  });

  it(`cuts a long name at ${END_LABEL_NAME_CHARS} characters, keeping the whole name for the title`, () => {
    const w = endLabelWords(port("Encased Industrial Beam", 4));
    expect(w.name).toHaveLength(END_LABEL_NAME_CHARS);
    expect(w.name.endsWith("…")).toBe(true);
    expect(w.fullName).toBe("Encased Industrial Beam");
  });

  it("says 'Item unknown' with no name, and '+N items' for a fold (no rate when its units differ)", () => {
    expect(endLabelWords(port(null, 5)).name).toBe("Item unknown");
    const fold = { item: "+", items: [{ name: "Screw" }, { name: "Water" }], rate: 40, quality: "measured" as const, unit: null };
    expect(endLabelWords(fold)).toEqual({ name: "+2 items", fullName: "Screw, Water", rate: "" });
  });
});

describe("placing a label", () => {
  it("puts the name above the line and the rate below, outside the card beside the disc", () => {
    const words = { name: "Iron Plate", fullName: "Iron Plate", rate: "120/min" };
    const right = placeEndLabel({ x: 100, y: 50 }, "r", words);
    expect(right.anchor).toBe("start");
    expect(right.x).toBe(100 + PORT_D / 2 + END_LABEL_GAP);
    expect(right.nameY).toBeLessThan(50);
    expect(right.rateY).toBeGreaterThan(50);
    const left = placeEndLabel({ x: 100, y: 50 }, "l", words);
    expect(left.anchor).toBe("end");
    expect(left.box.x + left.box.width).toBe(100 - PORT_D / 2 - END_LABEL_GAP);
  });

  it("keeps the labels of two ports on one edge apart: a pitch holds both rows round the widest line and a clearance", () => {
    // The rows' outer edges sit ROW_OFFSET + half a row from the line; the next port's are a pitch down.
    expect(2 * (ROW_OFFSET + LABEL_LINE_H / 2)).toBeLessThanOrEqual(PORT_PITCH - END_LABEL_CLEAR + 1e-9);
    expect(ROW_OFFSET).toBe(TRANSPORT_W / 2 + END_LABEL_ROW_GAP + LABEL_LINE_H / 2);
  });

  it("sizes a band from the disc's half, a gap, the widest label and a gap; none without ports", () => {
    expect(bandWidth([])).toBe(0);
    expect(bandWidth([30, 50])).toBe(PORT_D / 2 + END_LABEL_GAP + 50 + END_LABEL_GAP);
  });
});

describe("endLabelFit", () => {
  const words = new Map([
    ["a:r", { name: "Plate", fullName: "Plate", rate: "20/min" }],
    ["b:l", { name: "Plate", fullName: "Plate", rate: "20/min" }],
  ]);
  const node = (key: string, x: number, side: "l" | "r") => ({ key, x, y: 0, width: 100, height: 64, ports: [{ id: `${key}:${side}`, side, x: side === "r" ? 100 : 0, y: 32 }] as never });
  const edge = (points: { x: number; y: number }[]): Pick<LaidEdge, "index" | "points" | "srcPort" | "tgtPort" | "labelX" | "labelY" | "labelWidth" | "labelHeight"> => ({
    index: 0, points, srcPort: "a:r", tgtPort: "b:l", labelX: (points[0].x + points[points.length - 1].x) / 2, labelY: 200, labelWidth: 20, labelHeight: 10,
  });

  it("gives a long straight line both its end labels", () => {
    const fit = endLabelFit([node("a", 0, "r"), node("b", 400, "l")], [edge([{ x: 100, y: 32 }, { x: 390, y: 32 }])], words);
    expect([...fit.labels.keys()].sort()).toEqual(["a:r", "b:l"]);
    expect(fit.lines.has(0)).toBe(true);
  });

  it("falls back to the middle bubble when the cards are too close for a label at each end", () => {
    const w = endLabelWidth(words.get("a:r")!);
    const gap = PORT_D / 2 + END_LABEL_GAP + w / 2; // room for half a label at each end only
    const fit = endLabelFit([node("a", 0, "r"), node("b", 100 + gap, "l")], [edge([{ x: 100, y: 32 }, { x: 100 + gap - PORT_D / 2, y: 32 }])], words);
    expect(fit.lines.has(0)).toBe(false);
  });

  it("drops a port's label when its line turns before the label's end (the leg is too short)", () => {
    const fit = endLabelFit(
      [node("a", 0, "r"), node("b", 400, "l")],
      [edge([{ x: 100, y: 32 }, { x: 110, y: 32 }, { x: 110, y: 300 }, { x: 390, y: 300 }])],
      words,
    );
    expect(fit.labels.has("a:r")).toBe(false);
    expect(fit.lines.has(0)).toBe(false);
  });

  it("drops a label that another line runs through", () => {
    const crossing = { ...edge([{ x: 140, y: -100 }, { x: 140, y: 200 }]), index: 1, srcPort: undefined, tgtPort: undefined, labelY: 500 };
    const fit = endLabelFit([node("a", 0, "r"), node("b", 400, "l")], [edge([{ x: 100, y: 32 }, { x: 390, y: 32 }]), crossing], words);
    expect(fit.labels.has("a:r")).toBe(false);
    expect(fit.labels.has("b:l")).toBe(true);
    expect(fit.lines.has(0)).toBe(false);
  });
});

describe("end labels in the layout", () => {
  const card = (key: string): Card => ({
    key, kind: "factory", nodeKeys: [key], title: key, lines: [key, "Product · 0/min"], count: 6, className: undefined, glyph: "machines",
    label: key, description: key, facts: [], loop: false, frame: undefined, bubbleKey: undefined,
  });
  const link = (from: string, to: string, itemName: string, ratePerMinute: number): CanvasFlow => ({
    from, to, itemClassName: `Desc_${itemName.replace(/ /g, "")}_C`, itemName, carrier: "belt", flow: "supply", mixed: false, rate: "measured",
    label: itemName, labelLines: [itemName], ratePerMinute, unit: "items/min", quality: "measured",
  });
  const chain: Scene = {
    level: "overview", name: "Factories", frames: [], bubbleKeys: [], foldKeys: [], hasStorage: false, openByDefault: true, noun: "factories",
    cards: ["A", "B", "C"].map(card),
    flows: [link("A", "B", "Iron Plate", 30), link("A", "B", "Screw", 60), link("B", "C", "Rotor", 5)],
  };
  const boxOf = (n: { x: number; y: number; width: number; height: number }) => n;
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const labelsOf = (l: SiteLayout) => l.nodes.flatMap((n) => (n.ports ?? []).flatMap((p) => (p.label === undefined ? [] : [{ id: p.id, box: p.label.box }])));
  const demoIron = () => {
    const g = demoWorld.productionGraph(demoWorld.DEMO_EPOCH).data;
    return { scene: siteScene(g.sites.find((s) => s.name === "Iron works")!, g), hash: g.topologyHash };
  };

  it("draws both end labels on a plain chain's lines, and no middle bubble for them", () => {
    const l = layoutScene(chain, undefined, undefined, { ports: true });
    expect(l.edges.every((e) => e.endLabels !== undefined)).toBe(true);
  });

  it("never lets a label meet a card or another label, here and on the demo's iron works", () => {
    for (const l of [layoutScene(chain, undefined, undefined, { ports: true }), layoutScene(demoIron().scene, demoIron().hash, undefined, { ports: true })]) {
      const labels = labelsOf(l);
      for (const { id, box } of labels) {
        for (const n of l.nodes) expect(overlap(box, boxOf(n)), `${id} on ${n.key}`).toBe(false);
        for (const o of labels) if (o.id !== id) expect(overlap(box, o.box), `${id} on ${o.id}`).toBe(false);
      }
    }
  });

  it("records how many of the demo's lines draw end labels, and how much wider the picture is", () => {
    const { scene, hash } = demoIron();
    const off = layoutScene(scene, hash);
    clearLayoutMemo();
    const on = layoutScene(scene, hash, undefined, { ports: true });
    const labelled = on.edges.filter((e) => e.endLabels !== undefined).length;
    console.info(`[ADR-0063 end labels] demo iron works: ${labelled} of ${on.edges.length} lines draw end labels; width ${Math.round(off.width)} to ${Math.round(on.width)} (ports off to on)`);
    expect(labelled).toBeGreaterThan(0);
  });

  it("draws no end labels with ports off", () => {
    const l = layoutScene(chain);
    expect(l.edges.every((e) => e.endLabels === undefined)).toBe(true);
  });
});
