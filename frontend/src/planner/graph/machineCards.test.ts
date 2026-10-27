import { beforeEach, describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type FactoryBuilding, type PlannerNode, type ProductionGraph } from "@satisfactory-dash/shared";
import { factoryMixed, productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { EMPTY_VIEW, MACHINES_FRAME_NOTE, MACHINES_MAX, factoryScene, groupMachines } from "./canvasScene";
import { factoryModels } from "./hierarchy";
import {
  FOCUS_LAYOUT_BUDGET_MS,
  MACHINE_CARD_H,
  MACHINE_CARD_W,
  MACHINE_LINE_CHARS,
  clearLayoutMemo,
  layoutScene,
  machineColumns,
  machineFrameSize,
  machineSlot,
  machineSlots,
} from "./layoutSite";
import { machineCardKey, machineCards } from "./machineCards";

const FIXTURE: ProductionGraph = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const SMELTER = FIXTURE.nodes.find((n) => n.className === "Build_SmelterMk1_C")!;

/** The fixture with the smelter group listing `ids` (and counting `count` machines). */
function withSmelter(ids: string[], count = SMELTER.count): ProductionGraph {
  return { ...FIXTURE, nodes: FIXTURE.nodes.map((n) => (n === SMELTER ? { ...n, machineIds: ids, count } : n)) };
}
const plate = (graph: ProductionGraph) => factoryModels(graph).find((m) => m.nodes.some((n) => n.key === SMELTER.key))!;
const opened = (graph: ProductionGraph) => factoryScene(graph, plate(graph), { ...EMPTY_VIEW, machinesOpen: new Set([SMELTER.key]) });

beforeEach(clearLayoutMemo);

describe("groupMachines", () => {
  it("is for a group of several machines with at least one id", () => {
    expect(groupMachines({ count: 1, machineIds: ["a"] }, false)).toBeUndefined();
    expect(groupMachines({ count: 3, machineIds: [] }, false)).toBeUndefined();
    expect(groupMachines({ count: 3, machineIds: ["a", "a", "b"] }, true)).toEqual({ open: true, ids: ["a", "b"], more: 1 });
  });

  it(`shows at most ${MACHINES_MAX} machines, the rest as "+k more"`, () => {
    const ids = Array.from({ length: 80 }, (_, i) => `m${i}`);
    const m = groupMachines({ count: 100, machineIds: ids }, true)!;
    expect(m.ids).toHaveLength(MACHINES_MAX);
    expect(m.more).toBe(100 - MACHINES_MAX);
  });
});

describe("an opened group in the factory scene", () => {
  it("is still one card, named as before, so the group's flows still join it (the frame)", () => {
    const graph = withSmelter(["s1", "s2", "s3"]);
    const closed = factoryScene(graph, plate(graph), EMPTY_VIEW);
    const open = opened(graph);
    const card = open.cards.find((c) => c.key === SMELTER.key)!;
    expect(closed.cards.find((c) => c.key === SMELTER.key)!.machines).toEqual({ open: false, ids: ["s1", "s2", "s3"], more: 1 });
    expect(card.machines).toEqual({ open: true, ids: ["s1", "s2", "s3"], more: 1 });
    expect(open.cards.map((c) => c.key)).toEqual(closed.cards.map((c) => c.key));
    expect(open.flows).toEqual(closed.flows);
    expect(open.flows.some((f) => f.from === SMELTER.key || f.to === SMELTER.key)).toBe(true);
    // Its words say what it shows and why the lines join the frame.
    expect(card.description).toContain("Opened into 3 machine cards and 1 more");
    expect(card.description).toContain(MACHINES_FRAME_NOTE);
    expect(closed.cards.find((c) => c.key === SMELTER.key)!.description).not.toContain(MACHINES_FRAME_NOTE);
  });

  it("is laid out as a frame round a grid of machine cards, and the lines still end on it", () => {
    const graph = withSmelter(["s1", "s2", "s3"], 8);
    const closed = layoutScene(factoryScene(graph, plate(graph), EMPTY_VIEW)).nodes.find((n) => n.key === SMELTER.key)!;
    const layout = layoutScene(opened(graph));
    const frame = layout.nodes.find((n) => n.key === SMELTER.key)!;
    const n = machineSlots(frame.card.machines!);
    expect(n).toBe(4);
    expect(frame.width).toBeGreaterThan(closed.width);
    expect(frame.height).toBeGreaterThan(closed.height);
    for (let i = 0; i < n; i++) {
      const at = machineSlot(i, n);
      expect(at.x + MACHINE_CARD_W).toBeLessThanOrEqual(frame.width);
      expect(at.y + MACHINE_CARD_H).toBeLessThanOrEqual(frame.height);
    }
    const touching = layout.edges.filter((e) => e.flow.from === SMELTER.key || e.flow.to === SMELTER.key);
    expect(touching.length).toBeGreaterThan(0);
    for (const e of touching) {
      const end = e.flow.to === SMELTER.key ? e.points[e.points.length - 1] : e.points[0];
      const onX = end.x >= frame.x - 1 && end.x <= frame.x + frame.width + 1;
      const onY = end.y >= frame.y - 1 && end.y <= frame.y + frame.height + 1;
      expect(onX && onY).toBe(true);
    }
  });

  it("keeps a frame of the full cap within the layout budget (it is one card to dagre)", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `m${i}`);
    const layout = layoutScene(opened(withSmelter(ids, 500)));
    const frame = layout.nodes.find((n) => n.key === SMELTER.key)!;
    expect(machineSlots(frame.card.machines!)).toBe(MACHINES_MAX + 1);
    expect(machineColumns(MACHINES_MAX + 1)).toBe(7);
    expect(frame.width).toBe(machineFrameSize(MACHINES_MAX + 1, frame.card.title.length).width);
    expect(layout.placeMs).toBeLessThan(FOCUS_LAYOUT_BUDGET_MS * 10);
  });
});

