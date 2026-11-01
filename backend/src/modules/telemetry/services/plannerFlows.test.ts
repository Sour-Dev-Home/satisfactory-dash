import { describe, it, expect } from "vitest";
import {
  KNOWN_PLANNER_FLOWS,
  ProductionGraphSchema,
  type ConveyorEdge,
  type FactoryBuilding,
  type PlannerEdge,
  type PlannerNode,
  type ProductionGraph,
} from "@satisfactory-dash/shared";
import { buildProductionGraph, buildProductionGraphWithStats } from "./productionGraph.js";
import { TERMINAL_RECIPES, classifyDestinations, classifyFlows, sourceTrees, type FlowArc, type PlannerFlow, type TreeGroup } from "./plannerFlows.js";

// ---- builder fixtures (ADR-0055 PR 3) ----

const rate = (className: string, max: number, cur = max) => ({
  name: className.replace(/^Desc_|_C$/g, ""),
  className,
  currentPerMinute: cur,
  maxPerMinute: max,
  percent: max === 0 ? 0 : (cur / max) * 100,
  unit: "items/min" as const,
});

function machine(
  id: string,
  o: { className?: string; recipe?: string | null; ing?: [string, number, number?][]; out?: [string, number, number?][]; at?: [number, number] } = {},
): FactoryBuilding {
  return {
    id,
    name: (o.className ?? "Build_Constructor_C").replace(/^Build_|_C$/g, ""),
    className: o.className ?? "Build_Constructor_C",
    recipe: o.recipe === undefined ? "Recipe" : o.recipe,
    isProducing: true,
    isPaused: false,
    isBackedUp: false,
    production: (o.out ?? []).map(([c, m, cur]) => rate(c, m, cur ?? m)),
    ingredients: (o.ing ?? []).map(([c, m, cur]) => rate(c, m, cur ?? m)),
    state: "producing",
    location: { xM: o.at?.[0] ?? 0, yM: o.at?.[1] ?? 0, zM: 0, rotationDeg: 0 },
  };
}

/** End kinds by id prefix: the ids are game-like (`Build_<Class>_C_<n>`) where the class matters for the destination. */
function kindOf(id: string | null): ConveyorEdge["fromKind"] {
  if (id === null) return null;
  if (/^(Build_ResourceSink|Build_Generator|Build_SpaceElevator)/.test(id)) return "consumer";
  if (/^(Build_CentralStorage|Build_StorageContainer|Build_IndustrialTank|K)/.test(id)) return "storage";
  if (/^(Build_TrainDockingStation|Build_DroneStation)/.test(id)) return "station";
  if (id.startsWith("Build_Unknown")) return "other";
  if (id.startsWith("SP")) return "splitter";
  if (id.startsWith("MG")) return "merger";
  if (/^(Build_Miner|M)/.test(id)) return "extractor";
  return "machine";
}

let seq = 0;
function edge(from: string, to: string, at: [number, number] = [0, 0]): ConveyorEdge {
  seq++;
  return { id: `e${String(seq).padStart(5, "0")}`, kind: "belt", from, fromKind: kindOf(from), to, toKind: kindOf(to), capacityPerMinute: 780, tier: "Conveyor Belt", at: { x: at[0], y: at[1] } };
}

const ORE = "Desc_OreIron_C";
const INGOT = "Desc_IronIngot_C";
const PLATE = "Desc_IronPlate_C";
const SCREW = "Desc_IronScrew_C";
const RPLATE = "Desc_IronPlateReinforced_C";
const SMELTER = "Build_SmelterMk1_C";
const ASSEMBLER = "Build_AssemblerMk1_C";

const nodeOf = (g: ProductionGraph, id: string): PlannerNode => {
  const found = g.nodes.find((n) => n.machineIds.includes(id));
  if (found) return found;
  throw new Error(`no node holds ${id}`);
};
const edgesFrom = (g: ProductionGraph, from: PlannerNode, to?: PlannerNode): PlannerEdge[] => g.edges.filter((e) => e.from === from.key && (to === undefined || e.to === to.key));

/**
 * ADR-0053's worked example: two Iron Plate trees feeding one assembler, an overflow from P1 into storage K.
 * M1 -> S1 -> P1 -> A, S1 -> C (screw) -> A, M2 -> S2 -> P2 -> A, P1 -> splitter -> K.
 */
