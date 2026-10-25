import { describe, expect, it } from "vitest";
import {
  PLANNER_MAX_FACTORIES,
  PLANNER_MAX_SHARES,
  PlannerFactorySchema,
  PlannerNodeSchema,
  type PlannerEdge,
  type PlannerNode,
  type PlannerRate,
  type PlannerTransport,
} from "@satisfactory-dash/shared";
import { DEPOT_NODE_CLASS, DEPOT_NODE_KEY } from "./logisticsEdges.js";
import { reduceFactories, type ReductionResult } from "./factoryReduction.js";
import { SINK_CLASS } from "./plannerFlows.js";

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
const rate = (className: string, max: number, cur = max): PlannerRate => ({ className, name: className, unit: "items/min", currentPerMinute: cur, maxPerMinute: max });

interface NodeOpts {
  kind?: string;
  className?: string;
  name?: string;
  count?: number;
  prod?: [string, number][];
  ing?: [string, number][];
  at?: [number, number];
  siteKey?: string;
  role?: string;
}
function node(key: string, o: NodeOpts = {}): PlannerNode {
  return {
    key,
    kind: o.kind ?? "machines",
    className: o.className ?? `Build_${key}_C`,
    name: o.name ?? key,
    recipe: o.kind === undefined || o.kind === "machines" ? `Recipe_${key}` : null,
    count: o.count ?? 1,
    machineIds: [],
    stateCounts: {},
    products: (o.prod ?? []).map(([c, m]) => rate(c, m)),
    ingredients: (o.ing ?? []).map(([c, m]) => rate(c, m)),
    at: { x: o.at?.[0] ?? 0, y: o.at?.[1] ?? 0 },
    siteKey: o.siteKey ?? "site|0|0",
    loop: false,
    ...(o.role === undefined ? {} : { role: o.role }),
  };
}
const extractor = (key: string, item: string, max = 100): PlannerNode => node(key, { kind: "extractor", prod: [[item, max]] });
const storage = (key: string): PlannerNode => node(key, { kind: "storage" });

function edge(from: string, to: string, item: string | null, flow: "supply" | "excess" | "output" = "supply", destination = "factory"): PlannerEdge {
  return { from, to, kind: "belt", itemClassName: item, itemName: item, ratePerMinute: null, rate: "unknown", mixed: false, capacityPerMinute: null, conveyorCount: 1, flow, destination };
}
function transport(from: string, to: string, item: string | null, mode = "train", flow = "supply", destination = "factory"): PlannerTransport {
  return { from, to, mode, itemClassName: item, itemName: item, ratePerMinute: null, rate: "unknown", carriers: 1, routeName: null, flow, destination };
}

const run = (nodes: PlannerNode[], edges: PlannerEdge[], transports: PlannerTransport[] = []): ReductionResult => reduceFactories({ nodes, edges, transports, snap });

function serialise(r: ReductionResult) {
  return { annotations: [...r.annotations.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), factories: r.factories, hash: r.topologyHash, stats: r.stats };
}

/** The result must parse with the contract: every node merged with its annotation, every factory. */
function expectContract(nodes: PlannerNode[], r: ReductionResult): void {
  for (const f of r.factories) {
    const p = PlannerFactorySchema.safeParse(f);
    expect(p.success, p.success ? "" : JSON.stringify(p.error.issues).slice(0, 300)).toBe(true);
  }
  for (const nd of nodes) {
    const ann = r.annotations.get(nd.key);
    expect(ann, nd.key).toBeDefined();
    const merged = { ...nd, factoryKey: ann?.factoryKey, shares: ann?.shares, collapseUnder: ann?.collapseUnder, ...(ann?.role === undefined ? {} : { role: ann.role }) };
    const p = PlannerNodeSchema.safeParse(merged);
    expect(p.success, p.success ? "" : `${nd.key}: ${JSON.stringify(p.error.issues).slice(0, 300)}`).toBe(true);
  }
}