describe("machineCards", () => {
  const base = factoryMixed.data.buildings[0];
  const building = (id: string, extra: Partial<FactoryBuilding> = {}): FactoryBuilding => ({
    ...base,
    id,
    name: "Smelter",
    state: "producing",
    clockSpeedPercent: 100,
    production: [{ className: "Desc_IronIngot_C", name: "Iron Ingot", unit: "items/min", currentPerMinute: 30, maxPerMinute: 30, percent: 100 }],
    ...extra,
  });

  it("words a machine from the Factory read: its name, state with clock, and output", () => {
    const cards = machineCards(SMELTER, { ids: ["s1", "s2"], more: 0 }, [building("s1"), building("s2", { state: "underfed", clockSpeedPercent: 150 })]);
    expect(cards.map((c) => c.lines)).toEqual([
      ["Smelter", "Producing", "Iron Ingot: 30 / 30 items/min".slice(0, MACHINE_LINE_CHARS - 1) + "…"],
      ["Smelter", "Underfed · Clock 150%", "Iron Ingot: 30 / 30 items/min".slice(0, MACHINE_LINE_CHARS - 1) + "…"],
    ]);
    expect(cards[1].full).toBe("Smelter, machine 2 of 4: Underfed · Clock 150%. Iron Ingot: 30 / 30 items/min");
    expect(cards.map((c) => c.key)).toEqual([machineCardKey(SMELTER.key, "s1"), machineCardKey(SMELTER.key, "s2")]);
    expect(cards[0].mutedState).toBe(false);
  });

  it("words a machine the read does not hold from its group, never with a rate of its own", () => {
    const generator: PlannerNode = { ...SMELTER, name: "Coal-Powered Generator", role: "power", count: 8, products: [], ingredients: [{ className: "Desc_Coal_C", name: "Coal", unit: "items/min", currentPerMinute: 120, maxPerMinute: 120 }] };
    const [card] = machineCards(generator, { ids: ["g1"], more: 7 }, []);
    expect(card.lines).toEqual(["Coal-Powered Generator", "State not read", "Fuel: Coal"]);
    expect(card.full).toBe("Coal-Powered Generator, machine 1 of 8: State not read. Fuel: Coal. Not in the factory read: its rate is read per group");
    expect(card.mutedState).toBe(true);
    expect(machineCards({ ...SMELTER, role: undefined, products: [], ingredients: [] }, { ids: ["x"], more: 0 }, [])[0].lines[2]).toBe("No output data");
    expect(machineCards(SMELTER, { ids: ["x"], more: 0 }, [])[0].lines[2]).toBe("Makes Iron Ingot");
  });

  it('says it is reading while the Factory read has not answered, and ends with a "+k more" card', () => {
    const cards = machineCards(SMELTER, { ids: ["s1"], more: 3 }, undefined);
    expect(cards[0].lines[1]).toBe("Reading machines…");
    expect(cards[1]).toMatchObject({ id: null, key: machineCardKey(SMELTER.key, null), lines: ["+3 more machines", "Open the group panel", ""] });
  });

  it("cuts a long name to the card and keeps the whole of it in the button's words", () => {
    const long = "A".repeat(40);
    const [card] = machineCards(SMELTER, { ids: ["s1"], more: 0 }, [building("s1", { name: long })]);
    expect(card.lines[0]).toHaveLength(MACHINE_LINE_CHARS);
    expect(card.full.startsWith(long)).toBe(true);
  });
});