function workedExample() {
  seq = 0;
  const b: FactoryBuilding[] = [
    machine("S1", { className: SMELTER, recipe: "Iron Ingot", ing: [[ORE, 30]], out: [[INGOT, 30]] }),
    machine("S2", { className: SMELTER, recipe: "Iron Ingot", ing: [[ORE, 30]], out: [[INGOT, 30]] }),
    machine("P1", { recipe: "Iron Plate", ing: [[INGOT, 15]], out: [[PLATE, 20, 18]] }),
    machine("P2", { recipe: "Iron Plate", ing: [[INGOT, 30]], out: [[PLATE, 20]] }),
    machine("C", { recipe: "Screw", ing: [[INGOT, 15]], out: [[SCREW, 60]] }),
    machine("A", { className: ASSEMBLER, recipe: "Reinforced Iron Plate", ing: [[PLATE, 30], [SCREW, 60]], out: [[RPLATE, 5]] }),
  ];
  const e: ConveyorEdge[] = [
    edge("Build_MinerMk1_C_1", "S1"),
    edge("Build_MinerMk1_C_2", "S2"),
    edge("S1", "SP1"),
    edge("SP1", "P1"),
    edge("SP1", "C"),
    edge("S2", "P2"),
    edge("P1", "SP2"),
    edge("SP2", "A"),
    edge("SP2", "K1"),
    edge("P2", "A"),
    edge("C", "A"),
    edge("A", "K2"),
  ];
  return { b, e };
}

describe("flow classes (ADR-0053 Decision 1)", () => {
  it("keeps TERMINAL_RECIPES empty: the AWESOME Sink is the recycler", () => {
    expect(TERMINAL_RECIPES.size).toBe(0);
  });

  it("an overflow splitter gives one supply and one excess, with the excess as the remainder", () => {
    seq = 0;
    const b = [
      machine("P", { recipe: "Iron Plate", out: [[PLATE, 20, 20]] }),
      machine("A", { className: ASSEMBLER, recipe: "Reinforced Iron Plate", ing: [[PLATE, 30, 15]], out: [[RPLATE, 5]] }),
    ];
    const e = [edge("P", "SP1"), edge("SP1", "A"), edge("SP1", "K1"), edge("A", "K2")];
    const g = buildProductionGraph(b, e);
    const [p, a] = [nodeOf(g, "P"), nodeOf(g, "A")];
    const k1 = g.nodes.find((n) => n.machineIds.length === 0 && edgesFrom(g, p).some((x) => x.to === n.key)) as PlannerNode;
    expect(edgesFrom(g, p, a)).toEqual([expect.objectContaining({ flow: "supply", destination: "factory", ratePerMinute: 15, rate: "measured" })]);
    expect(edgesFrom(g, p, k1)).toEqual([expect.objectContaining({ flow: "excess", destination: "storage", itemClassName: PLATE, ratePerMinute: 5, rate: "estimated" })]);
    // The assembler's product into storage is the line's output.
    expect(edgesFrom(g, a)).toEqual([expect.objectContaining({ flow: "output", destination: "storage", itemClassName: RPLATE })]);
  });

  it("shares the excess evenly, estimated, when the source has two excess destinations for the item", () => {
    seq = 0;
    const b = [
      machine("P", { recipe: "Iron Plate", out: [[PLATE, 20, 20]] }),
      machine("A", { className: ASSEMBLER, recipe: "Reinforced Iron Plate", ing: [[PLATE, 30, 15]], out: [[RPLATE, 5]] }),
    ];
    const e = [edge("P", "SP1"), edge("SP1", "A"), edge("SP1", "K1"), edge("SP1", "Build_ResourceSink_C_1")];
    const g = buildProductionGraph(b, e);
    const excess = g.edges.filter((x) => x.flow === "excess");
    expect(excess.map((x) => x.destination).sort()).toEqual(["sink", "storage"]);
    // 20 out, 15 to the assembler: the one-end estimate (2026-10-27) splits the other 5.
    for (const x of excess) expect(x).toMatchObject({ ratePerMinute: 2.5, rate: "estimated" });
  });

  it("a supply into a buffer storage that feeds a machine is supply to the factory", () => {
    seq = 0;
    const b = [
      machine("S", { className: SMELTER, recipe: "Iron Ingot", out: [[INGOT, 30]] }),
      machine("P", { recipe: "Iron Plate", ing: [[INGOT, 30]], out: [[PLATE, 20]] }),
    ];
    const e = [edge("S", "K1"), edge("K1", "P")];
    const g = buildProductionGraph(b, e);
    const s = nodeOf(g, "S");
    expect(edgesFrom(g, s)).toEqual([expect.objectContaining({ flow: "supply", destination: "factory", itemClassName: INGOT })]);
    // ADR-0055 PR 4: the storage passes on the single item flowing into it.
    expect(g.edges.find((x) => x.to === nodeOf(g, "P").key)).toMatchObject({ flow: "supply", destination: "factory", itemClassName: INGOT, itemFrom: "upstream" });
  });

  it("a storage chain ending in a terminal: supply into the middle, output at the end, destination storage throughout", () => {
    seq = 0;
    const b = [machine("S", { className: SMELTER, recipe: "Iron Ingot", out: [[INGOT, 30]] })];
    const e = [edge("S", "K1"), edge("K1", "K2")];
    const g = buildProductionGraph(b, e);
    const s = nodeOf(g, "S");
    const first = edgesFrom(g, s)[0];
    expect(first).toMatchObject({ flow: "supply", destination: "storage" });
    const second = g.edges.find((x) => x.from === first.to) as PlannerEdge;
    expect(second).toMatchObject({ flow: "output", destination: "storage", itemClassName: INGOT, itemFrom: "upstream" });
  });
});

