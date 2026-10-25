import { describe, it, expect } from "vitest";
import { ProductionGraphSchema, type ConveyorEdge, type FactoryBuilding, type PlannerEdge, type PlannerNode } from "@satisfactory-dash/shared";
import { SITE_MERGE_DISTANCE_M, buildProductionGraph, buildProductionGraphWithStats } from "./productionGraph.js";
import type { BottleneckEdges } from "./bottleneckFinder.js";

// ---- fixture helpers ----

type Unit = "items/min" | "m3/min";
const rate = (className: string, max: number, cur = max, unit: Unit = "items/min") => ({
  name: className.replace(/^Desc_|_C$/g, ""),
  className,
  currentPerMinute: cur,
  maxPerMinute: max,
  percent: max === 0 ? 0 : (cur / max) * 100,
  unit,
});

interface MachineOptions {
  className?: string;
  recipe?: string | null;
  state?: string;
  /** [className, max per minute, current per minute (default max)] */
  ing?: [string, number, number?][];
  out?: [string, number, number?][];
  unit?: Unit;
  at?: [number, number];
}

function machine(id: string, o: MachineOptions = {}): FactoryBuilding {
  const unit = o.unit ?? "items/min";
  return {
    id,
    name: o.className ? o.className.replace(/^Build_|_C$/g, "") : "Constructor",
    className: o.className ?? "Build_Constructor_C",
    recipe: o.recipe === undefined ? "Recipe" : o.recipe,
    isProducing: true,
    isPaused: false,
    isBackedUp: false,
    production: (o.out ?? []).map(([c, m, cur]) => rate(c, m, cur ?? m, unit)),
    ingredients: (o.ing ?? []).map(([c, m, cur]) => rate(c, m, cur ?? m, unit)),
    state: o.state ?? "producing",
    ...(o.at ? { location: { xM: o.at[0], yM: o.at[1], zM: 0, rotationDeg: 0 } } : {}),
  };
}

const PREFIX_KIND = new Map<string, ConveyorEdge["fromKind"]>(Object.entries({ S: "splitter", G: "merger", J: "junction", T: "storage", X: "extractor" }));
const kindOf = (n: string | null): ConveyorEdge["fromKind"] => (n === null ? null : (PREFIX_KIND.get(n[0]) ?? "machine"));

function edge(id: string, from: string | null, to: string | null, o: { cap?: number | null; kind?: "belt" | "pipe"; at?: [number, number] } = {}): ConveyorEdge {
  const cap = o.cap === undefined ? 780 : o.cap;
  return {
    id,
    kind: o.kind ?? "belt",
    from,
    fromKind: kindOf(from),
    to,
    toKind: kindOf(to),
    capacityPerMinute: cap,
    tier: o.kind === "pipe" ? "Pipeline Mk.1" : "Conveyor Belt",
    at: { x: o.at?.[0] ?? 10, y: o.at?.[1] ?? 20 },
  };
}

const run = (b: FactoryBuilding[], e: BottleneckEdges) => buildProductionGraph(b, e);
const node = (g: { nodes: PlannerNode[] }, className: string, recipe?: string): PlannerNode => {
  const found = g.nodes.filter((n) => n.className === className && (recipe === undefined || n.recipe === recipe));
  expect(found).toHaveLength(1);
  return found[0];
};
const edgeBetween = (g: { edges: PlannerEdge[]; nodes: PlannerNode[] }, from: PlannerNode, to: PlannerNode): PlannerEdge[] =>
  g.edges.filter((e) => e.from === from.key && e.to === to.key);

const INGOT = "Desc_IronIngot_C";
const PLATE = "Desc_IronPlate_C";
const ORE = "Desc_OreIron_C";
const WIRE = "Desc_Wire_C";
const SMELTER = "Build_SmelterMk1_C";
const MINER = "Build_MinerMk1_C";

