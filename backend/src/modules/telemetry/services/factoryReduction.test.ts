import { describe, expect, it } from "vitest";
import { PlannerFactorySchema, PlannerNodeSchema, type PlannerEdge, type PlannerNode, type PlannerRate, type PlannerTransport } from "@satisfactory-dash/shared";
import { DEPOT_NODE_CLASS, DEPOT_NODE_KEY } from "./logisticsEdges.js";
import { MIN_FACTORY_MACHINES, reduceFactories, type ReductionInput, type ReductionResult } from "./factoryReduction.js";
import { SINK_CLASS } from "./plannerFlows.js";

/** A small seeded generator (mulberry32), so the property tests need no dependency and fail reproducibly. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const snap = (v: number): number => Math.round(v / 50) * 50 || 0;
const rate = (className: string, max: number, cur = max): PlannerRate => ({ className, name: className.replace(/^Desc_|_C$/g, ""), unit: "items/min", currentPerMinute: cur, maxPerMinute: max });

interface NodeOpts {
  kind?: string;
  className?: string;
  count?: number;
  prod?: [string, number][];
  ing?: [string, number][];
  at?: [number, number];
  siteKey?: string;
  cur?: number;
  role?: string;
}
function node(key: string, o: NodeOpts = {}): PlannerNode {
  return {
    key,
    kind: o.kind ?? "machines",
    className: o.className ?? `Build_${key}_C`,
    name: key,
    recipe: o.kind === undefined || o.kind === "machines" ? `Recipe_${key}` : null,
    count: o.count ?? 1,
    machineIds: [],
    stateCounts: {},
    products: (o.prod ?? []).map(([c, m]) => rate(c, m, o.cur ?? m)),
    ingredients: (o.ing ?? []).map(([c, m]) => rate(c, m, o.cur ?? m)),
    at: { x: o.at?.[0] ?? 0, y: o.at?.[1] ?? 0 },
    siteKey: o.siteKey ?? "site|0|0",
    loop: false,
    ...(o.role === undefined ? {} : { role: o.role }),
  };
}
const extractor = (key: string, item: string, max = 100, at: [number, number] = [0, 0]): PlannerNode => node(key, { kind: "extractor", prod: [[item, max]], at });
const storage = (key: string): PlannerNode => node(key, { kind: "storage" });
const station = (key: string): PlannerNode => node(key, { kind: "station" });

function edge(from: string, to: string, item: string | null, flow: "supply" | "excess" | "output" = "supply", destination = "factory"): PlannerEdge {
  return {
    from,
    to,
    kind: "belt",
    itemClassName: item,
    itemName: item,
    ratePerMinute: null,
    rate: "unknown",
    mixed: false,
    capacityPerMinute: null,
    conveyorCount: 1,
    flow,
    destination,
  };
}
function transport(from: string, to: string, item: string | null, mode = "train", flow = "supply", destination = "factory"): PlannerTransport {
  return { from, to, mode, itemClassName: item, itemName: item, ratePerMinute: null, rate: "unknown", carriers: 1, routeName: null, flow, destination };
}

const run = (nodes: PlannerNode[], edges: PlannerEdge[], transports: PlannerTransport[] = []): ReductionResult => reduceFactories({ nodes, edges, transports, snap });
const factoryOf = (r: ReductionResult, key: string): string | undefined => r.annotations.get(key)?.factoryKey;
const factoryByName = (r: ReductionResult, name: string) => {
  const f = r.factories.find((x) => x.name === name);
  if (!f) throw new Error(`no factory named ${name}: ${r.factories.map((x) => x.name).join(", ")}`);
  return f;
};

/** ADR-0055's worked example: a remote farm joined by a train, a shared refinery, an overflow to the sink. */
function workedExample() {
  const nodes = [
    node("M", { kind: "extractor", count: 4, prod: [["Ore", 480]], at: [9000, 9000], siteKey: "site|far" }),
    storage("K1"),
    station("L"),
    station("U"),
    storage("K2"),
    node("W", { kind: "extractor", count: 3, prod: [["Water", 360]] }),
    node("R", { count: 6, ing: [["Ore", 480], ["Water", 360]], prod: [["Ingot", 400]] }),
    node("P", { ing: [["Ingot", 100]], prod: [["Plate", 80]] }),
    node("A", { ing: [["Plate", 80]], prod: [["Reinforced", 40]] }),
    node("D", { ing: [["Ingot", 200]], prod: [["Rod", 200]] }),
    node("F", { count: 2, ing: [["Reinforced", 40], ["Rod", 150]], prod: [["Frame", 20]] }),
    node("S", { kind: "storage" }),
    node("C", { ing: [["Rod", 50]], prod: [["Screw", 50]] }),
    node("X", { count: 4, ing: [["Screw", 50]], prod: [["Computer", 5]] }),
    node("T", { kind: "storage" }),
    node("Sink", { kind: "consumer", className: SINK_CLASS }),
  ];
  const edges = [
    edge("M", "K1", "Ore"),
    edge("K1", "L", "Ore"),
    edge("U", "K2", "Ore"),
    edge("K2", "R", "Ore"),
    edge("W", "R", "Water"),
    edge("R", "P", "Ingot"),
    edge("R", "D", "Ingot"),
    edge("P", "A", "Plate"),
    edge("A", "F", "Reinforced"),
    edge("D", "F", "Rod"),
    edge("D", "C", "Rod"),
    edge("C", "X", "Screw"),
    edge("F", "S", "Frame", "output", "storage"),
    edge("X", "T", "Computer", "output", "storage"),
    edge("P", "Sink", "Plate", "excess", "sink"),
  ];
  return { nodes, edges, transports: [transport("L", "U", "Ore")] };
}

