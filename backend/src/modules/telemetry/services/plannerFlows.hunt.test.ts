import { describe, it, expect } from "vitest";
import { ProductionGraphSchema, type ConveyorEdge, type FactoryBuilding } from "@satisfactory-dash/shared";
import { buildProductionGraph } from "./productionGraph.js";
import { classifyDestinations, classifyFlows, sourceTrees, type FlowArc, type PlannerFlow, type TreeGroup } from "./plannerFlows.js";

// ---- seeded RNG ----
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tg(key: string, o: Partial<TreeGroup> = {}): TreeGroup {
  return { key, siteKey: "S", kind: "machines", className: "Build_Constructor_C", buildClass: "Build_Constructor_C", recipe: "R", ingredients: new Set<string>(), ...o };
}

// ---- brute-force reference for sourceTrees: explicit closures, union of same-recipe groups sharing a machine ----
function reference(groups: TreeGroup[], arcs: FlowArc[], flows: PlannerFlow[]): number[] {
  const n = groups.length;
  const supIn: number[][] = Array.from({ length: n }, () => []);
  arcs.forEach((a, i) => {
    if (flows[i] === "supply" && a.s !== a.d) supIn[a.d].push(a.s);
  });
  const isM = groups.map((g) => g.kind === "machines");
  const isBuf = groups.map((g, i) => !isM[i] && supIn[i].length > 0);
  const closure = (g: number): Set<number> => {
    const seen = new Set<number>([g]);
    const st = [g];
    while (st.length) {
      const v = st.pop() as number;
      for (const u of supIn[v]) {
        if (!isM[u] && !isBuf[u]) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        st.push(u);
      }
    }
    return new Set([...seen].filter((x) => isM[x]));
  };
  const cl = groups.map((_, i) => (isM[i] ? closure(i) : new Set<number>()));
  const parent = groups.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (!isM[i] || !isM[j]) continue;
      if (groups[i].className !== groups[j].className || groups[i].recipe !== groups[j].recipe) continue;
      if ([...cl[i]].some((x) => cl[j].has(x))) parent[find(i)] = find(j);
    }
  return groups.map((_, i) => find(i));
}

function randomCase(seed: number) {
  const r = rng(seed);
  const n = 3 + Math.floor(r() * 12);
  const groups: TreeGroup[] = [];
  for (let i = 0; i < n; i++) {
    const t = r();
    const key = `g${String(i).padStart(2, "0")}`;
    if (t < 0.6) groups.push(tg(key, { recipe: ["A", "B"][Math.floor(r() * 2)], className: r() < 0.9 ? "Build_Constructor_C" : "Build_Smelter_C" }));
    else if (t < 0.75) groups.push(tg(key, { kind: "extractor", recipe: null }));
    else if (t < 0.9) groups.push(tg(key, { kind: "storage", recipe: null, buildClass: "K", className: "K" }));
    else groups.push(tg(key, { kind: "station", recipe: null, buildClass: "T", className: "T" }));
  }
  const m = Math.floor(r() * n * 2.5);
  const arcs: FlowArc[] = [];
  const flows: PlannerFlow[] = [];
  for (let i = 0; i < m; i++) {
    arcs.push({ s: Math.floor(r() * n), d: Math.floor(r() * n), item: r() < 0.5 ? "X" : "Y" });
    flows.push(r() < 0.75 ? "supply" : r() < 0.5 ? "excess" : "output");
  }
  return { groups, arcs, flows, r };
}

/** Machine partition as a canonical string: sorted lists of group keys. */
const partition = (groups: TreeGroup[], labels: (string | number)[], machinesOnly = true): string =>
  JSON.stringify(
    [...new Map(groups.map((g, i) => [labels[i], [] as string[]])).entries()]
      .map(([lab]) => groups.filter((g, i) => labels[i] === lab && (!machinesOnly || g.kind === "machines")).map((g) => g.key).sort())
      .filter((l) => l.length)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  );

