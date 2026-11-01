import { describe, expect, it } from "vitest";
import type { PlannerEdge, PlannerNode, PlannerRate, ProductionGraph } from "@satisfactory-dash/shared";
import type { AggregateFlow, ConnectionRow } from "./graph/hierarchy";
import { factoryConnections, groupConnections, neighboursOf, stalledGroups } from "./outlineModel";

// ADR-0062 amendment Decision 7: the outline's rate phrases name the step its line on the canvas shows, and nothing for an
// unknown rate or a flow out of a stalled card that was not measured moving.

const rate = (current: number, max: number): PlannerRate => ({ className: "Desc_IronIngot_C", name: "Iron Ingot", unit: "items/min", currentPerMinute: current, maxPerMinute: max });
const node = (key: string, over: Partial<PlannerNode> = {}): PlannerNode => ({
  key,
  kind: "machines",
  className: "Build_SmelterMk1_C",
  name: `Smelter ${key}`,
  recipe: "Iron Ingot",
  count: 2,
  machineIds: [`m-${key}`],
  stateCounts: { producing: 2 },
  products: [rate(30, 30)],
  ingredients: [],
  at: { x: 0, y: 0 },
  siteKey: "s",
  loop: false,
  ...over,
});
const edge = (from: string, to: string, ratePerMinute: number | null, over: Partial<PlannerEdge> = {}): PlannerEdge => ({
  from,
  to,
  kind: "belt",
  itemClassName: "Desc_IronIngot_C",
  itemName: "Iron Ingot",
  ratePerMinute,
  rate: ratePerMinute === null ? "unknown" : "measured",
  mixed: false,
  capacityPerMinute: null,
  conveyorCount: 1,
  ...over,
});
const graphOf = (nodes: PlannerNode[], edges: PlannerEdge[]) => ({ nodes, edges, transports: [], sites: [] }) as unknown as ProductionGraph;
const row = (from: string, ratePerMinute: number | null, over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  key: `${from}>z`,
  from,
  to: "z",
  itemClassName: "Desc_IronIngot_C",
  itemName: "Iron Ingot",
  mixed: false,
  itemFrom: undefined,
  ratePerMinute,
  rate: ratePerMinute === null ? "unknown" : "measured",
  unit: "items/min",
  capacityPerMinute: null,
  carrier: "belt",
  carriers: null,
  routeName: null,
  flow: "supply",
  destination: undefined,
  ...over,
});
const backedUp = node("b", { stateCounts: { backedUp: 2 }, products: [rate(0, 60)] });

describe("the outline's step words", () => {
  it("adds the step word to each neighbour's rate, in its own unit", () => {
    const pipe = edge("a", "c", 300, { kind: "pipe", itemClassName: "Desc_Water_C", itemName: "Water", rate: "estimated" });
    const { sends, gets } = neighboursOf(graphOf([node("a"), node("c")], [edge("a", "c", 60), pipe]));
    expect(sends.get("a")!.map((n) => n.rate)).toEqual(["60 items/min, slow", "about 300 m³/min, medium"]);
    expect(gets.get("c")!.map((n) => n.rate)).toEqual(["60 items/min, slow", "about 300 m³/min, medium"]);
  });

  it("names no step for an unknown rate, nor for a stalled group's flows unless measured moving", () => {
    const g = graphOf([node("a"), backedUp, node("c")], [edge("a", "c", null), edge("b", "c", 200, { rate: "estimated" }), edge("b", "a", 500)]);
    const { sends } = neighboursOf(g);
    expect(sends.get("a")!.map((n) => n.rate)).toEqual(["unknown"]);
    // Estimated out of a backed-up group: its line is stalled and still, so no step. Measured above 0: it moves, fast.
    expect(new Map(sends.get("b")!.map((n) => [n.key, n.rate]))).toEqual(new Map([["c", "about 200 items/min"], ["a", "500 items/min, fast"]]));
  });

  it("finds the stalled groups by the canvas's rule: the first product reads 0 and every machine shares a stalled state", () => {
    const mixed = node("m", { stateCounts: { backedUp: 1, producing: 1 }, products: [rate(0, 60)] });
    const running = node("r", { stateCounts: { backedUp: 2 }, products: [rate(30, 60)] });
    expect([...stalledGroups([backedUp, mixed, running, node("a")])]).toEqual([["b", "backedUp"]]);
  });

  it("adds the step word to the connections table's Rate, and sorts by the number alone", () => {
    const labelOf = (key: string) => key;
    const rows = groupConnections([row("a", 480), row("b", 120, { rate: "estimated" }), row("a", null)], labelOf, stalledGroups([backedUp]));
    // "b" is backed up and its row estimated: still, no step.
    expect(rows.map((r) => r.rate)).toEqual(["480 items/min, fast", "about 120 items/min", "unknown"]);
    expect(rows.map((r) => r.rateSort)).toEqual([480, 120, null]);
    expect(groupConnections([row("b", 120, { rate: "estimated" })], labelOf).map((r) => r.rate)).toEqual(["about 120 items/min, medium"]);
  });

  it("names no step for a 0 rate (the line does not move), measured or not, even from a stalled group", () => {
    const g = graphOf([node("a"), backedUp, node("c")], [edge("a", "c", 0), edge("b", "c", 0)]);
    const { sends } = neighboursOf(g);
    expect(sends.get("a")!.map((n) => n.rate)).toEqual(["0 items/min"]);
    expect(sends.get("b")!.map((n) => n.rate)).toEqual(["0 items/min"]);
  });

  it("names the step per unit: the same number is slow as a belt's items and medium as a pipe's m3", () => {
    const pipe = (r: number) => edge("a", "c", r, { kind: "pipe", itemClassName: "Desc_Water_C", itemName: "Water" });
    const { sends } = neighboursOf(graphOf([node("a"), node("c")], [pipe(299), edge("a", "c", 299)]));
    expect(sends.get("a")!.map((n) => n.rate)).toEqual(["299 items/min, medium", "299 m³/min, slow"]);
    expect(neighboursOf(graphOf([node("a"), node("c")], [pipe(300)])).sends.get("a")![0]!.rate).toBe("300 m³/min, medium");
  });

  it("does the same on the overview, a stalled factory card's flows naming no step", () => {
    const flow = (from: string, ratePerMinute: number, quality: AggregateFlow["quality"]): AggregateFlow => ({
      from,
      to: "z",
      itemClassName: "Desc_IronIngot_C",
      itemName: "Iron Ingot",
      carrier: "belt",
      flow: "supply",
      unit: "items/min",
      mixed: false,
      parts: 1,
      ratePerMinute,
      quality,
    });
    const names = new Map([["f", "F"], ["g", "G"], ["z", "Z"]]);
    const rows = factoryConnections([flow("f", 130, "atLeast"), flow("g", 130, "atLeast")], names, new Map([["g", "paused" as const]]));
    expect(rows.map((r) => r.rate)).toEqual(["at least 130 items/min, medium", "at least 130 items/min"]);
  });
});