/** A smelter feeding `n` constructors through a splitter, each constructor into storage. */
function manifold(n: number, o: { cons?: number; at?: [number, number] } = {}) {
  const at = o.at ?? [0, 0];
  const cons = o.cons ?? 30;
  const b: FactoryBuilding[] = [machine("smelt", { className: SMELTER, recipe: "Iron Ingot", ing: [[ORE, 30]], out: [[INGOT, 30 * n, cons * n]], at })];
  const e: ConveyorEdge[] = [edge("e0", "smelt", "S1", { cap: 270, at })];
  for (let i = 0; i < n; i++) {
    b.push(machine(`con${i}`, { recipe: "Iron Plate", ing: [[INGOT, 30, cons]], out: [[PLATE, 20, 20]], at: [at[0] + 10 * i, at[1]] }));
    e.push(edge(`s${i}`, "S1", `con${i}`, { cap: 120, at }), edge(`o${i}`, `con${i}`, "T1", { at }));
  }
  return { b, e };
}

describe("grouping", () => {
  it("groups a manifold into one node with the summed rates and an edge through the splitter", () => {
    const { b, e } = manifold(4);
    const g = run(b, e);
    expect(g.beltData).toBe("present");
    expect(g.nodes.map((n) => n.kind).sort()).toEqual(["machines", "machines", "storage"]);
    const cons = node(g, "Build_Constructor_C", "Iron Plate");
    expect(cons.count).toBe(4);
    expect(cons.machineIds).toEqual(["con0", "con1", "con2", "con3"]);
    expect(cons.stateCounts).toEqual({ producing: 4 });
    expect(cons.ingredients).toEqual([{ className: INGOT, name: "IronIngot", unit: "items/min", currentPerMinute: 120, maxPerMinute: 120 }]);
    expect(cons.products[0]).toMatchObject({ className: PLATE, currentPerMinute: 80, maxPerMinute: 80 });
    const smelter = node(g, SMELTER);
    const link = edgeBetween(g, smelter, cons);
    expect(link).toHaveLength(1);
    expect(link[0]).toMatchObject({ kind: "belt", itemClassName: INGOT, ratePerMinute: 120, rate: "measured", mixed: false, capacityPerMinute: null });
    expect(link[0].conveyorCount).toBe(5);
  });

  it("keeps different recipes and different feeds apart", () => {
    const a = manifold(2);
    const other = [machine("cx", { recipe: "Wire", ing: [[INGOT, 30]], out: [[WIRE, 60]] })];
    const g = run([...a.b, ...other], [...a.e, edge("sx", "S1", "cx")]);
    expect(g.nodes.filter((n) => n.className === "Build_Constructor_C")).toHaveLength(2);
    // Same class and recipe fed by another splitter is its own group, not part of the manifold.
    const two = [...manifold(2).b, machine("far", { recipe: "Iron Plate", ing: [[INGOT, 30]], out: [[PLATE, 20]] })];
    const g2 = run(two, [...manifold(2).e, edge("sf", "S9", "far"), edge("pf", "smelt", "S9")]);
    expect(g2.nodes.filter((n) => n.recipe === "Iron Plate")).toHaveLength(2);
  });

  it("keys nodes by class, recipe and the snapped centroid, with an ordinal on collision", () => {
    const b = [machine("a", { recipe: "R", out: [[PLATE, 10]], at: [101, 24] }), machine("b", { recipe: "R", out: [[PLATE, 10]], at: [99, 23] })];
    const e = [edge("e1", "a", "T1"), edge("e2", "b", "T2")];
    const g = run(b, e);
    const keys = g.nodes.filter((n) => n.className === "Build_Constructor_C").map((n) => n.key);
    expect(keys).toEqual(["Build_Constructor_C|R|100|0", "Build_Constructor_C|R|100|0#2"]);
    expect(g.nodes.find((n) => n.key === keys[0])?.machineIds).toEqual(["a"]);
    expect(g.nodes.find((n) => n.key === keys[0])?.at).toEqual({ x: 101, y: 24 });
  });

  it("gives storage, extractors and stations their own nodes, grouped by what they feed", () => {
    const b = [
      machine("m1", { className: MINER, recipe: null, out: [[ORE, 60]], at: [0, 0] }),
      machine("m2", { className: MINER, recipe: null, out: [[ORE, 60]], at: [20, 0] }),
      machine("smelt", { className: SMELTER, recipe: "Iron Ingot", ing: [[ORE, 60]], out: [[INGOT, 30]] }),
    ];
    const g = run(b, [edge("a", "m1", "G1"), edge("b", "m2", "G1"), edge("c", "G1", "smelt"), edge("d", "smelt", "T1")]);
    expect(node(g, MINER).count).toBe(2);
    expect(node(g, MINER).kind).toBe("machines");
    expect(g.nodes.some((n) => n.kind === "storage" && n.className === "storage")).toBe(true);
  });
});

