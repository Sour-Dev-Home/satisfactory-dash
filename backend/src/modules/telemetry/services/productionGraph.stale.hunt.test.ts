import { describe, it, expect } from "vitest";
import { ProductionGraphSchema, type ConveyorEdge, type FactoryBuilding } from "@satisfactory-dash/shared";
import { buildProductionGraph } from "./productionGraph.js";

// #728 cause 11: which nodes are marked `stale`.

const rate = (className: string, max: number) => ({ name: className, className, currentPerMinute: max, maxPerMinute: max, percent: 100, unit: "items/min" as const });
const machine = (id: string): FactoryBuilding => ({
  id,
  name: "Constructor",
  className: "Build_Constructor_C",
  recipe: "Plate",
  isProducing: true,
  isPaused: false,
  isBackedUp: false,
  production: [rate("Desc_Plate_C", 20)],
  ingredients: [rate("Desc_Ingot_C", 30)],
  state: "producing",
});
const edge = (id: string, from: string | null, to: string | null, fromKind: ConveyorEdge["fromKind"], toKind: ConveyorEdge["toKind"] = "machine"): ConveyorEdge => ({
  id,
  kind: "belt",
  from,
  fromKind,
  to,
  toKind,
  capacityPerMinute: 780,
  tier: "Conveyor Belt",
  at: { x: 10, y: 20 },
});

describe("stale marking", () => {
  it("a stale end beside a matched end into the same machine: only the stale-only node is marked", () => {
    const g = buildProductionGraph([machine("a"), machine("b")], [edge("e1", "a", "b", "machine"), edge("e2", "gone", "b", "machine")]);
    const stale = g.nodes.filter((n) => n.stale === true);
    const fresh = g.nodes.filter((n) => n.stale !== true);
    expect(stale.map((n) => n.machineIds)).toEqual([[]]);
    expect(fresh.flatMap((n) => n.machineIds).sort()).toEqual(["a", "b"]);
    expect(fresh.every((n) => !("stale" in n))).toBe(true);
    expect(ProductionGraphSchema.safeParse(g).success).toBe(true);
  });

  it("an extractor or storage end with no building is never stale", () => {
    const g = buildProductionGraph([machine("b")], [edge("e1", "X1", "b", "extractor"), edge("e2", "T1", "b", "storage"), edge("e3", "b", "T2", "machine", "storage")]);
    expect(g.nodes.some((n) => "stale" in n)).toBe(false);
  });

  it("a stale machine end that is a destination is marked too", () => {
    const g = buildProductionGraph([machine("a")], [edge("e1", "a", "gone", "machine")]);
    expect(g.nodes.filter((n) => n.stale === true)).toHaveLength(1);
  });
});