describe("reduceFactories: the worked example", () => {
  const ex = workedExample();
  const r = run(ex.nodes, ex.edges, ex.transports);

  it("makes two factories, the Modular-Frame-like one holding the shared refinery and the remote farm", () => {
    expect(r.factories.map((f) => f.name).sort()).toEqual(["Computer factory", "Frame factory"]);
    const frame = factoryByName(r, "Frame factory");
    const computer = factoryByName(r, "Computer factory");
    for (const k of ["M", "K1", "L", "U", "K2", "W", "R", "P", "A", "D", "F", "S"]) expect(factoryOf(r, k), k).toBe(frame.key);
    for (const k of ["C", "X", "T"]) expect(factoryOf(r, k), k).toBe(computer.key);
    expect(frame.siteKeys).toContain("site|far");
    expect(frame.machineCount).toBe(6 + 1 + 1 + 1 + 2);
    expect(r.stats.unassignedGroups).toBe(0);
  });

  it("lists the split of a shared node and none for an unshared one", () => {
    const frame = factoryByName(r, "Frame factory");
    const computer = factoryByName(r, "Computer factory");
    const shares = r.annotations.get("R")?.shares ?? [];
    expect(shares.map((s) => s.factoryKey)).toEqual([frame.key, computer.key]);
    // R sends 100 of 300 to P (Frame only) and 200 of 300 to D, which sends 150 of 200 to F and 50 of 200 to C.
    expect(shares[0].share).toBeCloseTo(1 / 3 + (2 / 3) * 0.75, 5);
    expect(shares[1].share).toBeCloseTo((2 / 3) * 0.25, 5);
    expect(r.annotations.get("P")?.shares).toBeUndefined();
    expect(r.annotations.get("F")?.shares).toBeUndefined();
    expect(frame.sharedNodeCount).toBeGreaterThan(0);
  });

  it("does not make the overflow to the sink a seed, and fills roles", () => {
    expect(r.annotations.get("Sink")?.role).toBe("sink");
    expect(r.annotations.get("K1")?.role).toBe("buffer");
    expect(r.annotations.get("L")?.role).toBe("buffer");
    expect(r.annotations.get("S")?.role).toBe("storage");
    expect(r.stats.seeds).toBe(2);
  });

  it("collapses A and P under F, but never a node that also feeds another factory", () => {
    expect(r.annotations.get("A")?.collapseUnder).toBe("F");
    expect(r.annotations.get("P")?.collapseUnder).toBe("A");
    expect(r.annotations.get("F")?.collapseUnder).toBeNull();
    expect(r.annotations.get("D")?.collapseUnder).toBeNull();
    expect(r.annotations.get("R")?.collapseUnder).toBeNull();
  });

  it("produces records the contract accepts, with the products of the seeds", () => {
    for (const f of r.factories) expect(PlannerFactorySchema.safeParse(f).success).toBe(true);
    for (const nd of ex.nodes) {
      const ann = r.annotations.get(nd.key);
      expect(PlannerNodeSchema.safeParse({ ...nd, ...ann }).success, nd.key).toBe(true);
    }
    expect(factoryByName(r, "Frame factory").products).toEqual([expect.objectContaining({ className: "Frame", maxPerMinute: 20 })]);
  });
});