describe("item per edge", () => {
  it("drops a link whose destination uses none of the source's items and says so in a note", () => {
    const b = [machine("a", { out: [[WIRE, 10]] }), machine("c", { recipe: "R2", ing: [[PLATE, 10]], out: [[PLATE, 1]] })];
    const g = run(b, [edge("e1", "a", "S1"), edge("e2", "S1", "c")]);
    expect(g.edges).toEqual([]);
    expect(g.notes.map((n) => n.code)).toEqual(["unmatchedLinks"]);
    expect(g.notes[0].text).toMatch(/^1 links carry items/);
  });

  it("marks a belt that producers of two solid items reach as mixed, and never calls its rates measured", () => {
    const b = [
      machine("ing", { className: SMELTER, recipe: "Ingot", out: [[INGOT, 60]] }),
      machine("wir", { recipe: "Wire", out: [[WIRE, 60]] }),
      machine("use", { recipe: "Plate", ing: [[INGOT, 30]], out: [[PLATE, 20]] }),
    ];
    const g = run(b, [edge("e1", "ing", "G1"), edge("e2", "wir", "G1"), edge("e3", "G1", "use")]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ itemClassName: INGOT, mixed: true, rate: "estimated", ratePerMinute: 30 });
    expect(g.notes.map((n) => n.code)).toContain("unmatchedLinks");
  });

  it("infers an extractor's item from what its destination needs that nothing else supplies", () => {
    const miner = machine("Xm", { className: MINER, recipe: null });
    const smelter = machine("s", { className: SMELTER, recipe: "Iron Ingot", ing: [[ORE, 30, 20]], out: [[INGOT, 30, 20]] });
    const g = run([miner, smelter], [edge("a", "Xm", "s", { cap: 60 })]);
    const link = g.edges.find((e) => e.itemClassName === ORE);
    expect(link).toMatchObject({ itemName: "OreIron", rate: "estimated", ratePerMinute: 20, capacityPerMinute: 60 });
  });

  it("leaves an extractor's item null when the destination needs several items it could be", () => {
    const miner = machine("Xm", { className: MINER, recipe: null });
    const asm = machine("s", { recipe: "Two", ing: [[ORE, 30], [WIRE, 30]], out: [[PLATE, 20]] });
    const g = run([miner, asm], [edge("a", "Xm", "s")]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ itemClassName: null, itemName: null, ratePerMinute: null, rate: "unknown" });
  });

  it("sends a pipe's fluid on a pipe edge and refuses a fluid on a belt", () => {
    const refinery = machine("r", { className: "Build_OilRefinery_C", recipe: "Fuel", unit: "m3/min", out: [["Desc_LiquidFuel_C", 40, 30]] });
    const gen = machine("g", { className: "Build_GeneratorFuel_C", recipe: null, unit: "m3/min", ing: [["Desc_LiquidFuel_C", 20, 15]] });
    const piped = run([refinery, gen], [edge("p1", "r", "g", { kind: "pipe", cap: null })]);
    expect(piped.edges.map((e) => [e.kind, e.itemClassName])).toEqual([["pipe", "Desc_LiquidFuel_C"]]);
    const belted = run([refinery, gen], [edge("b1", "r", "g")]);
    expect(belted.edges).toEqual([]);
  });
});