describe("destinations (ADR-0055 Decision 3)", () => {
  function line(dest: string, extra: FactoryBuilding[] = []) {
    seq = 0;
    const b = [machine("P", { recipe: "Iron Plate", out: [[PLATE, 20]] }), ...extra];
    return buildProductionGraph(b, [edge("P", dest)]);
  }
  const only = (g: ProductionGraph): PlannerEdge => {
    expect(g.edges).toHaveLength(1);
    return g.edges[0];
  };

  it("the AWESOME Sink is sink", () => expect(only(line("Build_ResourceSink_C_7"))).toMatchObject({ flow: "output", destination: "sink", itemClassName: PLATE }));
  it("the Dimensional Depot uploader is depot", () => expect(only(line("Build_CentralStorage_C_3"))).toMatchObject({ flow: "output", destination: "depot" }));
  it("a container with no outputs is storage", () => expect(only(line("Build_StorageContainerMk2_C_4"))).toMatchObject({ flow: "output", destination: "storage" }));
  it("a station whose route is not read is export", () => expect(only(line("Build_TrainDockingStation_C_5"))).toMatchObject({ flow: "output", destination: "export" }));
  it("an unrecognised building is unknown", () => expect(only(line("Build_Unknown_C_6"))).toMatchObject({ flow: "output", destination: "unknown" }));
  it("the space elevator is unknown (a consumer that is not a generator)", () =>
    expect(only(line("Build_SpaceElevator_C_8"))).toMatchObject({ destination: "unknown" }));
  it("a machine is factory", () => {
    const g = line("Q", [machine("Q", { recipe: "Screw", ing: [[PLATE, 20]], out: [[SCREW, 40]] })]);
    expect(g.edges.find((x) => x.from === nodeOf(g, "P").key)).toMatchObject({ flow: "supply", destination: "factory" });
  });

  it("a generator is power, by its building class", () => {
    seq = 0;
    const coal = "Desc_Coal_C";
    const b = [
      machine("P", { className: "Build_MinerMk1_C", recipe: null, out: [[coal, 60]] }),
      machine("Build_GeneratorCoal_C_1", { className: "Build_GeneratorCoal_C", recipe: null, ing: [[coal, 15]] }),
    ];
    const g = buildProductionGraph(b, [edge("P", "Build_GeneratorCoal_C_1")]);
    expect(only(g)).toMatchObject({ destination: "power", itemClassName: coal });
  });

  it("the depot never counts as a buffer, even with a belt out of it", () => {
    seq = 0;
    const b = [
      machine("P", { recipe: "Iron Plate", out: [[PLATE, 20]] }),
      machine("Q", { recipe: "Screw", ing: [[PLATE, 20]], out: [[SCREW, 40]] }),
    ];
    const g = buildProductionGraph(b, [edge("P", "Build_CentralStorage_C_1"), edge("Build_CentralStorage_C_1", "Q")]);
    expect(edgesFrom(g, nodeOf(g, "P"))).toEqual([expect.objectContaining({ flow: "output", destination: "depot" })]);
  });
});

