import { describe, it, expect } from "vitest";
import { ProductionGraphSchema, type ConveyorEdge, type FactoryBuilding, type ProductionGraph } from "@satisfactory-dash/shared";
import { buildProductionGraph, buildProductionGraphWithStats } from "./productionGraph.js";

// Independent pass (fresh eyes): caps, rate honesty, keys, sites, loops and adversarial input.

type Unit = "items/min" | "m3/min";
const rate = (className: string, max: number, cur = max, unit: Unit = "items/min") => ({
  name: className.replace(/^Desc_|_C$/g, ""),
  className,
  currentPerMinute: cur,
  maxPerMinute: max,
  percent: max === 0 ? 0 : (cur / max) * 100,
  unit,
});

interface M {
  className?: string;
  recipe?: string | null;
  state?: string;
  ing?: [string, number, number?][];
  out?: [string, number, number?][];
  at?: [number, number];
  loc?: { xM: number; yM: number };
  name?: string;
}
function machine(id: string, o: M = {}): FactoryBuilding {
  const at = o.loc ?? (o.at ? { xM: o.at[0], yM: o.at[1] } : undefined);
  return {
    id,
    name: o.name ?? "Constructor",
    className: o.className ?? "Build_Constructor_C",
    recipe: o.recipe === undefined ? "Recipe" : o.recipe,
    isProducing: true,
    isPaused: false,
    isBackedUp: false,
    production: (o.out ?? []).map(([c, m, cur]) => rate(c, m, cur ?? m)),
    ingredients: (o.ing ?? []).map(([c, m, cur]) => rate(c, m, cur ?? m)),
    state: o.state ?? "producing",
    ...(at ? { location: { ...at, zM: 0, rotationDeg: 0 } } : {}),
  };
}
const PREFIX = new Map<string, ConveyorEdge["fromKind"]>([["S", "splitter"], ["G", "merger"], ["J", "junction"], ["T", "storage"], ["X", "extractor"]]);
const kindOf = (n: string | null): ConveyorEdge["fromKind"] => (n === null ? null : (PREFIX.get(n[0]) ?? "machine"));
function edge(id: string, from: string | null, to: string | null, at: [number, number] = [0, 0]): ConveyorEdge {
  return { id, kind: "belt", from, fromKind: kindOf(from), to, toKind: kindOf(to), capacityPerMinute: 780, tier: "Conveyor Belt", at: { x: at[0], y: at[1] } };
}
const parses = (g: ProductionGraph) => expect(() => ProductionGraphSchema.parse(g)).not.toThrow();
const pad = (i: number) => String(i).padStart(6, "0");
const codes = (g: ProductionGraph) => g.notes.map((n) => n.code);