describe("rates", () => {
  it("is measured for one source and the destination's own consumption", () => {
    const { b, e } = manifold(2, { cons: 25 });
    const g = run(b, e);
    const [link] = edgeBetween(g, node(g, SMELTER), node(g, "Build_Constructor_C"));
    expect(link).toMatchObject({ rate: "measured", ratePerMinute: 50 });
  });

  it("shares a destination's consumption among several sources by their output, as estimated", () => {
    const b = [
      machine("s1", { className: SMELTER, recipe: "Iron Ingot", out: [[INGOT, 60, 30]] }),
      machine("s2", { className: "Build_FoundryMk1_C", recipe: "Iron Ingot", out: [[INGOT, 90, 90]] }),
      machine("c", { recipe: "Plate", ing: [[INGOT, 120, 60]], out: [[PLATE, 10]] }),
    ];
    const g = run(b, [edge("a", "s1", "G1"), edge("b", "s2", "G1"), edge("c", "G1", "c")]);
    const rates = Object.fromEntries(g.edges.map((e) => [e.from.split("|")[0], [e.ratePerMinute, e.rate]]));
    expect(rates).toEqual({ [SMELTER]: [15, "estimated"], Build_FoundryMk1_C: [45, "estimated"] });
  });

  it("is unknown when a source's output is split and the destination reports no use", () => {
    const b = [machine("p", { out: [[PLATE, 60, 50]] }), machine("q", { recipe: "Q", ing: [] }), machine("r", { recipe: "R" })];
    const g = run(b, [edge("a", "p", "S1"), edge("b", "S1", "q"), edge("c", "S1", "r")]);
    expect(g.edges.length).toBe(2);
    for (const e of g.edges) expect(e).toMatchObject({ ratePerMinute: null, rate: "unknown" });
  });

  it("reports a capacity only for an unbranched chain", () => {
    const b = [machine("p", { out: [[PLATE, 60]] }), machine("q", { recipe: "Q", ing: [[PLATE, 30]], out: [[WIRE, 1]] })];
    const chain = run(b, [edge("a", "p", "J1", { cap: 120 }), edge("b", "J1", "q", { cap: 60 })]);
    expect(chain.edges[0]).toMatchObject({ capacityPerMinute: 60, conveyorCount: 2 });
    const branched = run(b, [edge("a", "p", "S1", { cap: 120 }), edge("b", "S1", "q", { cap: 60 }), edge("c", "S1", "T1")]);
    expect(branched.edges.find((e) => e.to.startsWith("Build_Constructor_C"))?.capacityPerMinute).toBeNull();
  });
});

describe("loops", () => {
  it("flags nodes in a cycle and only those", () => {
    const b = [
      machine("a", { className: "Build_A_C", recipe: "A", ing: [[WIRE, 10]], out: [[PLATE, 10]] }),
      machine("b", { className: "Build_B_C", recipe: "B", ing: [[PLATE, 10]], out: [[WIRE, 10], [INGOT, 5]] }),
      machine("c", { className: "Build_C_C", recipe: "C", ing: [[INGOT, 5]], out: [[ORE, 5]] }),
    ];
    const g = run(b, [edge("e1", "a", "b"), edge("e2", "b", "a"), edge("e3", "b", "c")]);
    expect(g.nodes.map((n) => [n.className, n.loop])).toEqual([["Build_A_C", true], ["Build_B_C", true], ["Build_C_C", false]]);
  });

  it("survives a very deep chain without recursing", () => {
    const n = 20_000;
    const b: FactoryBuilding[] = [];
    const e: ConveyorEdge[] = [];
    for (let i = 0; i < n; i++) {
      b.push(machine(`m${String(i).padStart(6, "0")}`, { className: `Build_M${i}_C`, recipe: `R${i}`, ing: [[`I${i}`, 1]], out: [[`I${(i + 1) % n}`, 1]] }));
      if (i > 0) e.push(edge(`e${String(i).padStart(6, "0")}`, `m${String(i - 1).padStart(6, "0")}`, `m${String(i).padStart(6, "0")}`));
    }
    e.push(edge("zlast", `m${String(n - 1).padStart(6, "0")}`, "m000000"));
    const g = run(b, e);
    expect(g.nodes.every((x) => x.loop)).toBe(true);
  });
});