describe("source trees (ADR-0053 Decision 3), through the builder", () => {
  it("the worked example: two Iron Plate trees and two Iron Ingot trees, and P1's overflow is excess", () => {
    const { b, e } = workedExample();
    const g = buildProductionGraph(b, e);
    const [s1, s2, p1, p2, c, a] = ["S1", "S2", "P1", "P2", "C", "A"].map((id) => nodeOf(g, id));
    expect(new Set([p1.key, p2.key]).size).toBe(2);
    expect(p1.treeKey).not.toBe(p2.treeKey);
    expect(s1.treeKey).not.toBe(s2.treeKey);
    expect(p1.treeKey).toBe(`tree|${p1.key}`);
    expect(c.treeKey).toBe(`tree|${c.key}`);
    expect(a.treeKey).toBe(`tree|${a.key}`);
    const k1 = edgesFrom(g, p1).find((x) => x.to !== a.key) as PlannerEdge;
    expect(k1).toMatchObject({ flow: "excess", destination: "storage", itemClassName: PLATE });
    expect(edgesFrom(g, p1, a)[0]).toMatchObject({ flow: "supply", destination: "factory" });
    expect(edgesFrom(g, a)[0]).toMatchObject({ flow: "output", destination: "storage" });
    // The two miners are one bubble (a raw source is a shared input), keyed by their item and site.
    const miners = g.nodes.filter((n) => n.kind === "extractor");
    expect(miners).toHaveLength(2);
    expect(miners[0].treeKey).toBe(miners[1].treeKey);
    expect(() => ProductionGraphSchema.parse(g)).not.toThrow();
  });

  it("is byte-identical under shuffled buildings and edges", () => {
    const { b, e } = workedExample();
    const base = JSON.stringify(buildProductionGraph(b, e));
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const shuffle = <T>(xs: T[]): T[] => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    for (let k = 0; k < 10; k++) expect(JSON.stringify(buildProductionGraph(shuffle(b), shuffle(e)))).toBe(base);
  });

  it("changing only current rates changes no flow, destination or treeKey", () => {
    const { b, e } = workedExample();
    const shape = (g: ProductionGraph) => ({
      edges: g.edges.map((x) => [x.from, x.to, x.itemClassName, x.flow, x.destination]),
      nodes: g.nodes.map((n) => [n.key, n.treeKey]),
    });
    const base = shape(buildProductionGraph(b, e));
    const scaled = (f: number) =>
      b.map((x) => ({
        ...x,
        production: x.production.map((r) => ({ ...r, currentPerMinute: r.currentPerMinute * f })),
        ingredients: (x.ingredients ?? []).map((r) => ({ ...r, currentPerMinute: r.currentPerMinute * f })),
      }));
    for (const f of [0, 0.1, 0.5, 3]) expect(shape(buildProductionGraph(scaled(f), e))).toEqual(base);
  });
});

// ---- the pure tree function on small hand-built graphs ----

function graph(spec: { id: string; kind?: string; recipe?: string | null; site?: string }[], arcs: [string, string, string | null][]) {
  const idx = new Map(spec.map((g, i) => [g.id, i]));
  const groups: TreeGroup[] = spec.map((g) => ({
    key: g.id,
    siteKey: g.site ?? "site",
    kind: g.kind ?? "machines",
    className: g.kind === undefined || g.kind === "machines" ? "Build_Constructor_C" : g.kind,
    buildClass: null,
    recipe: g.recipe === undefined ? (g.kind === undefined || g.kind === "machines" ? g.id.replace(/\d+$/, "") : null) : g.recipe,
    ingredients: new Set<string>(),
  }));
  const fa: FlowArc[] = arcs.map(([s, d, item]) => ({ s: idx.get(s) as number, d: idx.get(d) as number, item }));
  const flows = classifyFlows(groups, fa);
  const trees = sourceTrees(groups, fa, flows);
  const tree = (id: string) => trees[idx.get(id) as number];
  return { groups, flows, tree, destinations: classifyDestinations(groups, fa, flows) };
}

