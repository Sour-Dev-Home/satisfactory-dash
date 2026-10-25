import { describe, it, expect } from "vitest";
import { ProductionGraphSchema, type ConveyorEdge, type FactoryBuilding, type TrainRouteRecord } from "@satisfactory-dash/shared";
import { buildProductionGraph } from "./productionGraph.js";
import { DEPOT_NODE_KEY } from "./logisticsEdges.js";

// SYNTHETIC: a farm and a base joined by one train, plus a Depot uploader (ADR-0055 PR 6a). Platform ids are belt end ids
// (raw-sources/frm-train-gate-2026-10-21.md, check 1).

const ORE = "Desc_OreIron_C";
const INGOT = "Desc_IronIngot_C";
let seq = 0;
function kindOf(id: string): ConveyorEdge["fromKind"] {
  if (/^Build_(TrainDockingStation|DroneStation)/.test(id)) return "station";
  if (id.startsWith("Build_CentralStorage")) return "storage";
  if (id.startsWith("Build_Miner")) return "extractor";
  return "machine";
}
function edge(from: string, to: string, at: [number, number] = [0, 0]): ConveyorEdge {
  seq++;
  return { id: `e${String(seq).padStart(5, "0")}`, kind: "belt", from, fromKind: kindOf(from), to, toKind: kindOf(to), capacityPerMinute: 780, tier: "Conveyor Belt", at: { x: at[0], y: at[1] } };
}
const rate = (className: string, max: number, cur = max) => ({ name: className, className, currentPerMinute: cur, maxPerMinute: max, percent: 100, unit: "items/min" as const });
const smelter = (id: string, at: [number, number]): FactoryBuilding => ({
  id,
  name: "Smelter",
  className: "Build_SmelterMk1_C",
  recipe: "Iron Ingot",
  isProducing: true,
  isPaused: false,
  isBackedUp: false,
  production: [rate(INGOT, 30)],
  ingredients: [rate(ORE, 30)],
  state: "producing",
  location: { xM: at[0], yM: at[1], zM: 0, rotationDeg: 0 },
});

const DOCK_OUT = "Build_TrainDockingStation_C_1";
const DOCK_IN = "Build_TrainDockingStation_C_2";
const UPLOADER = "Build_CentralStorage_C_1";

const routes: TrainRouteRecord[] = [
  { recordType: "station", id: "st1", name: "Farm Out ", platforms: [{ id: DOCK_OUT, mode: "load", items: [ORE] }] },
  { recordType: "station", id: "st2", name: "Base In", platforms: [{ id: DOCK_IN, mode: "unload", items: [ORE] }] },
  { recordType: "train", id: "t1", name: "Ore Hauler", stops: ["Farm Out ", "Base In"], items: [] },
];

function world() {
  seq = 0;
  const b = [smelter("S", [5000, 0])];
  const e = [edge("Build_MinerMk1_C_1", DOCK_OUT, [0, 0]), edge(DOCK_IN, "S", [5000, 0]), edge("S", UPLOADER, [5000, 10])];
  return { b, e };
}

describe("production graph: transport edges", () => {
  it("adds the train edge between the two platform nodes, and the depot edge and node", () => {
    const { b, e } = world();
    const g = buildProductionGraph(b, e, [], routes);
    expect(ProductionGraphSchema.safeParse(g).success).toBe(true);
    expect(g.logistics).toBe("present");
    const byMode = (m: string) => (g.transports ?? []).filter((t) => t.mode === m);
    const [train] = byMode("train");
    expect(byMode("train")).toHaveLength(1);
    expect(train).toMatchObject({ itemClassName: ORE, carriers: 1, routeName: "Farm Out to Base In", destination: "factory", flow: "supply" });
    const from = g.nodes.find((n) => n.key === train.from);
    const to = g.nodes.find((n) => n.key === train.to);
    expect(from?.kind).toBe("station");
    expect(to?.kind).toBe("station");
    expect(to?.key).not.toBe(from?.key);
    const [depot] = byMode("depot");
    expect(byMode("depot")).toHaveLength(1);
    expect(depot).toMatchObject({ to: DEPOT_NODE_KEY, itemClassName: INGOT, destination: "depot" });
    expect(g.nodes.find((n) => n.key === DEPOT_NODE_KEY)).toMatchObject({ role: "depot", name: "Dimensional Depot" });
    expect(g.nodes.some((n) => n.key === depot.from)).toBe(true);
    // The virtual node belongs to no site.
    expect(g.sites.some((s) => s.nodeKeys.includes(DEPOT_NODE_KEY))).toBe(false);
    // Nodes stay sorted by key.
    const keys = g.nodes.map((n) => n.key);
    expect([...keys].sort()).toEqual(keys);
  });

  it("without the layer: logistics notRead, no train edge, the depot edge still drawn", () => {
    const { b, e } = world();
    const g = buildProductionGraph(b, e);
    expect(g.logistics).toBe("notRead");
    expect((g.transports ?? []).map((t) => t.mode)).toEqual(["depot"]);
  });

  it("with an empty layer: present, and no train edge", () => {
    const { b, e } = world();
    const g = buildProductionGraph(b, e, [], []);
    expect(g.logistics).toBe("present");
    expect((g.transports ?? []).map((t) => t.mode)).toEqual(["depot"]);
  });

  it("a duplicate station name reaches the response notes", () => {
    const { b, e } = world();
    const dup: TrainRouteRecord[] = [...routes, { recordType: "station", id: "st3", name: "Base In", platforms: [] }];
    const g = buildProductionGraph(b, e, [], dup);
    expect(g.notes.map((n) => n.code)).toContain("duplicateStationName");
    expect((g.transports ?? []).filter((t) => t.mode === "train")).toEqual([]);
  });

  it("is byte-identical for the same input, and the layer order does not matter", () => {
    const { b, e } = world();
    const one = JSON.stringify(buildProductionGraph(b, e, [], routes));
    const two = JSON.stringify(buildProductionGraph([...b].reverse(), [...e].reverse(), [], [...routes].reverse()));
    expect(two).toBe(one);
  });

  it("a platform no belt names makes no train edge", () => {
    const { b, e } = world();
    const g = buildProductionGraph(b, e.filter((x) => x.from !== DOCK_IN), [], routes);
    expect((g.transports ?? []).filter((t) => t.mode === "train")).toEqual([]);
  });
});