describe("sites", () => {
  it("makes two sites of two unconnected lines far apart, named for their most downstream product", () => {
    const one = manifold(2, { at: [0, 0] });
    const two = [machine("w", { recipe: "Wire", ing: [[PLATE, 10]], out: [[WIRE, 10]], at: [5000, 5000] })];
    const g = run([...one.b, ...two], [...one.e, edge("wz", "w", "T9", { at: [5000, 5000] })]);
    expect(g.sites).toHaveLength(2);
    const big = g.sites.find((s) => s.machineCount > 2) as (typeof g.sites)[number];
    expect(big.name).toBe("IronPlate site");
    expect(big.topOutputs[0]).toMatchObject({ className: PLATE, currentPerMinute: 40, maxPerMinute: 40 });
    expect(big.key).toMatch(/^site\|-?\d+\|-?\d+$/);
    const small = g.sites.find((s) => s !== big) as (typeof g.sites)[number];
    expect(small.name).toBe("Wire site");
    expect(g.nodes.every((n) => g.sites.some((s) => s.key === n.siteKey && s.nodeKeys.includes(n.key)))).toBe(true);
  });

  it("falls back to 'Site near (x, y)' with no product", () => {
    const g = run([machine("s", { className: "Build_Storage_C", recipe: null, at: [300, -700] })], [edge("a", "s", "T1", { at: [300, -700] })]);
    expect(g.sites[0].name).toBe("Site near (300, -700)");
  });

  it("merges belt-independent lines within the distance and splits them beyond it", () => {
    const line = (id: string, x: number): [FactoryBuilding, ConveyorEdge] => [
      machine(id, { className: `Build_${id}_C`, recipe: id, out: [[PLATE, 10]], at: [x, 0] }),
      edge(`e${id}`, id, `T${id}`, { at: [x, 0] }),
    ];
    const [a, ea] = line("a", 0);
    const [near, en] = line("n", SITE_MERGE_DISTANCE_M);
    const [far, ef] = line("f", SITE_MERGE_DISTANCE_M * 2 + 1);
    const g = run([a, near, far], [ea, en, ef]);
    // Each line is a machine and its storage; a and near are exactly D apart (merged), far is 151 m past near.
    expect(g.sites.map((s) => s.machineCount).sort((x, y) => x - y)).toEqual([2, 4]);
    const lonely = run([a, far], [ea, ef]);
    expect(lonely.sites).toHaveLength(2);
  });

  it("reports component and site counts in its stats", () => {
    const { b, e } = manifold(3);
    const { stats } = buildProductionGraphWithStats(b, e);
    expect(stats).toMatchObject({ components: 1, sites: 1, groups: 3 });
  });
});

describe("stale, unconnected and missing belt data", () => {
  it("lists a recipe machine no conveyor names and says the data is stale", () => {
    const { b, e } = manifold(1);
    const g = run([...b, machine("newbuild", { recipe: "Plate" }), machine("solar", { className: "Build_Solar_C", recipe: null })], e);
    expect(g.unconnectedMachineIds).toEqual(["newbuild"]);
    expect(g.beltData).toBe("stale");
    expect(g.notes.map((n) => n.code)).toContain("connectionsRefresh");
    expect(g.nodes.some((n) => n.machineIds.includes("newbuild"))).toBe(false);
  });

  it("returns an empty graph with the mode for unsupported and too-large belt data", () => {
    const b = [machine("a")];
    expect(run(b, "unsupported")).toMatchObject({ nodes: [], edges: [], sites: [], beltData: "unsupported" });
    expect(run(b, "tooLarge")).toMatchObject({ nodes: [], beltData: "tooLarge", notes: [{ code: "beltDataTooLarge" }] });
    expect(run(b, "notReceived")).toMatchObject({ nodes: [], sites: [], beltData: "notReceived", notes: [{ code: "beltDataNotReceived" }] });
    expect(run(b, [])).toMatchObject({ beltData: "stale", unconnectedMachineIds: ["a"] });
  });
});