describe("source trees, the pure function", () => {
  it("a shared miner does not join two trees", () => {
    const { tree } = graph(
      [{ id: "M", kind: "extractor" }, { id: "Ingot1" }, { id: "Ingot2" }, { id: "Plate1" }, { id: "Plate2" }],
      [["M", "Ingot1", "ore"], ["M", "Ingot2", "ore"], ["Ingot1", "Plate1", "ingot"], ["Ingot2", "Plate2", "ingot"]],
    );
    expect(tree("Plate1")).not.toBe(tree("Plate2"));
    expect(tree("Ingot1")).not.toBe(tree("Ingot2"));
  });

  it("a shared smelter makes the two plate groups one bubble, keyed by the lowest key", () => {
    const { tree } = graph(
      [{ id: "Ingot1" }, { id: "Ingot2" }, { id: "Plate2" }, { id: "Plate1" }],
      [["Ingot1", "Plate1", "ingot"], ["Ingot1", "Plate2", "ingot"], ["Ingot2", "Plate2", "ingot"]],
    );
    expect(tree("Plate1")).toBe(tree("Plate2"));
    expect(tree("Plate2")).toBe("tree|Plate1");
    expect(tree("Ingot1")).not.toBe(tree("Ingot2"));
  });

  it("joins through a chain of shared upstream (transitively)", () => {
    const { tree } = graph(
      [{ id: "Ingot1" }, { id: "Rod1" }, { id: "Plate1" }, { id: "Plate2" }, { id: "Plate3" }],
      [["Ingot1", "Rod1", "ingot"], ["Rod1", "Plate1", "rod"], ["Ingot1", "Plate2", "ingot"], ["Rod1", "Plate3", "rod"]],
    );
    expect(new Set(["Plate1", "Plate2", "Plate3"].map(tree)).size).toBe(1);
  });

  it("a loop's same-recipe groups are one bubble", () => {
    const { tree } = graph(
      [{ id: "Mix1" }, { id: "Mid1" }, { id: "Mix2" }, { id: "Mid2" }],
      [["Mix1", "Mid1", "a"], ["Mid1", "Mix2", "b"], ["Mix2", "Mid2", "a"], ["Mid2", "Mix1", "b"]],
    );
    expect(tree("Mix1")).toBe(tree("Mix2"));
    expect(tree("Mid1")).toBe(tree("Mid2"));
  });

  it("a same-recipe group upstream of another joins it, whichever comes first in key order", () => {
    const a = graph([{ id: "Plate1" }, { id: "Plate2" }, { id: "Mid1" }], [["Plate2", "Mid1", "x"], ["Mid1", "Plate1", "y"]]);
    expect(a.tree("Plate1")).toBe(a.tree("Plate2"));
    const b = graph([{ id: "Plate1" }, { id: "Plate2" }, { id: "Mid1" }], [["Plate1", "Mid1", "x"], ["Mid1", "Plate2", "y"]]);
    expect(b.tree("Plate1")).toBe(b.tree("Plate2"));
  });

  it("passes through a buffer storage that a machine feeds", () => {
    const { tree, flows } = graph(
      [{ id: "Ingot1" }, { id: "K", kind: "storage" }, { id: "Plate1" }, { id: "Plate2" }],
      [["Ingot1", "K", "ingot"], ["K", "Plate1", null], ["K", "Plate2", null]],
    );
    expect(flows).toEqual(["supply", "supply", "supply"]);
    expect(tree("Plate1")).toBe(tree("Plate2"));
  });

  it("a storage fed only by a raw source does not join trees", () => {
    const { tree } = graph(
      [{ id: "M", kind: "extractor" }, { id: "K", kind: "storage" }, { id: "Plate1" }, { id: "Plate2" }],
      [["M", "K", "ore"], ["K", "Plate1", null], ["K", "Plate2", null]],
    );
    expect(tree("Plate1")).not.toBe(tree("Plate2"));
  });

  it("a buffer chain with a machine at its head still joins (the closure passes through two buffers)", () => {
    const { tree } = graph(
      [{ id: "Ingot1" }, { id: "K1", kind: "storage" }, { id: "K2", kind: "storage" }, { id: "Plate1" }, { id: "Plate2" }],
      [["Ingot1", "K1", "ingot"], ["K1", "K2", null], ["K2", "Plate1", null], ["K2", "Plate2", null]],
    );
    expect(tree("Plate1")).toBe(tree("Plate2"));
  });

  it("excess and output edges never join trees", () => {
    const { tree, flows } = graph(
      [{ id: "Ingot1" }, { id: "Ingot2" }, { id: "K", kind: "storage" }, { id: "Plate1" }, { id: "Plate2" }],
      [["Ingot1", "Plate1", "ingot"], ["Ingot2", "Plate2", "ingot"], ["Ingot1", "K", "ingot"], ["Ingot2", "K", "ingot"]],
    );
    expect(flows.slice(2)).toEqual<PlannerFlow[]>(["excess", "excess"]);
    expect(tree("Plate1")).not.toBe(tree("Plate2"));
  });

  it("different recipes are different bubbles even inside one tree", () => {
    const { tree } = graph([{ id: "Ingot1" }, { id: "Plate1" }], [["Ingot1", "Plate1", "ingot"]]);
    expect(tree("Ingot1")).not.toBe(tree("Plate1"));
  });

  it("non-machine bubbles are per site, kind and item received", () => {
    const { tree } = graph(
      [
        { id: "Plate1" },
        { id: "Plate2" },
        { id: "K1", kind: "storage" },
        { id: "K2", kind: "storage" },
        { id: "K3", kind: "storage" },
        { id: "K4", kind: "storage", site: "other" },
      ],
      [["Plate1", "K1", "plate"], ["Plate2", "K2", "plate"], ["Plate1", "K3", "screw"], ["Plate2", "K4", "plate"]],
    );
    expect(tree("K1")).toBe(tree("K2"));
    expect(tree("K1")).toBe("tree|K1");
    expect(tree("K3")).not.toBe(tree("K1"));
    expect(tree("K4")).not.toBe(tree("K1"));
  });

  it("a tank on a producer's pipe (an arc each way) is not a buffer", () => {
    const { flows, destinations } = graph(
      [{ id: "Ref1" }, { id: "T", kind: "storage" }],
      [["Ref1", "T", "fuel"], ["T", "Ref1", null]],
    );
    expect(flows[0]).toBe("output");
    expect(destinations[0]).toBe("storage");
  });
});