describe("seeds: merge and split", () => {
  it("merges seeds of one product that share a non-raw supplier, and splits disjoint ones", () => {
    const shared = [
      extractor("E", "Ore"),
      node("R", { count: 4, ing: [["Ore", 100]], prod: [["Ingot", 100]] }),
      node("G1", { count: 4, ing: [["Ingot", 50]], prod: [["Gear", 10]] }),
      node("G2", { count: 4, ing: [["Ingot", 50]], prod: [["Gear", 10]] }),
      storage("S1"),
      storage("S2"),
    ];
    const edges = [edge("E", "R", "Ore"), edge("R", "G1", "Ingot"), edge("R", "G2", "Ingot"), edge("G1", "S1", "Gear", "output", "storage"), edge("G2", "S2", "Gear", "output", "storage")];
    const merged = run(shared, edges);
    expect(merged.factories).toHaveLength(1);
    expect(factoryOf(merged, "G1")).toBe(factoryOf(merged, "G2"));

    const disjoint = [
      extractor("E1", "Ore"),
      extractor("E2", "Ore"),
      node("R1", { count: 4, ing: [["Ore", 100]], prod: [["Ingot", 100]] }),
      node("R2", { count: 4, ing: [["Ore", 100]], prod: [["Ingot", 100]] }),
      node("G1", { count: 4, ing: [["Ingot", 50]], prod: [["Gear", 10]] }),
      node("G2", { count: 4, ing: [["Ingot", 50]], prod: [["Gear", 10]] }),
      storage("S1"),
      storage("S2"),
    ];
    const split = run(disjoint, [
      edge("E1", "R1", "Ore"),
      edge("E2", "R2", "Ore"),
      edge("R1", "G1", "Ingot"),
      edge("R2", "G2", "Ingot"),
      edge("G1", "S1", "Gear", "output", "storage"),
      edge("G2", "S2", "Gear", "output", "storage"),
    ]);
    expect(split.factories).toHaveLength(2);
    expect(split.factories.map((f) => f.name).sort()).toEqual(["Gear factory", "Gear factory 2"]);
    expect(factoryOf(split, "G1")).not.toBe(factoryOf(split, "G2"));
    expect(new Set(split.factories.map((f) => f.key)).size).toBe(2);
  });

  it("does not join seeds that share only a raw extractor", () => {
    const nodes = [
      extractor("E", "Ore"),
      node("G1", { count: 4, ing: [["Ore", 50]], prod: [["Gear", 10]] }),
      node("G2", { count: 4, ing: [["Ore", 50]], prod: [["Gear", 10]] }),
      storage("S1"),
      storage("S2"),
    ];
    const r = run(nodes, [edge("E", "G1", "Ore"), edge("E", "G2", "Ore"), edge("G1", "S1", "Gear", "output", "storage"), edge("G2", "S2", "Gear", "output", "storage")]);
    expect(r.factories).toHaveLength(2);
    expect(r.annotations.get("E")?.shares).toHaveLength(2);
  });

  it("names an extractor that feeds only storage or the Depot a farm, and gives a machine with nothing downstream its own factory", () => {
    const nodes = [extractor("E", "Ore"), storage("S"), node("Lonely", { count: 4, ing: [["X", 1]], prod: [["Widget", 1]] })];
    const r = run(nodes, [edge("E", "S", "Ore", "output", "storage")]);
    expect(r.factories.map((f) => f.name).sort()).toEqual(["Ore farm", "Widget factory"]);
    expect(factoryOf(r, "S")).toBe(factoryOf(r, "E"));
  });
});