describe("caps", () => {
  it("keeps the 500 largest sites, notes the truncation and stays consistent", () => {
    const b: FactoryBuilding[] = [];
    const e: ConveyorEdge[] = [];
    for (let i = 0; i < 600; i++) {
      const at: [number, number] = [(i % 30) * 1000, Math.floor(i / 30) * 1000];
      b.push(machine(`m${pad(i)}`, { recipe: "R", out: [["Desc_X_C", 10]], at }));
      e.push(edge(`e${pad(i)}`, `m${pad(i)}`, `T${pad(i)}`, at));
    }
    const g = buildProductionGraph(b, e);
    parses(g);
    expect(g.sites).toHaveLength(500);
    expect(codes(g)).toContain("graphTruncated");
    expect(g.nodes).toHaveLength(1000);
    const keys = new Set(g.nodes.map((n) => n.key));
    expect(g.edges.every((x) => keys.has(x.from) && keys.has(x.to))).toBe(true);
    expect(g.nodes.every((n) => g.sites.some((s) => s.key === n.siteKey))).toBe(true);
  });

  it("caps nodes at 5000 and notes it", () => {
    const b: FactoryBuilding[] = [];
    const e: ConveyorEdge[] = [];
    for (let i = 0; i < 2600; i++) {
      b.push(machine(`m${pad(i)}`, { className: `Build_${i}_C`, out: [["Desc_X_C", 10]], at: [0, 0] }));
      e.push(edge(`e${pad(i)}`, `m${pad(i)}`, `T${pad(i)}`));
    }
    const g = buildProductionGraph(b, e);
    parses(g);
    expect(g.nodes).toHaveLength(5000);
    expect(codes(g)).toContain("graphTruncated");
    const nodeKeys = new Set(g.nodes.map((n) => n.key));
    for (const s of g.sites) for (const k of s.nodeKeys) expect(nodeKeys.has(k)).toBe(true);
    // every kept node is in exactly one site
    for (const n of g.nodes) expect(g.sites.filter((s) => s.nodeKeys.includes(n.key))).toHaveLength(1);
  });

  it("caps edges at 20000 and notes it", () => {
    const b: FactoryBuilding[] = [];
    const e: ConveyorEdge[] = [];
    for (let i = 0; i < 160; i++) {
      b.push(machine(`a${pad(i)}`, { className: `Build_A${i}_C`, recipe: "A", out: [["Desc_X_C", 10]], at: [0, 0] }));
      b.push(machine(`b${pad(i)}`, { className: `Build_B${i}_C`, recipe: "B", ing: [["Desc_X_C", 10]], out: [["Desc_Y_C", 1]], at: [0, 0] }));
      e.push(edge(`ea${pad(i)}`, `a${pad(i)}`, "G1"), edge(`eb${pad(i)}`, "G1", `b${pad(i)}`));
    }
    const g = buildProductionGraph(b, e);
    parses(g);
    expect(g.edges).toHaveLength(20_000);
    expect(codes(g)).toContain("graphTruncated");
  });

  it("stops at the pair work guard on a huge merger without throwing", () => {
    const b: FactoryBuilding[] = [];
    const e: ConveyorEdge[] = [];
    for (let i = 0; i < 2400; i++) {
      b.push(machine(`a${pad(i)}`, { className: `Build_A${i}_C`, recipe: "A", out: [["Desc_X_C", 10]], at: [0, 0] }));
      b.push(machine(`b${pad(i)}`, { className: `Build_B${i}_C`, recipe: "B", ing: [["Desc_X_C", 10]], at: [0, 0] }));
      e.push(edge(`ea${pad(i)}`, `a${pad(i)}`, "G1"), edge(`eb${pad(i)}`, "G1", `b${pad(i)}`));
    }
    const g = buildProductionGraph(b, e);
    parses(g);
    expect(codes(g)).toContain("graphTruncated");
  }, 60_000);

  it("notes unmatched links with their count", () => {
    const b = [machine("a", { out: [["Desc_W_C", 10]] }), machine("c", { className: "C", ing: [["Desc_P_C", 10]] }), machine("d", { className: "D", ing: [["Desc_Q_C", 10]] })];
    const g = buildProductionGraph(b, [edge("e1", "a", "S1"), edge("e2", "S1", "c"), edge("e3", "S1", "d")]);
    expect(g.notes.find((n) => n.code === "unmatchedLinks")?.text).toMatch(/^2 links/);
  });

  it("returns empty graphs with the right mode and a note for unsupported and tooLarge", () => {
    for (const mode of ["unsupported", "tooLarge"] as const) {
      const g = buildProductionGraph([machine("a")], mode);
      parses(g);
      expect(g).toMatchObject({ beltData: mode, nodes: [], edges: [], sites: [], unconnectedMachineIds: [] });
      expect(g.notes).toHaveLength(1);
    }
  });
});