describe("sourceTrees vs brute-force closure reference", () => {
  it("matches the reference partition of machine groups on 600 seeded random graphs", () => {
    const bad: string[] = [];
    let joined = 0;
    let split = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const { groups, arcs, flows } = randomCase(seed);
      const got = sourceTrees(groups, arcs, flows);
      const want = reference(groups, arcs, flows);
      if (partition(groups, got) !== partition(groups, want)) bad.push(String(seed));
      const w = want.filter((x, i) => groups[i].kind === "machines");
      if (new Set(w).size < w.length) joined++;
      if (new Set(w).size > 1) split++;
    }
    expect(bad).toEqual([]);
    // Non-vacuous: the random graphs exercise both joins and separations.
    expect(joined).toBeGreaterThan(100);
    expect(split).toBeGreaterThan(100);
  });

  it("tree key is tree| + lowest member key, and is invariant under shuffled group and arc order", () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const { groups, arcs, flows, r } = randomCase(seed + 1000);
      const base = sourceTrees(groups, arcs, flows);
      const byKey = new Map(groups.map((g, i) => [g.key, base[i]]));
      // permute groups, remap arcs
      const perm = groups.map((_, i) => i).sort(() => r() - 0.5);
      const inv = new Map(perm.map((old, nu) => [old, nu]));
      const g2 = perm.map((o) => groups[o]);
      const order = arcs.map((_, i) => i).sort(() => r() - 0.5);
      const a2 = order.map((i) => ({ ...arcs[i], s: inv.get(arcs[i].s) as number, d: inv.get(arcs[i].d) as number }));
      const f2 = order.map((i) => flows[i]);
      const got = sourceTrees(g2, a2, f2);
      g2.forEach((g, i) => {
        if (got[i] !== byKey.get(g.key)) bad.push(`${seed}:${g.key}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

describe("sourceTrees hand cases", () => {
  it("a long chain where a later start is reached through a buffer already marked by an earlier start", () => {
    // P1 <- B <- S ; P2 <- B ; S machine of other recipe. B (storage with supply from S) shared: one bubble.
    const g = [tg("p1"), tg("p2"), tg("s", { recipe: "S" }), tg("b", { kind: "storage", recipe: null, buildClass: "K" })];
    const arcs: FlowArc[] = [
      { s: 2, d: 3, item: "X" },
      { s: 3, d: 0, item: "X" },
      { s: 3, d: 1, item: "X" },
    ];
    const t = sourceTrees(g, arcs, ["supply", "supply", "supply"]);
    expect(t[0]).toBe(t[1]);
  });

  it("a shared buffer with no machine upstream (storage fed by a miner) does not join", () => {
    const g = [tg("p1"), tg("p2"), tg("m", { kind: "extractor", recipe: null }), tg("b", { kind: "storage", recipe: null, buildClass: "K" })];
    const arcs: FlowArc[] = [
      { s: 2, d: 3, item: "X" },
      { s: 3, d: 0, item: "X" },
      { s: 3, d: 1, item: "X" },
    ];
    const t = sourceTrees(g, arcs, ["supply", "supply", "supply"]);
    expect(t[0]).not.toBe(t[1]);
  });

  it("a diamond: start 3 reaches start 1 and start 2 only through start 0's closure", () => {
    // a0 <- x ; a1 <- x ; a2 <- a1 ; a3 <- a2 ; x machine other recipe. All same bubble.
    const g = [tg("a0"), tg("a1"), tg("a2"), tg("a3"), tg("x", { recipe: "X" })];
    const arcs: FlowArc[] = [
      { s: 4, d: 0, item: "i" },
      { s: 4, d: 1, item: "i" },
      { s: 1, d: 2, item: "i" },
      { s: 2, d: 3, item: "i" },
    ];
    const t = sourceTrees(g, arcs, arcs.map(() => "supply" as const));
    expect(new Set(t.slice(0, 4)).size).toBe(1);
  });

  it("same recipe, same upstream closure but different building class stays separate", () => {
    const g = [tg("a"), tg("b", { className: "Build_Other_C" }), tg("x", { recipe: "X" })];
    const arcs: FlowArc[] = [
      { s: 2, d: 0, item: "i" },
      { s: 2, d: 1, item: "i" },
    ];
    const t = sourceTrees(g, arcs, ["supply", "supply"]);
    expect(t[0]).not.toBe(t[1]);
  });

  it("two-group loop of the same recipe is one bubble; a self-arc is harmless", () => {
    const g = [tg("a"), tg("b")];
    const arcs: FlowArc[] = [
      { s: 0, d: 1, item: "i" },
      { s: 1, d: 0, item: "i" },
      { s: 0, d: 0, item: "i" },
    ];
    const t = sourceTrees(g, arcs, ["supply", "supply", "supply"]);
    expect(t[0]).toBe(t[1]);
    expect(t[0]).toBe("tree|a");
  });

  it("empty input", () => {
    expect(sourceTrees([], [], [])).toEqual([]);
    expect(classifyFlows([], [])).toEqual([]);
    expect(classifyDestinations([], [], [])).toEqual([]);
  });

  it("non-machine bubbles are scoped per site", () => {
    const g = [tg("m1", { kind: "extractor", recipe: null, siteKey: "S1" }), tg("m2", { kind: "extractor", recipe: null, siteKey: "S2" })];
    const t = sourceTrees(g, [], []);
    expect(t[0]).not.toBe(t[1]);
  });
});

describe("classifyFlows properties", () => {
  it("is invariant under arc order (flow follows the arc)", () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const { groups, arcs, r } = randomCase(seed + 5000);
      const g2 = groups.map((g) => ({ ...g, ingredients: new Set(r() < 0.5 ? ["X"] : []) }));
      const base = classifyFlows(g2, arcs);
      const order = arcs.map((_, i) => i).sort(() => r() - 0.5);
      const got = classifyFlows(g2, order.map((i) => arcs[i]));
      order.forEach((orig, k) => {
        if (got[k] !== base[orig]) bad.push(`${seed}:${orig}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("an item-less arc into a terminal with no sibling supply for null is an output, not excess", () => {
    const g = [tg("p"), tg("k", { kind: "storage", recipe: null, buildClass: "K" })];
    expect(classifyFlows(g, [{ s: 0, d: 1, item: null }])).toEqual(["output"]);
  });

  it("a storage with an outgoing edge only back to the source is a terminal", () => {
    const g = [tg("p"), tg("k", { kind: "storage", recipe: null, buildClass: "K" })];
    expect(classifyFlows(g, [{ s: 0, d: 1, item: "X" }, { s: 1, d: 0, item: "X" }])[0]).toBe("output");
  });

  it("depot is never a buffer even with an outgoing edge, and classifies as depot", () => {
    const g = [tg("p"), tg("d", { kind: "storage", recipe: null, buildClass: "Build_CentralStorage_C" }), tg("q")];
    const arcs: FlowArc[] = [{ s: 0, d: 1, item: "X" }, { s: 1, d: 2, item: "X" }];
    const f = classifyFlows(g, arcs);
    expect(f[0]).toBe("output");
    expect(classifyDestinations(g, arcs, f)[0]).toBe("depot");
  });

  it("buffer chain: storage -> storage -> machine is factory all the way; a dead-end branch is storage", () => {
    const k = (key: string) => tg(key, { kind: "storage", recipe: null, buildClass: "K" });
    const g = [tg("p", { ingredients: new Set(["X"]) }), k("k1"), k("k2"), tg("q", { ingredients: new Set(["X"]) }), k("k3")];
    const arcs: FlowArc[] = [
      { s: 0, d: 1, item: "X" },
      { s: 1, d: 2, item: "X" },
      { s: 2, d: 3, item: "X" },
      { s: 0, d: 4, item: "X" },
    ];
    const f = classifyFlows(g, arcs);
    expect(f).toEqual(["supply", "supply", "supply", "excess"]);
    expect(classifyDestinations(g, arcs, f)).toEqual(["factory", "factory", "factory", "storage"]);
  });

  it("buffer whose outflow is a dead-end storage chain (no machine) is not 'factory' for supply flows into it", () => {
    // p -> k1 -> k2(terminal). k1 has an out edge so p->k1 is 'supply' per spec, but nothing reaches a machine.
    const k = (key: string) => tg(key, { kind: "storage", recipe: null, buildClass: "K" });
    const g = [tg("p"), k("k1"), k("k2")];
    const arcs: FlowArc[] = [{ s: 0, d: 1, item: "X" }, { s: 1, d: 2, item: "X" }];
    const f = classifyFlows(g, arcs);
    const d = classifyDestinations(g, arcs, f);
    expect(f).toEqual(["supply", "output"]);
    expect(d[0]).toBe("storage");
  });

  it("sink with a generator buildClass regex does not mis-route a non-generator consumer", () => {
    const g = [tg("p"), tg("c", { kind: "consumer", recipe: null, buildClass: "Build_SpaceElevator_C" }), tg("gen", { kind: "consumer", recipe: null, buildClass: "Build_GeneratorCoal_C" })];
    const arcs: FlowArc[] = [{ s: 0, d: 1, item: "X" }, { s: 0, d: 2, item: "X" }];
    expect(classifyDestinations(g, arcs, classifyFlows(g, arcs))).toEqual(["unknown", "power"]);
  });
});

// ---- integration through buildProductionGraph ----
const rate = (className: string, max: number, cur = max) => ({ name: className, className, currentPerMinute: cur, maxPerMinute: max, percent: max === 0 ? 0 : (cur / max) * 100, unit: "items/min" as const });
function mach(id: string, o: { cls?: string; recipe?: string; ing?: [string, number, number?][]; out?: [string, number, number?][] } = {}): FactoryBuilding {
  return {
    id,
    name: id,
    className: o.cls ?? "Build_Constructor_C",
    recipe: o.recipe ?? "R",
    isProducing: true,
    isPaused: false,
    isBackedUp: false,
    production: (o.out ?? []).map(([c, m, cur]) => rate(c, m, cur ?? m)),
    ingredients: (o.ing ?? []).map(([c, m, cur]) => rate(c, m, cur ?? m)),
    state: "producing",
    location: { xM: 0, yM: 0, zM: 0, rotationDeg: 0 },
  };
}
const kindOf = (id: string): ConveyorEdge["fromKind"] =>
  /^(Build_ResourceSink|Build_Generator)/.test(id) ? "consumer" : id.startsWith("K") ? "storage" : id.startsWith("SP") ? "splitter" : id.startsWith("M") ? "extractor" : "machine";
let seq = 0;
const edge = (from: string, to: string): ConveyorEdge => ({ id: `e${String(++seq).padStart(5, "0")}`, kind: "belt", from, fromKind: kindOf(from), to, toKind: kindOf(to), capacityPerMinute: 780, tier: "Conveyor Belt", at: { x: 0, y: 0 } });

const PLATE = "Desc_Plate_C";
const OUT = "Desc_Out_C";

describe("excess rate through buildProductionGraph", () => {
  it("clamps at 0 when supply demand exceeds the measured output (never negative)", () => {
    seq = 0;
    const b = [mach("P", { out: [[PLATE, 20, 10]] }), mach("A", { ing: [[PLATE, 30, 25]], out: [[OUT, 5]] }), mach("A2", { recipe: "R2", ing: [[PLATE, 30, 25]], out: [[OUT, 5]] })];
    const e = [edge("P", "SP1"), edge("SP1", "A"), edge("SP1", "A2"), edge("SP1", "K1")];
    const g = ProductionGraphSchema.parse(buildProductionGraph(b, e));
    const ex = g.edges.filter((x) => x.flow === "excess");
    expect(ex).toHaveLength(1);
    expect(ex[0].ratePerMinute === null || ex[0].ratePerMinute >= 0).toBe(true);
  });

  it("excess rate rounds to 2 decimals and equals out - sum(supply)", () => {
    seq = 0;
    const b = [mach("P", { out: [[PLATE, 20, 20]] }), mach("A", { ing: [[PLATE, 30, 7.333]], out: [[OUT, 5]] })];
    const e = [edge("P", "SP1"), edge("SP1", "A"), edge("SP1", "K1")];
    const g = buildProductionGraph(b, e);
    const ex = g.edges.find((x) => x.flow === "excess");
    expect(ex?.ratePerMinute).toBe(12.67);
    expect(ex?.rate).toBe("estimated");
  });

  it("two supply destinations: excess is output minus both", () => {
    seq = 0;
    const b = [mach("P", { out: [[PLATE, 20, 20]] }), mach("A", { ing: [[PLATE, 30, 5]], out: [[OUT, 5]] }), mach("A2", { recipe: "R2", ing: [[PLATE, 30, 4]], out: [[OUT, 5]] })];
    const e = [edge("P", "SP1"), edge("SP1", "A"), edge("SP1", "A2"), edge("SP1", "K1")];
    const g = buildProductionGraph(b, e);
    const ex = g.edges.find((x) => x.flow === "excess");
    expect(ex).toMatchObject({ ratePerMinute: 11, rate: "estimated" });
  });

  it("stays unknown if the source has no production entry for the item (not NaN, not crash)", () => {
    seq = 0;
    const b = [mach("P", { out: [] }), mach("A", { ing: [[PLATE, 30, 5]], out: [[OUT, 5]] })];
    const e = [edge("P", "SP1"), edge("SP1", "A"), edge("SP1", "K1")];
    const g = ProductionGraphSchema.parse(buildProductionGraph(b, e));
    for (const x of g.edges) expect(Number.isNaN(x.ratePerMinute as number)).toBe(false);
  });
});

describe("determinism and schema through buildProductionGraph", () => {
  it("byte-identical under 30 shuffles of a graph with loops, buffers, excess and sinks", () => {
    seq = 0;
    const b = [
      mach("P1", { recipe: "RP", out: [[PLATE, 20, 18]] }),
      mach("P2", { recipe: "RP", ing: [[PLATE, 10, 3]], out: [[PLATE, 20, 18]] }),
      mach("A", { recipe: "RA", ing: [[PLATE, 30, 10]], out: [[OUT, 5]] }),
      mach("A2", { recipe: "RA", ing: [[PLATE, 30, 10]], out: [[OUT, 5]] }),
    ];
    const e = [
      edge("M1", "P1"),
      edge("P1", "SP1"),
      edge("SP1", "A"),
      edge("SP1", "K1"),
      edge("K1", "A2"),
      edge("P2", "P1"),
      edge("P1", "P2"),
      edge("A", "Build_ResourceSink_C_1"),
      edge("A2", "K2"),
      edge("A2", "Build_GeneratorCoal_C_1"),
    ];
    const r = rng(42);
    const shuffle = <T>(xs: T[]): T[] => {
      const a = [...xs];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const base = JSON.stringify(buildProductionGraph(b, e));
    ProductionGraphSchema.parse(JSON.parse(base));
    for (let k = 0; k < 30; k++) expect(JSON.stringify(buildProductionGraph(shuffle(b), shuffle(e)))).toBe(base);
  });

  it("flow, destination and treeKey do not change when only current rates change", () => {
    const build = (cur: number) => {
      seq = 0;
      const b = [mach("P", { out: [[PLATE, 20, cur]] }), mach("A", { ing: [[PLATE, 30, cur / 2]], out: [[OUT, 5]] })];
      const e = [edge("P", "SP1"), edge("SP1", "A"), edge("SP1", "K1")];
      const g = buildProductionGraph(b, e);
      return JSON.stringify({ n: g.nodes.map((n) => [n.key, n.treeKey]), e: g.edges.map((x) => [x.from, x.to, x.flow, x.destination]) });
    };
    expect(build(0)).toBe(build(20));
    expect(build(1)).toBe(build(20));
  });
});