describe("ties and shares", () => {
  const two = (seedMaxA: number, seedMaxB: number) => {
    const nodes = [
      extractor("E", "Ore"),
      node("R", { count: 4, ing: [["Ore", 100]], prod: [["Ingot", 100]] }),
      node("A", { count: 4, ing: [["Ingot", 50]], prod: [["Alpha", seedMaxA]] }),
      node("B", { count: 4, ing: [["Ingot", 50]], prod: [["Beta", seedMaxB]] }),
      storage("SA"),
      storage("SB"),
    ];
    const edges = [edge("E", "R", "Ore"), edge("R", "A", "Ingot"), edge("R", "B", "Ingot"), edge("A", "SA", "Alpha", "output", "storage"), edge("B", "SB", "Beta", "output", "storage")];
    return run(nodes, edges);
  };
  it("breaks an exact tie by the larger seed output", () => {
    const r = two(10, 30);
    expect(r.annotations.get("R")?.factoryKey).toBe(factoryOf(r, "B"));
    expect(r.annotations.get("E")?.factoryKey).toBe(factoryOf(r, "B"));
    expect(r.annotations.get("R")?.shares).toHaveLength(2);
  });
  it("then by the lower factory key", () => {
    const r = two(20, 20);
    const keys = [factoryOf(r, "A"), factoryOf(r, "B")].sort() as string[];
    expect(r.annotations.get("R")?.factoryKey).toBe(keys[0]);
  });
  it("calls a node shared only under 0.95, and sums the remainder past four factories as other", () => {
    const nodes: PlannerNode[] = [extractor("E", "Ore"), node("R", { count: 4, ing: [["Ore", 1000]], prod: [["Ingot", 1000]] })];
    const edges: PlannerEdge[] = [edge("E", "R", "Ore")];
    for (let i = 0; i < 7; i++) {
      nodes.push(node(`G${i}`, { count: 4, ing: [["Ingot", 100]], prod: [[`Out${i}`, 10]] }), storage(`S${i}`));
      edges.push(edge("R", `G${i}`, "Ingot"), edge(`G${i}`, `S${i}`, `Out${i}`, "output", "storage"));
    }
    const r = run(nodes, edges);
    const shares = r.annotations.get("R")?.shares ?? [];
    expect(shares).toHaveLength(5);
    expect(shares[4].factoryKey).toBe("other");
    expect(shares.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 5);
  });
  it("splits unknown-item arcs equally and ignores excess and output arcs in the denominator", () => {
    const nodes = [
      node("Src", { count: 4, prod: [["Ingot", 100]] }),
      node("A", { count: 4, ing: [["Ingot", 10]], prod: [["Alpha", 1]] }),
      node("B", { count: 4, prod: [["Beta", 1]] }),
      storage("SA"),
      storage("SB"),
      node("Sink", { kind: "consumer", className: SINK_CLASS }),
    ];
    const r = run(nodes, [
      edge("Src", "A", "Ingot"),
      edge("Src", "B", null),
      edge("Src", "Sink", "Ingot", "excess", "sink"),
      edge("A", "SA", "Alpha", "output", "storage"),
      edge("B", "SB", "Beta", "output", "storage"),
    ]);
    const shares = r.annotations.get("Src")?.shares ?? [];
    expect(shares).toHaveLength(2);
  });
});