describe("keys and positions", () => {
  const key = (x: number, y: number) => {
    const g = buildProductionGraph([machine("a", { recipe: "R", out: [["Desc_X_C", 1]], at: [x, y] })], [edge("e", "a", "T1", [x, y])]);
    return g.nodes.find((n) => n.kind === "machines")?.key;
  };
  it("snaps negative coordinates to the 50 m grid without -0", () => {
    expect(key(-25, -24)).toBe("Build_Constructor_C|R|0|0");
    expect(key(-26, -76)).toBe("Build_Constructor_C|R|-50|-100");
    expect(key(-1, 1)).toBe("Build_Constructor_C|R|0|0");
    expect(key(-49, 49)).toBe("Build_Constructor_C|R|-50|50");
  });

  it("orders ordinals by the lowest member id whatever the input order", () => {
    const b = [machine("z", { recipe: "R", out: [["Desc_X_C", 1]] }), machine("a", { recipe: "R", out: [["Desc_X_C", 1]] })];
    const e = [edge("e1", "z", "T1"), edge("e2", "a", "T2")];
    for (const [bb, ee] of [[b, e], [[...b].reverse(), [...e].reverse()]] as const) {
      const g = buildProductionGraph(bb, ee);
      const ms = g.nodes.filter((n) => n.kind === "machines");
      expect(ms.find((n) => n.key.endsWith("#2"))?.machineIds).toEqual(["z"]);
      expect(ms.find((n) => !n.key.endsWith("#2"))?.machineIds).toEqual(["a"]);
    }
  });

  it("survives absent, NaN and absurd positions by borrowing the conveyor's or falling to zero", () => {
    const b = [
      machine("a", { recipe: "R", out: [["Desc_X_C", 1]] }),
      machine("b", { className: "B", recipe: "R", out: [["Desc_X_C", 1]], loc: { xM: Number.NaN, yM: 5 } }),
      machine("c", { className: "C", recipe: "R", out: [["Desc_X_C", 1]], loc: { xM: 1e12, yM: -1e12 } }),
    ];
    const g = buildProductionGraph(b, [edge("e1", "a", "T1", [30, 40]), edge("e2", "b", "T2", [30, 40]), edge("e3", "c", "T3", [30, 40])]);
    parses(g);
    expect(JSON.stringify(g)).not.toMatch(/NaN|Infinity|null,"y"/);
    expect(g.nodes.find((n) => n.className === "C")?.at).toEqual({ x: 30, y: 40 });
  });
});

describe("sites", () => {
  const line = (id: string, x: number): [FactoryBuilding, ConveyorEdge] => [
    machine(id, { className: `Build_${id}_C`, recipe: id, out: [["Desc_X_C", 10]], at: [x, 0] }),
    edge(`e${id}`, id, `T${id}`, [x, 0]),
  ];
  it("chains A near B near C into one site even though A and C are far apart", () => {
    const [a, ea] = line("a", 0);
    const [b, eb] = line("b", 140);
    const [c, ec] = line("c", 280);
    const g = buildProductionGraph([a, b, c], [ea, eb, ec]);
    expect(g.sites).toHaveLength(1);
    expect(g.sites[0].machineCount).toBe(6);
  });
  it("splits just beyond 150 m", () => {
    const [a, ea] = line("a", 0);
    const [b, eb] = line("b", 152);
    expect(buildProductionGraph([a, b], [ea, eb]).sites).toHaveLength(2);
  });
  it("gives every node exactly one site and machineCount = sum of node counts", () => {
    const b: FactoryBuilding[] = [];
    const e: ConveyorEdge[] = [];
    for (let i = 0; i < 40; i++) {
      const at: [number, number] = [(i * 97) % 700, (i * 53) % 400];
      b.push(machine(`m${pad(i)}`, { className: `Build_${i % 7}_C`, recipe: `R${i % 3}`, out: [["Desc_X_C", 10]], at }));
      e.push(edge(`e${pad(i)}`, `m${pad(i)}`, `T${pad(i % 5)}`, at));
    }
    const g = buildProductionGraph(b, e);
    parses(g);
    for (const n of g.nodes) expect(g.sites.filter((s) => s.nodeKeys.includes(n.key))).toHaveLength(1);
    for (const s of g.sites) {
      const sum = g.nodes.filter((n) => n.siteKey === s.key).reduce((acc, n) => acc + n.count, 0);
      expect(s.machineCount).toBe(sum);
    }
  });
  it("names a site without positions 'Site near (0, 0)'", () => {
    const g = buildProductionGraph([machine("s", { className: "S", recipe: null })], [edge("a", "s", "T1", [0, 0])]);
    expect(g.sites[0].name).toMatch(/^Site near \(-?\d+, -?\d+\)$/);
  });
});