describe("a generated 10x factory with trees", () => {
  // 338 clusters (3,380 buildings): a miner, two smelters on it, each feeding a plate constructor, both plate lines
  // into one assembler, an overflow from each plate line into storage. Every cluster: two plate trees.
  function generate(): { buildings: FactoryBuilding[]; edges: ConveyorEdge[] } {
    seq = 0;
    const buildings: FactoryBuilding[] = [];
    const edges: ConveyorEdge[] = [];
    for (let k = 0; k < 338; k++) {
      const at: [number, number] = [(k % 20) * 400, Math.floor(k / 20) * 400];
      const p = `c${String(k).padStart(3, "0")}`;
      for (const side of [1, 2]) {
        buildings.push(machine(`${p}S${side}`, { className: SMELTER, recipe: "Iron Ingot", ing: [[ORE, 30]], out: [[INGOT, 30]], at }));
        for (let i = 0; i < 3; i++) {
          buildings.push(machine(`${p}P${side}${i}`, { recipe: "Iron Plate", ing: [[INGOT, 10]], out: [[PLATE, 7]], at }));
          edges.push(edge(`SP${p}${side}`, `${p}P${side}${i}`, at), edge(`${p}P${side}${i}`, `MG${p}${side}`, at));
        }
        edges.push(edge(`M${p}${side}`, `${p}S${side}`, at),edge(`${p}S${side}`, `SP${p}${side}`, at));
        edges.push(edge(`MG${p}${side}`, `SPo${p}${side}`, at), edge(`SPo${p}${side}`, `${p}A`, at), edge(`SPo${p}${side}`, `K${p}${side}`, at));
      }
      buildings.push(machine(`${p}A`, { className: ASSEMBLER, recipe: "Reinforced Iron Plate", ing: [[PLATE, 30]], out: [[RPLATE, 5]], at }));
      buildings.push(machine(`${p}X`, { className: SMELTER, recipe: "Spare", at }));
    }
    return { buildings, edges };
  }

  it("finishes inside a generous bound, parses, and finds two plate trees per cluster", () => {
    const { buildings, edges } = generate();
    expect(buildings.length).toBe(338 * 10);
    const start = performance.now();
    const { graph: g } = buildProductionGraphWithStats(buildings, edges);
    const parsed = ProductionGraphSchema.parse(g);
    const ms = performance.now() - start;
    expect(ms).toBeLessThan(5000);
    const plates = parsed.nodes.filter((n) => n.recipe === "Iron Plate");
    expect(plates).toHaveLength(338 * 2);
    expect(new Set(plates.map((n) => n.treeKey)).size).toBe(338 * 2);
    expect(parsed.edges.filter((x) => x.flow === "excess")).toHaveLength(338 * 2);
    for (const x of parsed.edges) expect(KNOWN_PLANNER_FLOWS).toContain(x.flow);
    for (const n of parsed.nodes) expect(n.treeKey).toMatch(/^tree\|/);
  });
});