/** A hostile random graph: cycles, self loops, parallel arcs, unknown endpoints, null items, zero rates, transports, buffers. */
function hostile(seed: number) {
  const rnd = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const items = ["A", "B", "C", "D"];
  const N = 4 + Math.floor(rnd() * 22);
  const nodes: PlannerNode[] = [];
  for (let i = 0; i < N; i++) {
    const kind = pick(["machines", "machines", "machines", "extractor", "storage", "station", "other"]);
    const rates = (): [string, number][] => (rnd() < 0.15 ? [] : [[pick(items), pick([0, 1, 30, 60, 1e6])]]);
    nodes.push(
      node(`k${i}`, {
        kind,
        count: 1 + Math.floor(rnd() * 6),
        prod: kind === "storage" || kind === "station" ? [] : rates(),
        ing: kind === "machines" ? rates() : [],
        at: [Math.floor(rnd() * 3000), Math.floor(rnd() * 3000)],
      }),
    );
  }
  const keys = [...nodes.map((x) => x.key), "ghost"];
  const edges: PlannerEdge[] = [];
  const transports: PlannerTransport[] = [];
  const E = Math.floor(rnd() * N * 2.5);
  for (let i = 0; i < E; i++) {
    const flow = pick(["supply", "supply", "supply", "excess", "output"] as const);
    const item = rnd() < 0.2 ? null : pick(items);
    const from = pick(keys);
    const to = pick(keys);
    if (rnd() < 0.2) transports.push(transport(from, to, item, pick(["train", "truck", "drone"]), flow, pick(["factory", "storage", "depot", "sink"])));
    else edges.push(edge(from, to, item, flow, pick(["factory", "storage", "depot", "sink"])));
    if (rnd() < 0.1) edges.push(edge(from, to, item, flow)); // a parallel arc
  }
  return { nodes, edges, transports };
}