describe("small dependent factories fold (Decision 6, option C)", () => {
  /** Main line: E -> R -> G -> S. Offshoot: R -> Rod (1 machine) -> S2, taking everything from the main factory only. */
  const base = (extra: { offshootOut?: "storage" | "depot" | "sink"; ownExtractor?: boolean; secondInput?: boolean; train?: boolean } = {}) => {
    const nodes = [
      extractor("E", "Ore"),
      node("R", { count: 6, ing: [["Ore", 100]], prod: [["Ingot", 100]] }),
      node("G", { count: 4, ing: [["Ingot", 50]], prod: [["Gear", 10]] }),
      storage("S"),
      node("Rod", { count: 1, ing: [["Ingot", 50]], prod: [["Rod", 5]] }),
      storage("S2"),
    ];
    const edges = [edge("E", "R", "Ore"), edge("R", "G", "Ingot"), edge("R", "Rod", "Ingot"), edge("G", "S", "Gear", "output", "storage"), edge("Rod", "S2", "Rod", "output", "storage")];
    const transports: PlannerTransport[] = [];
    if (extra.offshootOut === "depot") {
      nodes.push(node("Up", { kind: "storage", className: "Build_CentralStorage_C" }));
      edges.pop();
      edges.push(edge("Rod", "Up", "Rod", "output", "depot"));
    }
    if (extra.offshootOut === "sink") {
      nodes.push(node("Sink", { kind: "consumer", className: SINK_CLASS }));
      edges.pop();
      edges.push(edge("Rod", "Sink", "Rod", "output", "sink"));
    }
    if (extra.ownExtractor) {
      nodes.push(extractor("E2", "Ore"));
      edges.push(edge("E2", "Rod", "Ore"));
    }
    if (extra.secondInput) {
      nodes.push(extractor("E3", "Ore"), node("Other", { count: 4, ing: [["Ore", 1]], prod: [["Other", 1]] }), storage("S3"));
      edges.push(edge("E3", "Other", "Ore"), edge("Other", "Rod", "Other"), edge("Other", "S3", "Other", "output", "storage"));
    }
    if (extra.train) {
      nodes.push(station("L"), station("U"));
      edges.splice(edges.findIndex((e) => e.from === "Rod"), 1, edge("Rod", "L", "Rod"));
      transports.push(transport("L", "U", "Rod", "train", "output", "export"));
    }
    return run(nodes, edges, transports);
  };

  it("folds a small offshoot into the factory it depends on and lists its product as a side product", () => {
    const r = base();
    expect(r.factories).toHaveLength(1);
    const f = r.factories[0];
    expect(f.name).toBe("Gear factory");
    expect(f.sideProducts).toEqual(["Rod"]);
    expect(factoryOf(r, "Rod")).toBe(f.key);
    expect(factoryOf(r, "S2")).toBe(f.key);
    expect(f.machineCount).toBe(6 + 4 + 1);
    expect(r.annotations.get("R")?.shares).toBeUndefined();
    expect(r.stats.unassignedGroups).toBe(0);
  });

  it.each([
    ["has its own extractor", { ownExtractor: true }],
    ["takes inputs from more than one factory", { secondInput: true }],
    ["sends its output to the Depot", { offshootOut: "depot" as const }],
    ["sends its output to the sink", { offshootOut: "sink" as const }],
    ["sends its output by train", { train: true }],
  ])("keeps a small factory that %s", (_n, extra) => {
    const r = base(extra);
    expect(r.factories.length).toBeGreaterThan(1);
    expect(factoryByName(r, "Rod factory").machineCount).toBeLessThan(MIN_FACTORY_MACHINES);
  });

  it("does not fold a factory of four machines", () => {
    const nodes = [
      extractor("E", "Ore"),
      node("R", { count: 6, ing: [["Ore", 100]], prod: [["Ingot", 100]] }),
      node("G", { count: 4, ing: [["Ingot", 50]], prod: [["Gear", 10]] }),
      node("Rod", { count: MIN_FACTORY_MACHINES, ing: [["Ingot", 50]], prod: [["Rod", 5]] }),
      storage("S"),
      storage("S2"),
    ];
    const r = run(nodes, [edge("E", "R", "Ore"), edge("R", "G", "Ingot"), edge("R", "Rod", "Ingot"), edge("G", "S", "Gear", "output", "storage"), edge("Rod", "S2", "Rod", "output", "storage")]);
    expect(r.factories).toHaveLength(2);
  });

  it("folds a chain of small offshoots into the one they ultimately depend on", () => {
    const nodes = [
      extractor("E", "Ore"),
      node("R", { count: 6, ing: [["Ore", 100]], prod: [["Ingot", 100]] }),
      node("G", { count: 4, ing: [["Ingot", 50]], prod: [["Gear", 10]] }),
      node("Rod", { ing: [["Ingot", 50]], prod: [["Rod", 5]] }),
      node("Screw", { ing: [["Rod", 5]], prod: [["Screw", 5]] }),
      storage("S"),
      storage("S2"),
      storage("S3"),
    ];
    const r = run(nodes, [
      edge("E", "R", "Ore"),
      edge("R", "G", "Ingot"),
      edge("R", "Rod", "Ingot"),
      edge("G", "S", "Gear", "output", "storage"),
      edge("Rod", "S2", "Rod", "output", "storage"),
      edge("Rod", "Screw", "Rod"),
      edge("Screw", "S3", "Screw", "output", "storage"),
    ]);
    expect(r.factories).toHaveLength(1);
    expect(r.factories[0].sideProducts).toEqual(["Rod", "Screw"]);
  });
});

describe("loops", () => {
  it("handles a loop that feeds an output, giving its members one vector", () => {
    const nodes = [
      extractor("E", "Ore"),
      node("A", { count: 2, ing: [["Ore", 10], ["Back", 5]], prod: [["Mid", 10]] }),
      node("B", { count: 2, ing: [["Mid", 10]], prod: [["Back", 5], ["Out", 5]] }),
      storage("S"),
    ];
    const r = run(nodes, [edge("E", "A", "Ore"), edge("A", "B", "Mid"), edge("B", "A", "Back"), edge("B", "S", "Out", "output", "storage")]);
    expect(r.factories).toHaveLength(1);
    expect(factoryOf(r, "A")).toBe(factoryOf(r, "B"));
    expect(r.stats.unassignedGroups).toBe(0);
  });
  it("makes a closed loop with no output one factory", () => {
    const nodes = [node("A", { count: 2, prod: [["X", 1]] }), node("B", { count: 2, prod: [["Y", 1]] }), node("C", { count: 2, prod: [["Z", 1]] })];
    const r = run(nodes, [edge("A", "B", "X"), edge("B", "C", "Y"), edge("C", "A", "Z")]);
    expect(r.factories).toHaveLength(1);
    expect(r.stats.unassignedGroups).toBe(0);
    expect(r.stats.seeds).toBe(1);
  });
});