describe("loops", () => {
  it("does not call a single group feeding itself a loop (an SCC of one)", () => {
    const b = [machine("a", { recipe: "R", ing: [["Desc_X_C", 1]], out: [["Desc_X_C", 1]] }), machine("b", { recipe: "R", ing: [["Desc_X_C", 1]], out: [["Desc_X_C", 1]] })];
    const g = buildProductionGraph(b, [edge("e1", "a", "b"), edge("e2", "a", "a")]);
    parses(g);
    expect(g.nodes.every((n) => !n.loop)).toBe(true);
    expect(g.edges.every((x) => x.from !== x.to)).toBe(true);
  });
  it("flags a two-node cycle and not its tail", () => {
    const b = [
      machine("a", { className: "A", recipe: "A", ing: [["Desc_Y_C", 1]], out: [["Desc_X_C", 1]] }),
      machine("b", { className: "B", recipe: "B", ing: [["Desc_X_C", 1]], out: [["Desc_Y_C", 1], ["Desc_Z_C", 1]] }),
      machine("c", { className: "C", recipe: "C", ing: [["Desc_Z_C", 1]], out: [] }),
    ];
    const g = buildProductionGraph(b, [edge("e1", "a", "b"), edge("e2", "b", "a"), edge("e3", "b", "c")]);
    expect(Object.fromEntries(g.nodes.map((n) => [n.className, n.loop]))).toEqual({ A: true, B: true, C: false });
  });
});