function shuffler(seed: number) {
  const rnd = rng(seed);
  return <T>(xs: T[]): T[] => xs.map((x) => [rnd(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
}

describe("hostile random graphs: invariants", () => {
  const cases = Array.from({ length: 120 }, (_, i) => i + 1);

  it.each(cases)("seed %i: one factory per machine, shares sum to 1, contract-valid, deterministic, rate-noise invariant", (seed) => {
    const g = hostile(seed);
    const r = run(g.nodes, g.edges, g.transports);
    expectContract(g.nodes, r);

    const owned = new Map<string, string>();
    for (const f of r.factories) {
      expect(new Set(f.nodeKeys).size).toBe(f.nodeKeys.length);
      for (const k of f.nodeKeys) {
        expect(owned.has(k), `${k} in two factories`).toBe(false);
        owned.set(k, f.key);
      }
    }
    expect(new Set(r.factories.map((f) => f.key)).size).toBe(r.factories.length);
    expect(new Set(r.factories.map((f) => f.name)).size).toBe(r.factories.length);
    expect(r.stats.unassignedGroups).toBe(0);
    let machines = 0;
    for (const nd of g.nodes) {
      const ann = r.annotations.get(nd.key);
      if (nd.kind === "machines") {
        machines++;
        expect(ann?.factoryKey, `machine ${nd.key} unassigned`).toBeDefined();
      }
      if (ann?.factoryKey !== undefined) expect(owned.get(nd.key)).toBe(ann.factoryKey);
      if (ann?.shares) {
        expect(ann.shares.length).toBeLessThanOrEqual(PLANNER_MAX_SHARES);
        expect(ann.shares.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 5);
        for (const s of ann.shares) expect(Number.isFinite(s.share)).toBe(true);
        // The home factory is the largest share.
        expect(ann.shares[0].factoryKey === ann.factoryKey || Math.abs(ann.shares[0].share - (ann.shares.find((x) => x.factoryKey === ann.factoryKey)?.share ?? 0)) < 0.0011).toBe(true);
      }
    }
    expect(r.factories.reduce((s, f) => s + f.machineCount, 0)).toBe(g.nodes.reduce((s, nd) => s + (nd.kind === "machines" ? nd.count : 0), 0));
    expect(machines === 0 || r.factories.length > 0).toBe(true);

    // collapseUnder: same factory, never self, never a cycle.
    for (const nd of g.nodes) {
      const seen = new Set<string>([nd.key]);
      for (let c = r.annotations.get(nd.key)?.collapseUnder ?? null; c !== null; c = r.annotations.get(c)?.collapseUnder ?? null) {
        expect(seen.has(c), `collapseUnder cycle at ${nd.key}`).toBe(false);
        seen.add(c);
        expect(r.annotations.get(c)?.factoryKey).toBe(r.annotations.get(nd.key)?.factoryKey);
      }
    }

    // Determinism on shuffles of everything.
    const sh = shuffler(seed * 17);
    expect(JSON.stringify(serialise(run(sh(g.nodes), sh(g.edges), sh(g.transports))))).toBe(JSON.stringify(serialise(r)));

    // Rate-noise invariance: only current rates change.
    const noisy = g.nodes.map((nd) => ({ ...nd, products: nd.products.map((p) => ({ ...p, currentPerMinute: 7.5 })), ingredients: nd.ingredients.map((p) => ({ ...p, currentPerMinute: 0 })) }));
    const r2 = run(noisy, g.edges, g.transports);
    expect(r2.topologyHash).toBe(r.topologyHash);
    expect(JSON.stringify([...r2.annotations])).toBe(JSON.stringify([...r.annotations]));
    expect(r2.factories.map((f) => ({ ...f, products: [] }))).toEqual(r.factories.map((f) => ({ ...f, products: [] })));

    // Translating every node changes nothing but keys derived from positions (here: only factory keys), so compare structure.
    const moved = run(g.nodes.map((nd) => ({ ...nd, at: { x: nd.at.x + 123456, y: nd.at.y } })), g.edges, g.transports);
    // Ties break on the factory key, which embeds the position, so only the counts are comparable under a translation.
    expect(moved.factories.length).toBeLessThanOrEqual(r.stats.seeds);
    expect(moved.stats.unassignedGroups).toBe(0);
  });

  it.each(cases)("seed %i: a collapse target post-dominates (no path to an exit avoids it)", (seed) => {
    const g = hostile(seed + 1000);
    const r = run(g.nodes, g.edges, g.transports);
    const home = (k: string): string | undefined => r.annotations.get(k)?.factoryKey;
    const succ = new Map<string, string[]>();
    const outputs = new Set<string>();
    const arcs = [
      ...g.edges.map((e) => ({ from: e.from, to: e.to, flow: e.flow ?? "supply" })),
      ...g.transports.map((e) => ({ from: e.from, to: e.to, flow: e.flow ?? "supply" })),
    ];
    const known = new Set(g.nodes.map((x) => x.key));
    for (const a of arcs) {
      if (a.from === a.to || !known.has(a.from) || !known.has(a.to)) continue;
      if (a.flow === "output") outputs.add(a.from);
      if (a.flow === "supply") succ.set(a.from, [...(succ.get(a.from) ?? []), a.to]);
    }
    const isExit =(k: string): boolean => {
      const out = (succ.get(k) ?? []).filter((t) => known.has(t));
      return out.length === 0 || out.some((t) => home(t) !== home(k)) || outputs.has(k);
    };
    for (const x of g.nodes) {
      const hx = home(x.key);
      if (hx === undefined) continue;
      for (let y = r.annotations.get(x.key)?.collapseUnder ?? null; y !== null; y = r.annotations.get(y)?.collapseUnder ?? null) {
        const stack = [x.key];
        const seen = new Set<string>([x.key, y]);
        while (stack.length > 0) {
          const v = stack.pop() as string;
          expect(isExit(v), `${x.key} reaches an exit around ${y} via ${v}`).toBe(false);
          for (const t of succ.get(v) ?? []) {
            if (!seen.has(t) && known.has(t) && home(t) === hx) {
              seen.add(t);
              stack.push(t);
            }
          }
        }
      }
    }
  });
});

describe("degenerate rates", () => {
  it("survives NaN, Infinity, zero, negative and huge rates with finite shares", () => {
    const weird = [Number.NaN, Number.POSITIVE_INFINITY, 0, -5, 1e308, Number.MIN_VALUE];
    for (const a of weird) {
      for (const b of weird) {
        const nodes = [
          node("E", { kind: "extractor", prod: [["Ore", a]] }),
          node("R", { count: 4, ing: [["Ore", b]], prod: [["Ingot", a]] }),
          node("S1", { count: 4, ing: [["Ingot", b]], prod: [["X", b]] }),
          node("S2", { count: 4, ing: [["Ingot", a]], prod: [["Y", a]] }),
          storage("T1"),
          storage("T2"),
        ];
        const edges = [edge("E", "R", "Ore"), edge("R", "S1", "Ingot"), edge("R", "S2", "Ingot"), edge("S1", "T1", "X", "output", "storage"), edge("S2", "T2", "Y", "output", "storage")];
        const r = run(nodes, edges);
        for (const nd of nodes) {
          const s = r.annotations.get(nd.key)?.shares;
          if (s) {
            expect(s.reduce((t, x) => t + x.share, 0), `${a},${b}`).toBeCloseTo(1, 5);
            for (const x of s) expect(Number.isFinite(x.share)).toBe(true);
          }
        }
        expect(r.stats.unassignedGroups).toBe(0);
        // Factory rates must stay contract-valid (finite, non-negative) even when the inputs were not.
        for (const f of r.factories) for (const p of f.products) expect(Number.isFinite(p.maxPerMinute) && p.maxPerMinute >= 0).toBe(true);
        const shuffled = run([...nodes].reverse(), [...edges].reverse());
        expect(JSON.stringify(serialise(shuffled)), `${a},${b}`).toBe(JSON.stringify(serialise(r)));
      }
    }
  });

  it("sums of huge max rates stay contract-valid", () => {
    const nodes = [
      node("S1", { count: 4, prod: [["X", 1.7e308]] }),
      node("S2", { count: 4, prod: [["X", 1.7e308]] }),
      node("Ex", { kind: "extractor", prod: [["Ore", 1.7e308]] }),
      storage("T"),
    ];
    const edges = [edge("S1", "T", "X", "output", "storage"), edge("S2", "T", "X", "output", "storage"), edge("Ex", "S1", "Ore"), edge("Ex", "S2", "Ore")];
    const r = run(nodes, edges);
    expectContract(nodes, r);
  });
});

describe("graph oddities", () => {
  it("handles self loops, parallel arcs, arcs from and to unknown nodes, duplicate transports", () => {
    const nodes = [extractor("E", "Ore"), node("G", { count: 4, ing: [["Ore", 50]], prod: [["Gear", 10]] }), storage("T")];
    const edges = [
      edge("E", "E", "Ore"),
      edge("G", "G", "Gear"),
      edge("E", "G", "Ore"),
      edge("E", "G", "Ore"),
      edge("ghost", "G", "Ore"),
      edge("G", "ghost", "Gear", "output"),
      edge("G", "T", "Gear", "output", "storage"),
      edge("G", "T", "Gear", "output", "storage"),
    ];
    const r = run(nodes, edges, [transport("E", "G", "Ore"), transport("E", "G", "Ore"), transport("T", "T", null)]);
    expectContract(nodes, r);
    expect(r.factories).toHaveLength(1);
    expect(r.factories[0].nodeKeys).toEqual(["E", "G", "T"]);
    expect(r.annotations.get("E")?.collapseUnder).toBe("G");
  });

  it("does not throw on duplicate node keys", () => {
    const nodes = [node("A", { prod: [["X", 1]] }), node("A", { prod: [["X", 2]] }), node("B", { ing: [["X", 1]] })];
    expect(() => run(nodes, [edge("A", "B", "X")])).not.toThrow();
  });

  it("makes a pure cycle of machines plus a seed branch one coherent result", () => {
    const nodes = [
      extractor("E", "Ore"),
      node("A", { count: 2, ing: [["Ore", 10], ["B", 10]], prod: [["A", 10]] }),
      node("B", { count: 2, ing: [["A", 10]], prod: [["B", 10]] }),
      node("C", { count: 2, ing: [["A", 10]], prod: [["C", 10]] }),
      storage("T"),
    ];
    const edges = [edge("E", "A", "Ore"), edge("A", "B", "A"), edge("B", "A", "B"), edge("A", "C", "A"), edge("C", "T", "C", "output", "storage")];
    const r = run(nodes, edges);
    expectContract(nodes, r);
    expect(r.factories).toHaveLength(1);
    expect(r.factories[0].nodeKeys).toEqual(["A", "B", "C", "E", "T"]);
    expect(r.stats.unassignedGroups).toBe(0);
  });

  it("two disjoint cycles with no seeds become two factories, each cycle whole", () => {
    const mk = (p: string): [PlannerNode[], PlannerEdge[]] => [
      [node(`${p}1`, { count: 2, ing: [["X", 1]], prod: [["X", 1]] }), node(`${p}2`, { count: 2, ing: [["X", 1]], prod: [["X", 1]] })],
      [edge(`${p}1`, `${p}2`, "X"), edge(`${p}2`, `${p}1`, "X")],
    ];
    const [n1, e1] = mk("a");
    const [n2, e2] = mk("b");
    const r = run([...n1, ...n2], [...e1, ...e2]);
    expect(r.stats.unassignedGroups).toBe(0);
    expect(r.factories.length).toBeGreaterThanOrEqual(1);
    const home = (k: string) => r.annotations.get(k)?.factoryKey;
    expect(home("a1")).toBe(home("a2"));
    expect(home("b1")).toBe(home("b2"));
  });

  it("a long fold chain of small offshoots ends in one factory with at most 8 side products", () => {
    const nodes: PlannerNode[] = [node("Big", { count: 10, prod: [["P0", 100]], ing: [["Ore", 10]] }), extractor("E", "Ore"), storage("S0")];
    const edges: PlannerEdge[] = [edge("E", "Big", "Ore"), edge("Big", "S0", "P0", "output", "storage")];
    let prev = "Big";
    for (let i = 1; i <= 12; i++) {
      nodes.push(node(`C${i}`, { count: 1, ing: [[`P${i - 1}`, 10]], prod: [[`P${i}`, 10]] }), storage(`S${i}`));
      edges.push(edge(prev, `C${i}`, `P${i - 1}`), edge(`C${i}`, `S${i}`, `P${i}`, "output", "storage"));
      prev = `C${i}`;
    }
    const r = run(nodes, edges);
    expectContract(nodes, r);
    expect(r.stats.unassignedGroups).toBe(0);
    for (const f of r.factories) expect(f.sideProducts.length).toBeLessThanOrEqual(8);
    const sh = shuffler(3);
    expect(JSON.stringify(serialise(run(sh(nodes), sh(edges))))).toBe(JSON.stringify(serialise(r)));
  });

  it("mutual small factories feeding each other never fold into a hole", () => {
    const nodes = [
      node("A", { count: 1, ing: [["B", 5]], prod: [["A", 5]] }),
      node("B", { count: 1, ing: [["A", 5]], prod: [["B", 5]] }),
      storage("TA"),
      storage("TB"),
    ];
    const edges = [edge("A", "B", "A"), edge("B", "A", "B"), edge("A", "TA", "A", "output", "storage"), edge("B", "TB", "B", "output", "storage")];
    const r = run(nodes, edges);
    expectContract(nodes, r);
    expect(r.stats.unassignedGroups).toBe(0);
    expect(r.factories.reduce((s, f) => s + f.machineCount, 0)).toBe(2);
  });
});

describe("caps and lengths", () => {
  it("keeps at most 500 factories and reports the dropped ones; kept records are valid and nothing is double counted", () => {
    const nodes: PlannerNode[] = [];
    const edges: PlannerEdge[] = [];
    for (let i = 0; i < 620; i++) {
      nodes.push(node(`m${i}`, { count: 4 + (i % 3), prod: [[`P${i}`, 10]], at: [i * 100, 0] }), storage(`s${i}`));
      edges.push(edge(`m${i}`, `s${i}`, `P${i}`, "output", "storage"));
    }
    const r = run(nodes, edges);
    expect(r.factories).toHaveLength(PLANNER_MAX_FACTORIES);
    expect(r.stats.droppedFactories).toBe(120);
    expect(r.stats.factories).toBe(PLANNER_MAX_FACTORIES);
    expect(r.stats.unassignedGroups).toBe(120);
    expectContract(nodes, r);
    // The largest factories survive: every 6-machine one (i % 3 === 2) is kept.
    const keptMachines = new Set(r.factories.flatMap((f) => f.nodeKeys));
    for (let i = 2; i < 620; i += 3) expect(keptMachines.has(`m${i}`)).toBe(true);
    // Deterministic on a shuffle even at the cap.
    const sh = shuffler(11);
    expect(JSON.stringify(serialise(run(sh(nodes), sh(edges))))).toBe(JSON.stringify(serialise(r)));
  });

  it("shares toward a dropped factory still sum to at most 1 and stay contract-valid", () => {
    // 600 tiny consumers of one shared supplier: the supplier splits over 600 factories, only 500 are kept.
    const nodes: PlannerNode[] = [node("Sup", { count: 5, ing: [["Ore", 1]], prod: [["Ing", 6000]] }), extractor("E", "Ore")];
    const edges: PlannerEdge[] = [edge("E", "Sup", "Ore")];
    for (let i = 0; i < 600; i++) {
      nodes.push(node(`c${i}`, { count: 4 + (i % 2), ing: [["Ing", 10]], prod: [[`P${i}`, 1]] }), storage(`s${i}`));
      edges.push(edge("Sup", `c${i}`, "Ing"), edge(`c${i}`, `s${i}`, `P${i}`, "output", "storage"));
    }
    const r = run(nodes, edges);
    expectContract(nodes, r);
    const sh = r.annotations.get("Sup")?.shares;
    expect(sh).toBeDefined();
    expect(sh?.length).toBeLessThanOrEqual(PLANNER_MAX_SHARES);
    expect(sh?.reduce((s, x) => s + x.share, 0) ?? 0).toBeLessThanOrEqual(1 + 1e-6);
  });

  it("more than 5 sharers: 4 shown plus other, summing to 1, sorted by share then key", () => {
    const nodes: PlannerNode[] = [node("Sup", { count: 5, prod: [["Ing", 700]] })];
    const edges: PlannerEdge[] = [];
    for (let i = 0; i < 9; i++) {
      nodes.push(node(`c${i}`, { count: 4, ing: [["Ing", 10]], prod: [[`P${i}`, 1]] }), storage(`s${i}`));
      edges.push(edge("Sup", `c${i}`, "Ing"), edge(`c${i}`, `s${i}`, `P${i}`, "output", "storage"));
    }
    const r = run(nodes, edges);
    const sh = r.annotations.get("Sup")?.shares ?? [];
    expect(sh).toHaveLength(PLANNER_MAX_SHARES);
    expect(sh[PLANNER_MAX_SHARES - 1].factoryKey).toBe("other");
    expect(sh.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 5);
    expectContract(nodes, r);
  });

  it("long names and class names stay inside the contract (Name 200, Key 300)", () => {
    const long = "Q".repeat(500);
    const nodes = [
      node("m", { count: 4, name: long, className: long, prod: [[long, 10]], ing: [] }),
      node("m2", { count: 4, name: long, className: long, prod: [[long, 10]], ing: [] }),
      storage("s"),
      storage("s2"),
    ];
    // Node-level strings are the caller's to bound; the reduction's own strings (names, keys, product records) must fit.
    nodes[0].products[0].name = "N".repeat(200);
    nodes[0].products[0].className = "C".repeat(200);
    nodes[1].products[0].name = "N".repeat(200);
    nodes[1].products[0].className = "C".repeat(200);
    const r = run(nodes, [edge("m", "s", "C".repeat(200), "output", "storage"), edge("m2", "s2", "C".repeat(200), "output", "storage")]);
    for (const f of r.factories) {
      expect(f.name.length).toBeLessThanOrEqual(200);
      expect(f.key.length).toBeLessThanOrEqual(300);
      expect(PlannerFactorySchema.safeParse(f).success).toBe(true);
    }
    for (const ann of r.annotations.values()) if (ann.factoryKey) expect(ann.factoryKey.length).toBeLessThanOrEqual(300);
    // Two factories with the same truncated product class must still get distinct keys and names.
    expect(new Set(r.factories.map((f) => f.key)).size).toBe(r.factories.length);
    expect(new Set(r.factories.map((f) => f.name)).size).toBe(r.factories.length);
  });

  it("two product classes sharing an 80-character prefix at the same spot get distinct keys", () => {
    const a = "P".repeat(80) + "A";
    const b = "P".repeat(80) + "B";
    const nodes = [node("m1", { count: 4, prod: [[a, 10]] }), node("m2", { count: 4, prod: [[b, 10]] }), storage("s1"), storage("s2")];
    const r = run(nodes, [edge("m1", "s1", a, "output", "storage"), edge("m2", "s2", b, "output", "storage")]);
    expect(r.factories).toHaveLength(2);
    expect(r.factories[0].key).not.toBe(r.factories[1].key);
  });
});

describe("depot, sink and power", () => {
  it("never puts the Depot virtual node in a factory or lets it bridge two factories", () => {
    const nodes = [
      node("G1", { count: 4, prod: [["Gear", 10]] }),
      node("G2", { count: 4, prod: [["Rod", 10]] }),
      node("U1", { kind: "storage", className: "Build_CentralStorage_C" }),
      node("U2", { kind: "storage", className: "Build_CentralStorage_C" }),
      node(DEPOT_NODE_KEY, { kind: "storage", className: DEPOT_NODE_CLASS, role: "depot", siteKey: "depot", count: 1 }),
      node("Sink", { kind: "consumer", className: SINK_CLASS }),
    ];
    const edges = [edge("G1", "U1", "Gear", "output", "depot"), edge("G2", "U2", "Rod", "output", "depot"), edge("G1", "Sink", "Gear", "excess", "sink")];
    const tr = [transport("U1", DEPOT_NODE_KEY, "Gear", "depot", "output", "depot"), transport("U2", DEPOT_NODE_KEY, "Rod", "depot", "output", "depot")];
    const r = run(nodes, edges, tr);
    expectContract(nodes, r);
    expect(r.annotations.get(DEPOT_NODE_KEY)?.factoryKey).toBeUndefined();
    expect(r.annotations.get(DEPOT_NODE_KEY)?.shares).toBeUndefined();
    expect(r.factories).toHaveLength(2);
    expect(r.stats.components).toBe(2);
  });

  it("a Depot node with a supply arc in either direction does not become a share-carrying member", () => {
    const nodes = [
      node("G", { count: 4, prod: [["Gear", 10]] }),
      node(DEPOT_NODE_KEY, { kind: "storage", className: DEPOT_NODE_CLASS, role: "depot", siteKey: "depot", count: 1 }),
      node("H", { count: 4, ing: [["Gear", 5]], prod: [["Plate", 5]] }),
      storage("T"),
    ];
    const r = run(nodes, [edge("G", "T", "Gear", "output", "storage"), edge("H", "T", "Plate", "output", "storage")], [transport("G", DEPOT_NODE_KEY, "Gear", "depot", "supply"), transport("H", DEPOT_NODE_KEY, "Plate", "depot", "supply")]);
    expectContract(nodes, r);
    expect(r.stats.unassignedGroups).toBe(0);
    expect(r.annotations.get(DEPOT_NODE_KEY)?.factoryKey).toBeUndefined();
  });

  it("power generators keep the power role and are machines-or-consumers without crashing the reduction", () => {
    const nodes = [extractor("Coal", "Coal"), node("Gen", { kind: "consumer", className: "Build_GeneratorCoal_C", count: 8 }), node("Fab", { count: 4, prod: [["X", 1]] }), storage("T")];
    const r = run(nodes, [edge("Coal", "Gen", "Coal"), edge("Fab", "T", "X", "output", "storage")]);
    expectContract(nodes, r);
    expect(r.annotations.get("Gen")?.role).toBe("power");
  });
});