describe("contract and determinism", () => {
  const mixedFactory = () => {
    const a = manifold(5, { at: [0, 0] });
    const c = manifold(3, { at: [4000, 0] });
    const rename = (id: string) => `z${id}`;
    const shifted = {
      b: c.b.map((x) => ({ ...x, id: rename(x.id) })),
      e: c.e.map((x) => ({
        ...x,
        id: rename(x.id),
        from: x.from === null ? null : rename(x.from),
        to: x.to === null ? null : rename(x.to),
      })),
    };
    return { b: [...a.b, ...shifted.b, machine("lonely", { recipe: "X" })], e: [...a.e, ...shifted.e] };
  };

  it("parses with ProductionGraphSchema", () => {
    const { b, e } = mixedFactory();
    const g = run(b, e);
    expect(() => ProductionGraphSchema.parse(g)).not.toThrow();
    expect(g.sites).toHaveLength(2);
  });

  it("is byte-identical for the same input in any order", () => {
    const { b, e } = mixedFactory();
    const a = JSON.stringify(run(b, e));
    const reversed = JSON.stringify(run([...b].reverse(), [...e].reverse()));
    expect(reversed).toBe(a);
    expect(JSON.stringify(run(b, e))).toBe(a);
  });
});

describe("a generated 10x factory", () => {
  // 338 clusters of 10 machines (3,380 buildings), as the finder's 10x test: a producer, a splitter, nine consumers
  // each into storage; clusters are 200 m apart so most are their own site. About 6,400 edges.
  function generate(): { buildings: FactoryBuilding[]; edges: ConveyorEdge[] } {
    const buildings: FactoryBuilding[] = [];
    const edges: ConveyorEdge[] = [];
    for (let k = 0; k < 338; k++) {
      const item = `Item${k % 40}_C`;
      const at: [number, number] = [(k % 20) * 400, Math.floor(k / 20) * 400];
      buildings.push(machine(`P${k}`, { className: SMELTER, recipe: `Make${k % 40}`, out: [[item, 270]], at }));
      edges.push(edge(`pe${k}`, `P${k}`, `S${k}`, { at }));
      for (let i = 0; i < 9; i++) {
        const id = `C${k}_${i}`;
        buildings.push(machine(id, { recipe: `Use${k % 40}`, ing: [[item, 30]], out: [[`Out${k % 40}_C`, 30]], at: [at[0] + i, at[1]] }));
        edges.push(edge(`se${k}_${i}`, `S${k}`, id, { at }), edge(`oe${k}_${i}`, id, `T${k}`, { at }));
      }
    }
    return { buildings, edges };
  }

  it("finishes inside a generous bound, parses, and groups each cluster", () => {
    const { buildings, edges } = generate();
    expect(buildings).toHaveLength(3380);
    const start = performance.now();
    const { graph, stats } = buildProductionGraphWithStats(buildings, edges);
    const parsed = ProductionGraphSchema.parse(graph);
    const ms = performance.now() - start;
    // The bound is generous so a slow CI runner never flakes; the real figure is a small fraction of it.
    expect(ms).toBeLessThan(5000);
    expect(parsed.nodes).toHaveLength(338 * 3);
    expect(parsed.beltData).toBe("present");
    expect(stats).toMatchObject({ components: 338, groups: 338 * 3 });
    expect(parsed.sites.length).toBe(stats.sites);
  });
});