describe("invariants", () => {
  it("is byte-identical on shuffled nodes, edges and transports", () => {
    const ex = workedExample();
    const base = JSON.stringify(serialise(run(ex.nodes, ex.edges, ex.transports)));
    const rnd = rng(7);
    for (let i = 0; i < 10; i++) {
      const shuffle = <T>(xs: T[]): T[] => xs.map((x) => [rnd(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
      expect(JSON.stringify(serialise(run(shuffle(ex.nodes), shuffle(ex.edges), shuffle(ex.transports))))).toBe(base);
    }
  });

  it("is unchanged by distance: moving the remote farm 5 km away", () => {
    const ex = workedExample();
    const a = run(ex.nodes, ex.edges, ex.transports);
    const moved = ex.nodes.map((nd) => (nd.key === "M" || nd.key === "K1" || nd.key === "L" ? { ...nd, at: { x: nd.at.x + 5000, y: nd.at.y - 5000 } } : nd));
    const b = run(moved, ex.edges, ex.transports);
    expect(serialise(b).annotations).toEqual(serialise(a).annotations);
    expect(serialise(b).factories).toEqual(serialise(a).factories);
  });

  it("is unchanged by current rates alone, and the hash changes only with the topology or a max", () => {
    const ex = workedExample();
    const a = run(ex.nodes, ex.edges, ex.transports);
    const noisy = ex.nodes.map((nd) => ({
      ...nd,
      stateCounts: { working: 1 },
      products: nd.products.map((p) => ({ ...p, currentPerMinute: p.maxPerMinute / 3 })),
      ingredients: nd.ingredients.map((p) => ({ ...p, currentPerMinute: 0 })),
    }));
    const b = run(noisy, ex.edges.map((e) => ({ ...e, ratePerMinute: 12, rate: "estimated" as const })), ex.transports);
    expect(b.topologyHash).toBe(a.topologyHash);
    // A factory's product shows the live rate, so only that field may differ.
    const noLive = (r: ReductionResult) => ({ ...serialise(r), factories: r.factories.map((f) => ({ ...f, products: f.products.map((p) => ({ ...p, currentPerMinute: 0 })) })) });
    expect(noLive(b)).toEqual(noLive(a));
    const faster = ex.nodes.map((nd) => (nd.key === "D" ? { ...nd, products: [rate("Rod", 400)] } : nd));
    expect(run(faster, ex.edges, ex.transports).topologyHash).not.toBe(a.topologyHash);
    expect(run(ex.nodes, ex.edges.slice(1), ex.transports).topologyHash).not.toBe(a.topologyHash);
  });

  it("attributes an extractor that feeds only one factory to it, and a second consumer only lowers a share", () => {
    const ex = workedExample();
    const a = run(ex.nodes, ex.edges, ex.transports);
    const frame = factoryByName(a, "Frame factory").key;
    const withFarm = run([...ex.nodes, extractor("E9", "Ingot", 50)], [...ex.edges, edge("E9", "P", "Ingot")], ex.transports);
    expect(factoryOf(withFarm, "E9")).toBe(factoryOf(withFarm, "P"));
    expect(factoryOf(withFarm, "E9")).toBeDefined();
    expect(withFarm.annotations.get("E9")?.shares).toBeUndefined();

    const frameShare = (r: ReductionResult): number => r.annotations.get("R")?.shares?.find((s) => s.factoryKey === frame)?.share ?? 1;
    const more = run(
      [...ex.nodes, node("Y", { count: 4, ing: [["Ingot", 400]], prod: [["Why", 1]] }), storage("SY")],
      [...ex.edges, edge("R", "Y", "Ingot"), edge("Y", "SY", "Why", "output", "storage")],
      ex.transports,
    );
    const frame2 = more.factories.find((f) => f.name === "Frame factory")?.key ?? frame;
    const share2 = more.annotations.get("R")?.shares?.find((s) => s.factoryKey === frame2)?.share ?? 1;
    expect(share2).toBeLessThan(frameShare(a));
  });

  it("gives the Depot virtual node no factory, and its uploaders the factories that feed them", () => {
    const nodes = [
      extractor("E", "Ore"),
      node("G", { count: 4, ing: [["Ore", 50]], prod: [["Gear", 10]] }),
      node("Up", { kind: "storage", className: "Build_CentralStorage_C" }),
      node(DEPOT_NODE_KEY, { kind: "storage", className: DEPOT_NODE_CLASS, role: "depot", siteKey: "depot", count: 1 }),
    ];
    const r = run(nodes, [edge("E", "G", "Ore"), edge("G", "Up", "Gear", "output", "depot")], [transport("Up", DEPOT_NODE_KEY, "Gear", "depot", "output", "depot")]);
    expect(factoryOf(r, DEPOT_NODE_KEY)).toBeUndefined();
    expect(factoryOf(r, "Up")).toBe(factoryOf(r, "G"));
    expect(r.annotations.get("Up")?.role).toBe("depot");
    expect(r.factories).toHaveLength(1);
    expect(r.factories[0].siteKeys).not.toContain("depot");
  });

  it("returns an empty reduction for an empty graph and ignores arcs naming unknown nodes", () => {
    const r = run([], [edge("a", "b", "X")]);
    expect(r.factories).toEqual([]);
    expect(r.stats.factories).toBe(0);
    expect(r.stats.lowestTopShare).toBe(1);
  });
});

/** Everything observable except nothing: used to compare two runs byte for byte. */
function serialise(r: ReductionResult) {
  return { annotations: [...r.annotations.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), factories: r.factories, hash: r.topologyHash, stats: r.stats };
}

interface Generated {
  nodes: PlannerNode[];
  edges: PlannerEdge[];
  transports: PlannerTransport[];
}

/** Layered random supply graphs: extractors, machines in `layers` layers, optional buffers, outputs into storage. */
function generate(seed: number, layers: number, width: number, fan = 2): Generated {
  const rnd = rng(seed);
  const nodes: PlannerNode[] = [];
  const edges: PlannerEdge[] = [];
  const layerKeys: string[][] = [];
  for (let l = 0; l < layers; l++) {
    const keys: string[] = [];
    const w = 1 + Math.floor(rnd() * width);
    for (let i = 0; i < w; i++) {
      const key = `n${l}_${i}`;
      keys.push(key);
      if (l === 0) nodes.push(extractor(key, `I0`, 50 + Math.floor(rnd() * 100), [Math.floor(rnd() * 5000), Math.floor(rnd() * 5000)]));
      else {
        const item = `I${l}_${Math.floor(rnd() * 3)}`;
        nodes.push(node(key, { count: 1 + Math.floor(rnd() * 4), ing: [[`I${l - 1}`, 20 + Math.floor(rnd() * 80)]], prod: [[`I${l}`, 20 + Math.floor(rnd() * 80)], [item, 5]], at: [Math.floor(rnd() * 5000), Math.floor(rnd() * 5000)] }));
      }
    }
    layerKeys.push(keys);
  }
  const seen = new Set<string>();
  const add = (from: string, to: string, item: string, flow: "supply" | "output" = "supply", dest = "factory"): void => {
    const k = `${from}|${to}|${item}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push(edge(from, to, item, flow, dest));
  };
  for (let l = 0; l + 1 < layers; l++) {
    for (const from of layerKeys[l]) {
      const targets = 1 + Math.floor(rnd() * fan);
      for (let t = 0; t < targets; t++) {
        const to = layerKeys[l + 1][Math.floor(rnd() * layerKeys[l + 1].length)];
        add(from, to, `I${l}`);
      }
    }
    // Every node gets an input, so no machine is orphaned from its layer.
    for (const to of layerKeys[l + 1]) add(layerKeys[l][Math.floor(rnd() * layerKeys[l].length)], to, `I${l}`);
  }
  // Some last-layer nodes output to storage; some mid-layer nodes too (a product that leaves early).
  layerKeys[layers - 1].forEach((k, i) => {
    nodes.push(storage(`out${i}`));
    add(k, `out${i}`, `I${layers - 1}`, "output", "storage");
  });
  if (layers > 2) {
    const k = layerKeys[1][0];
    nodes.push(storage("early"));
    add(k, "early", "I1", "output", "storage");
  }
  return { nodes, edges, transports: [] };
}

describe("property tests on generated graphs", () => {
  const cases = Array.from({ length: 40 }, (_, i) => i + 1);

  it.each(cases)("seed %i: every machine in one factory, shares sum to 1, records valid", (seed) => {
    const g = generate(seed, 2 + (seed % 5), 2 + (seed % 7), 1 + (seed % 3));
    const r = run(g.nodes, g.edges, g.transports);
    const owned = new Map<string, string>();
    for (const f of r.factories) {
      expect(PlannerFactorySchema.safeParse(f).success).toBe(true);
      for (const k of f.nodeKeys) {
        expect(owned.has(k), `${k} in two factories`).toBe(false);
        owned.set(k, f.key);
      }
    }
    expect(r.stats.unassignedGroups).toBe(0);
    for (const nd of g.nodes) {
      const ann = r.annotations.get(nd.key) as { factoryKey?: string; shares?: { share: number }[] };
      if (nd.kind === "machines") expect(owned.get(nd.key), nd.key).toBe(ann.factoryKey);
      if (ann.shares) expect(ann.shares.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 5);
      if (ann.factoryKey !== undefined) expect(owned.get(nd.key)).toBe(ann.factoryKey);
    }
    // Seeds: between 1 and the seed count; here the factory count never exceeds the seeds.
    expect(r.stats.factories).toBeGreaterThanOrEqual(1);
    expect(r.stats.factories).toBeLessThanOrEqual(r.stats.seeds);
    // Determinism on a shuffle.
    const rnd = rng(seed * 31);
    const shuffle = <T>(xs: T[]): T[] => xs.map((x) => [rnd(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
    expect(JSON.stringify(serialise(run(shuffle(g.nodes), shuffle(g.edges), [])))).toBe(JSON.stringify(serialise(r)));
  });

  it.each(cases)("seed %i: hiding what a node post-dominates never hides a node with a path to the output that avoids it", (seed) => {
    const g = generate(seed + 100, 3 + (seed % 4), 2 + (seed % 5), 1 + (seed % 3));
    const r = run(g.nodes, g.edges);
    const home = (k: string): string | undefined => r.annotations.get(k)?.factoryKey;
    const succ = new Map<string, string[]>();
    for (const e of g.edges) if ((e.flow ?? "supply") === "supply") succ.set(e.from, [...(succ.get(e.from) ?? []), e.to]);
    const isExit = (k: string): boolean => {
      const out = succ.get(k) ?? [];
      return out.length === 0 || out.some((t) => home(t) !== home(k)) || g.edges.some((e) => e.from === k && e.flow === "output");
    };
    const under = (k: string): string[] => {
      const chain: string[] = [];
      for (let c = r.annotations.get(k)?.collapseUnder ?? null; c !== null; c = r.annotations.get(c)?.collapseUnder ?? null) {
        chain.push(c);
        if (chain.length > 1000) throw new Error("collapseUnder cycle");
      }
      return chain;
    };
    for (const x of g.nodes) {
      const chain = under(x.key);
      for (const y of chain) {
        expect(home(y)).toBe(home(x.key));
        // Remove y: x must no longer reach any exit within its factory.
        const stack = [x.key];
        const seen = new Set<string>([x.key, y]);
        while (stack.length > 0) {
          const v = stack.pop() as string;
          expect(isExit(v), `${x.key} reaches an exit around ${y} via ${v}`).toBe(false);
          for (const t of succ.get(v) ?? []) {
            if (!seen.has(t) && home(t) === home(x.key)) {
              seen.add(t);
              stack.push(t);
            }
          }
        }
      }
    }
  });
});

describe("cost", () => {
  it("reduces a 10x site (about 2,100 groups) and a capped maximum graph within the planner's budget", () => {
    const small = generate(5, 8, 30);
    const big = generate(9, 40, 250, 3);
    const nodesBig = big.nodes.length;
    expect(nodesBig).toBeGreaterThan(2_000);
    for (const [g, budgetMs] of [
      [small, 100],
      [big, 400],
    ] as const) {
      const input: ReductionInput = { nodes: g.nodes, edges: g.edges, transports: g.transports, snap };
      reduceFactories(input); // warm up the JIT, so the timing is the steady cost
      const t0 = performance.now();
      const r = reduceFactories(input);
      const ms = performance.now() - t0;
      expect(r.stats.unassignedGroups).toBe(0);
      expect(ms).toBeLessThan(budgetMs);
    }
  });
});