describe("rate honesty", () => {
  const check = (g: ProductionGraph) => {
    const byKey = new Map(g.nodes.map((n) => [n.key, n]));
    for (const x of g.edges) {
      if (x.rate === "unknown") expect(x.ratePerMinute).toBeNull();
      else {
        expect(x.ratePerMinute).not.toBeNull();
        expect(Number.isFinite(x.ratePerMinute)).toBe(true);
        expect(x.ratePerMinute as number).toBeGreaterThanOrEqual(0);
      }
      if (x.rate === "measured") {
        expect(x.mixed).toBe(false);
        expect(x.itemClassName).not.toBeNull();
        // a destination that reports no use of the item cannot make a measured rate
        expect(byKey.get(x.to)?.ingredients.some((i) => i.className === x.itemClassName)).toBe(true);
      }
      if (x.itemClassName === null) expect(x.rate).toBe("unknown");
    }
  };
  it("is estimated, not measured, into storage that reports nothing", () => {
    const g = buildProductionGraph([machine("a", { out: [["Desc_X_C", 10, 4]] })], [edge("e", "a", "T1")]);
    expect(g.edges[0]).toMatchObject({ rate: "estimated", ratePerMinute: 4 });
  });
  it("handles zero consumption and zero output without NaN", () => {
    const b = [
      machine("a", { className: "A", recipe: "A", out: [["Desc_X_C", 0, 0]], at: [0, 0] }),
      machine("b", { className: "B", recipe: "B", out: [["Desc_X_C", 0, 0]], at: [0, 0] }),
      machine("c", { className: "C", recipe: "C", ing: [["Desc_X_C", 0, 0]], at: [0, 0] }),
      machine("d", { className: "D", recipe: "D", ing: [["Desc_X_C", 10, 5]], at: [0, 0] }),
    ];
    const g = buildProductionGraph(b, [edge("e1", "a", "G1"), edge("e2", "b", "G1"), edge("e3", "G1", "c"), edge("e4", "G1", "d")]);
    parses(g);
    check(g);
    const toD = g.edges.filter((x) => x.to.includes("|D|"));
    // The sources report no output, so the one-end estimate (2026-10-27) gives D zero from each, never NaN.
    expect(toD.length).toBeGreaterThan(0);
    expect(toD.every((x) => x.rate === "estimated" && x.ratePerMinute === 0)).toBe(true);
  });
  it("seeded fuzz keeps every invariant, parses and is order independent", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const items = ["Desc_A_C", "Desc_B_C", "Desc_C_C"];
    for (let round = 0; round < 150; round++) {
      const n = 2 + Math.floor(rnd() * 9);
      const b: FactoryBuilding[] = [];
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const id = `m${i}`;
        ids.push(id);
        const pick = () => items[Math.floor(rnd() * 3)];
        const val = () => (rnd() < 0.2 ? 0 : Math.floor(rnd() * 100));
        b.push(
          machine(id, {
            className: `Build_${Math.floor(rnd() * 3)}_C`,
            recipe: rnd() < 0.2 ? null : `R${Math.floor(rnd() * 2)}`,
            ing: rnd() < 0.7 ? [[pick(), 50, val()]] : [],
            out: rnd() < 0.8 ? [[pick(), 50, val()]] : [],
            at: [Math.floor(rnd() * 600) - 300, Math.floor(rnd() * 600) - 300],
          }),
        );
      }
      const mids = ["S1", "G1", "J1", "T1", ...ids];
      const e: ConveyorEdge[] = [];
      const m = 1 + Math.floor(rnd() * 14);
      for (let i = 0; i < m; i++) {
        const from = rnd() < 0.1 ? null : mids[Math.floor(rnd() * mids.length)];
        const to = rnd() < 0.1 ? null : mids[Math.floor(rnd() * mids.length)];
        e.push(edge(`c${pad(i)}`, from, to, [Math.floor(rnd() * 200) - 100, 0]));
      }
      const g = buildProductionGraph(b, e);
      parses(g);
      check(g);
      for (const nd of g.nodes) expect(g.sites.filter((s) => s.nodeKeys.includes(nd.key))).toHaveLength(1);
      for (const s of g.sites) expect(s.machineCount).toBe(g.nodes.filter((nd) => nd.siteKey === s.key).reduce((a, nd) => a + nd.count, 0));
      const shuffled = JSON.stringify(buildProductionGraph([...b].reverse(), [...e].reverse()));
      expect(shuffled).toBe(JSON.stringify(g));
    }
  });
});

describe("adversarial input still parses", () => {
  it("long names, long state, huge rates", () => {
    const long = "x".repeat(5000);
    const b = [
      machine("a", { className: long, recipe: long, name: long, state: long, out: [[long, 1e308]], at: [0, 0] }),
      machine("b", { className: long, recipe: long, name: long, state: long, out: [[long, 1e308]], at: [0, 0] }),
    ];
    const g = buildProductionGraph(b, [edge("e1", "a", "T1"), edge("e2", "b", "T1")]);
    parses(g);
  });
  it("a machine id over 128 chars or empty, with no conveyor, still parses", () => {
    const g = buildProductionGraph([machine("i".repeat(300)), machine("")], []);
    parses(g);
  });
  it("more than 1000 machines in one group truncates machineIds and notes it", () => {
    const b: FactoryBuilding[] = [];
    const e: ConveyorEdge[] = [];
    for (let i = 0; i < 1200; i++) {
      b.push(machine(`m${pad(i)}`, { recipe: "R", out: [["Desc_X_C", 1]], at: [0, 0] }));
      e.push(edge(`e${pad(i)}`, `m${pad(i)}`, "G1"));
    }
    e.push(edge("t", "G1", "T1"));
    const g = buildProductionGraph(b, e);
    parses(g);
    const grp = g.nodes.find((n) => n.kind === "machines");
    expect(grp?.count).toBe(1200);
    expect(grp?.machineIds).toHaveLength(1000);
    expect(codes(g)).toContain("graphTruncated");
  });
  it("stats report counts", () => {
    expect(buildProductionGraphWithStats([], []).stats).toMatchObject({ components: 0, sites: 0, groups: 0, links: 0 });
  });
});
