import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ProductionGraphSchema,
  type ConveyorEdge,
  type FactoryBuilding,
  type PlannerEdge,
  type PlannerNode,
  type ProductionGraph,
  type ResourceNode,
} from "@satisfactory-dash/shared";
import { buildProductionGraph } from "./productionGraph.js";

// Independent pass (fresh eyes) on ADR-0053 Decision 4 item inference: ambiguity must stay unknown, never a wrong guess.

const mockLayer = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../map/index.js", async (orig) => ({ ...(await orig<object>()), getLatestWorldLayer: mockLayer.fn }));
import { readResourceNodes } from "../routes/productionGraph.js";

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
  ing?: [string, number, number?][];
  out?: [string, number, number?][];
  unit?: Unit;
  at?: [number, number];
}
function machine(id: string, o: M = {}): FactoryBuilding {
  const unit = o.unit ?? "items/min";
  return {
    id,
    name: "Constructor",
    className: o.className ?? "Build_Constructor_C",
    recipe: o.recipe === undefined ? "Recipe" : o.recipe,
    isProducing: true,
    isPaused: false,
    isBackedUp: false,
    production: (o.out ?? []).map(([c, m, cur]) => rate(c, m, cur ?? m, unit)),
    ingredients: (o.ing ?? []).map(([c, m, cur]) => rate(c, m, cur ?? m, unit)),
    state: "producing",
    ...(o.at ? { location: { xM: o.at[0], yM: o.at[1], zM: 0, rotationDeg: 0 } } : {}),
  };
}
const KINDS = new Map<string, ConveyorEdge["fromKind"]>(Object.entries({ S: "splitter", G: "merger", J: "junction", T: "storage", X: "extractor", N: "station", Z: "other" }));
const kindOf = (n: string | null): ConveyorEdge["fromKind"] => (n === null ? null : (KINDS.get(n[0]) ?? "machine"));
function edge(id: string, from: string | null, to: string | null, o: { kind?: "belt" | "pipe"; at?: [number, number] } = {}): ConveyorEdge {
  return {
    id,
    kind: o.kind ?? "belt",
    from,
    fromKind: kindOf(from),
    to,
    toKind: kindOf(to),
    capacityPerMinute: o.kind === "pipe" ? null : 780,
    tier: o.kind === "pipe" ? "Pipeline Mk.1" : "Conveyor Belt",
    at: { x: o.at?.[0] ?? 10, y: o.at?.[1] ?? 20 },
  };
}
const pump = (to: string): ConveyorEdge => ({ ...edge("p", "Build_WaterPump_C_1", to, { kind: "pipe" }), fromKind: "extractor" });
const ORE = "Desc_OreIron_C";
const COPPER = "Desc_OreCopper_C";
const INGOT = "Desc_IronIngot_C";
const PLATE = "Desc_IronPlate_C";
const WIRE = "Desc_Wire_C";
const OIL = "Desc_LiquidOil_C";
const WATER = "Desc_Water_C";
const ALUMINA = "Desc_AluminaSolution_C";
const res = (className: string | undefined, x: number, y: number, o: Partial<ResourceNode> = {}): ResourceNode => ({
  type: className === COPPER ? "Copper Ore" : className === OIL ? "Crude Oil" : "Iron Ore",
  purity: "normal",
  nodeType: "node",
  x,
  y,
  exploited: true,
  ...(className === undefined ? {} : { className }),
  ...o,
});
const one = (g: ProductionGraph): PlannerEdge => {
  expect(g.edges).toHaveLength(1);
  return g.edges[0];
};
const nodeKind = (g: ProductionGraph, key: string): PlannerNode => g.nodes.find((n) => n.key === key) as PlannerNode;
const consumes = (id: string, ing: [string, number, number?][], out: [string, number, number?][] = [[PLATE, 10]]) => machine(id, { ing, out });

describe("extractor-to-node lookup", () => {
  const miner = (nodes: ResourceNode[], at: [number, number] = [0, 0]) => one(buildProductionGraph([], [edge("a", "Xm", "T1", { at })], nodes));

  it("zero distance to two different resources is ambiguous; to two of the same is not", () => {
    expect(miner([res(ORE, 0, 0), res(COPPER, 0, 0)]).itemClassName).toBeNull();
    expect(miner([res(ORE, 0, 0), res(ORE, 0, 0)]).itemClassName).toBe(ORE);
  });
  it("a nearest node without a className is unknown even with a farther named node in range", () => {
    expect(miner([res(undefined, 3, 0), res(ORE, 15, 0)]).itemClassName).toBeNull();
    expect(miner([res("", 3, 0), res(ORE, 15, 0)]).itemClassName).toBeNull();
  });
  it("a nameless node close behind a named one makes it ambiguous", () => {
    expect(miner([res(ORE, 5, 0), res(undefined, 8, 0)]).itemClassName).toBeNull();
  });
  it("radius boundary: 20 m counts, 20.01 m does not", () => {
    expect(miner([res(ORE, 20, 0)]).itemClassName).toBe(ORE);
    expect(miner([res(ORE, 20.01, 0)]).itemClassName).toBeNull();
  });
  it("exactly twice as far stays unknown (stricter than ADR 'at least twice'; safe side)", () => {
    expect(miner([res(ORE, 5, 0), res(COPPER, 10, 0)]).itemClassName).toBeNull();
  });
  it("a second, different node in a ring of equal distance is ambiguous", () => {
    expect(miner([res(ORE, 4, 0), res(COPPER, 0, 4), res(ORE, -4, 0)]).itemClassName).toBeNull();
  });
  it("NaN positions never name an item", () => {
    const nodes = [res(ORE, 3, 0)];
    expect(one(buildProductionGraph([], [edge("a", "Xm", "T1", { at: [Number.NaN, 0] })], nodes)).itemClassName).toBeNull();
  });
  it("a solid node under a pipe-only extractor does not name a fluid; an oil node on a belt neither", () => {
    expect(one(buildProductionGraph([], [edge("a", "Xm", "T1", { kind: "pipe", at: [0, 0] })], [res(ORE, 1, 0)])).itemClassName).toBe(null);
    expect(one(buildProductionGraph([], [edge("a", "Xm", "T1", { at: [0, 0] })], [res(OIL, 1, 0)])).itemClassName).toBeNull();
    expect(one(buildProductionGraph([], [edge("a", "Xm", "T1", { kind: "pipe", at: [0, 0] })], [res(OIL, 1, 0)])).itemClassName).toBe(OIL);
  });
  it("the water pump's class beats any node under it", () => {
    const g = buildProductionGraph([], [pump("T1")], [res(ORE, 10, 20)]);
    expect(one(g).itemClassName).toBe(WATER);
  });
  it("an extractor group with units on different resources is unknown; so is one with a unit off any node", () => {
    const e = [edge("a", "Xm1", "T1", { at: [0, 0] }), edge("b", "Xm2", "T1", { at: [500, 0] })];
    const g = buildProductionGraph([], e, [res(ORE, 1, 0), res(COPPER, 501, 0)]);
    expect(g.edges.every((x) => x.itemClassName === null)).toBe(true);
    const g2 = buildProductionGraph([], e, [res(ORE, 1, 0), res(ORE, 501, 0)]);
    expect(g2.edges.map((x) => x.itemClassName)).toEqual([ORE]);
    const g3 = buildProductionGraph([], e, [res(ORE, 1, 0)]);
    expect(g3.edges.every((x) => x.itemClassName === null)).toBe(true);
  });
  it("same-class nodes with different names at equal distance: output is order independent", () => {
    const nodes = [res(ORE, 4, 0, { type: "A" }), res(ORE, -4, 0, { type: "B" }), res(ORE, 0, 4, { type: "C" })];
    const a = JSON.stringify(buildProductionGraph([], [edge("a", "Xm", "T1", { at: [0, 0] })], nodes));
    for (const perm of [[2, 1, 0], [1, 0, 2], [0, 2, 1]]) {
      expect(JSON.stringify(buildProductionGraph([], [edge("a", "Xm", "T1", { at: [0, 0] })], perm.map((i) => nodes[i])))).toBe(a);
    }
  });
});

describe("storage, station, other", () => {
  it("storage fed by a known and an unknown extractor is not named by upstream; a destination with two needs stays null", () => {
    const e = [edge("a", "Xm1", "T1", { at: [0, 0] }), edge("b", "Xm2", "T1", { at: [900, 900] }), edge("c", "T1", "c1")];
    const g = buildProductionGraph([consumes("c1", [[ORE, 10], [COPPER, 10]])], e, [res(ORE, 1, 0)]);
    const out = g.edges.find((x) => nodeKind(g, x.from).kind === "storage" && nodeKind(g, x.to).kind === "machines") as PlannerEdge;
    expect(out.itemClassName).toBeNull();
    expect(g.edges.filter((x) => x.itemFrom === "upstream")).toHaveLength(0);
  });
  it("storage with a partly known input does not go downstream when the known item is also a destination ingredient", () => {
    const e = [edge("a", "Xm1", "T1", { at: [0, 0] }), edge("b", "Xm2", "T1", { at: [900, 900] }), edge("c", "T1", "c1")];
    const g = buildProductionGraph([consumes("c1", [[ORE, 10], [COPPER, 10]])], e, [res(COPPER, 1, 0)]);
    const out = g.edges.find((x) => nodeKind(g, x.to).kind === "machines") as PlannerEdge;
    expect(out.itemClassName).toBeNull();
  });
  it("a station never passes an upstream item on: only the downstream single-need rule", () => {
    const b = [machine("m", { out: [[PLATE, 10]] }), consumes("c1", [[PLATE, 10], [INGOT, 10]])];
    const g = buildProductionGraph(b, [edge("a", "m", "N1"), edge("c", "N1", "c1")]);
    const out = g.edges.find((x) => nodeKind(g, x.from).kind === "station") as PlannerEdge;
    expect(out.itemClassName).toBeNull();
    const g2 = buildProductionGraph([b[0], consumes("c2", [[PLATE, 10]])], [edge("a", "m", "N1"), edge("c", "N1", "c2")]);
    const out2 = g2.edges.find((x) => nodeKind(g2, x.from).kind === "station") as PlannerEdge;
    expect(out2.itemFrom).toBe("downstream");
    expect(g2.edges.some((x) => x.itemFrom === "upstream")).toBe(false);
  });
  it("a station between a storage and a machine: nothing passes through a station", () => {
    const e = [edge("a", "Xm", "N1", { at: [0, 0] }), edge("c", "N1", "T1"), edge("d", "T1", "c1")];
    const g = buildProductionGraph([consumes("c1", [[ORE, 10], [COPPER, 10]])], e, [res(ORE, 1, 0)]);
    const stationOut = g.edges.find((x) => nodeKind(g, x.from).kind === "station" && nodeKind(g, x.to).kind === "storage") as PlannerEdge;
    expect(stationOut.itemClassName).toBeNull();
  });
  it("a modded/other source stays null even when the destination has one unmet need, and passes nothing downstream", () => {
    const g = buildProductionGraph([consumes("c1", [[ORE, 10]])], [edge("a", "Z1", "c1")]);
    expect(one(g)).toMatchObject({ itemClassName: null, rate: "unknown" });
    const g2 = buildProductionGraph([consumes("c1", [[ORE, 10]])], [edge("a", "Z1", "T1"), edge("b", "T1", "c1")]);
    expect(g2.edges.every((x) => x.itemFrom !== "upstream")).toBe(true);
  });
  it("a storage loop fed by one known miner never names a wrong item; chains and loops terminate", () => {
    const e = [edge("a", "Xm", "T1", { at: [0, 0] }), edge("b", "T1", "T2"), edge("c", "T2", "T1"), edge("d", "T2", "c1")];
    const g = buildProductionGraph([consumes("c1", [[ORE, 10]])], e, [res(ORE, 1, 0)]);
    for (const x of g.edges) expect([null, ORE]).toContain(x.itemClassName);
    for (const x of g.edges) if (x.itemFrom) expect(x.rate).not.toBe("measured");
    expect(() => ProductionGraphSchema.parse(g)).not.toThrow();
  });
  it("a storage chain in descending id order still resolves in order (or stays null), never mislabels", () => {
    const e = [edge("a", "Xm", "T9", { at: [0, 0] }), edge("b", "T9", "T5"), edge("c", "T5", "T1"), edge("d", "T1", "c1")];
    const g = buildProductionGraph([consumes("c1", [[ORE, 10], [COPPER, 10]])], e, [res(ORE, 1, 0)]);
    expect(g.edges.filter((x) => x.to !== undefined && nodeKind(g, x.to).kind === "storage").map((x) => x.itemClassName)).toEqual([ORE, ORE, ORE]);
    expect(g.edges.find((x) => nodeKind(g, x.to).kind === "machines")).toMatchObject({ itemClassName: ORE, itemFrom: "upstream" });
  });
  it("storage out belt through a merger with another producer keeps each item on its own edge", () => {
    const b = [machine("p", { out: [[INGOT, 10]] }), consumes("c1", [[ORE, 10], [INGOT, 10]])];
    const e = [edge("a", "Xm", "T1", { at: [0, 0] }), edge("b", "T1", "G1"), edge("c", "p", "G1"), edge("d", "G1", "c1")];
    const g = buildProductionGraph(b, e, [res(ORE, 1, 0)]);
    const tEdge = g.edges.filter((x) => nodeKind(g, x.from).kind === "storage");
    expect(tEdge.map((x) => x.itemClassName)).toEqual([ORE]);
    const pEdge = g.edges.filter((x) => nodeKind(g, x.from).kind === "machines");
    expect(pEdge.map((x) => x.itemClassName)).toEqual([INGOT]);
  });
});

describe("pipes are undirected", () => {
  it("a producer on the far side of a storage-to-machine pipe does not leak its products into the tank's upstream items", () => {
    // pump -> tank T1 -- pipe -- refinery R (takes water, makes alumina on ITS OTHER pipe) ; T1 -- pipe -- M3 (takes alumina).
    const b = [
      machine("R", { className: "Build_OilRefinery_C", ing: [[WATER, 10]], out: [[ALUMINA, 10]], unit: "m3/min" }),
      machine("M3", { ing: [[ALUMINA, 10]], out: [[PLATE, 5]], unit: "m3/min" }),
    ];
    const e = [
      pump("T1"),
      edge("q", "T1", "R", { kind: "pipe" }),
      edge("r", "T1", "M3", { kind: "pipe" }),
    ];
    const g = buildProductionGraph(b, e);
    const toM3 = g.edges.filter((x) => nodeKind(g, x.to).recipe !== null && x.itemClassName === ALUMINA && nodeKind(g, x.from).kind === "storage");
    expect(toM3).toEqual([]);
  });
  it("a tank pair behind a pump never names anything but water", () => {
    const e = [pump("T1"), edge("q", "T1", "T2", { kind: "pipe" }), edge("r", "T2", "c1", { kind: "pipe" })];
    const g = buildProductionGraph([machine("c1", { ing: [[WATER, 5], [OIL, 5]], out: [[PLATE, 1]], unit: "m3/min" })], e);
    for (const x of g.edges.filter((y) => y.itemFrom !== "recipe")) expect([null, WATER]).toContain(x.itemClassName);
  });
});

describe("multi-product sources, rates, excess", () => {
  it("a two-product machine into storage: one edge per item, mixed, each estimated at its product's output", () => {
    const g = buildProductionGraph([machine("m", { out: [[INGOT, 30, 20], [PLATE, 10, 5]] })], [edge("a", "m", "T1")]);
    expect(g.edges.map((x) => [x.itemClassName, x.ratePerMinute]).sort()).toEqual([[INGOT, 20], [PLATE, 5]]);
    for (const x of g.edges) expect(x).toMatchObject({ mixed: true, rate: "estimated", itemFrom: "recipe" });
  });
  it("storage with two items into a one-item consumer: estimated at best, mixed; into storage: null", () => {
    const b = [machine("m", { out: [[INGOT, 30, 20], [PLATE, 10, 5]] }), consumes("c1", [[PLATE, 8, 4]])];
    const g = buildProductionGraph(b, [edge("a", "m", "T1"), edge("b", "T1", "c1"), edge("c", "T1", "T2")]);
    const toC = g.edges.find((x) => nodeKind(g, x.to).kind === "machines" && nodeKind(g, x.from).kind === "storage") as PlannerEdge;
    expect(toC).toMatchObject({ itemClassName: PLATE, mixed: true });
    expect(toC.rate).not.toBe("measured");
    const toT2 = g.edges.find((x) => nodeKind(g, x.to).kind === "storage" && nodeKind(g, x.from).kind === "storage") as PlannerEdge;
    expect(toT2.itemClassName).toBeNull();
  });
  it("two sources into one storage with different items: its out edge to a one-item consumer is mixed and estimated", () => {
    const b = [machine("m1", { out: [[INGOT, 30]] }), machine("m2", { out: [[PLATE, 30]] }), consumes("c1", [[PLATE, 8, 4]])];
    const g = buildProductionGraph(b, [edge("a", "m1", "T1"), edge("a2", "m2", "T1"), edge("b", "T1", "c1")]);
    const toC = g.edges.find((x) => nodeKind(g, x.to).kind === "machines" && nodeKind(g, x.from).kind === "storage") as PlannerEdge;
    expect(toC).toMatchObject({ itemClassName: PLATE, itemFrom: "upstream", mixed: true });
    expect(toC.rate).not.toBe("measured");
  });
  it("a downstream/upstream/resourceNode edge is never 'measured'", () => {
    const b = [consumes("c1", [[ORE, 10, 7]])];
    for (const nodes of [[], [res(ORE, 1, 0)]]) {
      const g = buildProductionGraph(b, [edge("a", "Xm", "c1", { at: [0, 0] })], nodes);
      expect(one(g).rate).toBe("estimated");
    }
    const g = buildProductionGraph(b, [edge("a", "Xm", "T1", { at: [0, 0] }), edge("b", "T1", "c1")], [res(ORE, 1, 0)]);
    for (const x of g.edges) expect(x.rate).not.toBe("measured");
  });
  const excessScene = (cons: number, outCur: number) => {
    const b = [machine("p", { out: [[INGOT, 60, outCur]] }), consumes("c1", [[INGOT, 60, cons]])];
    return buildProductionGraph(b, [edge("a", "p", "S1"), edge("b", "S1", "c1"), edge("c", "S1", "T1")]);
  };
  it("excess rate = output minus supply, estimated, clamped at zero", () => {
    const g = excessScene(30, 60);
    const ex = g.edges.find((x) => x.flow === "excess") as PlannerEdge;
    expect(ex).toMatchObject({ ratePerMinute: 30, rate: "estimated" });
    const low = excessScene(50, 20).edges.find((x) => x.flow === "excess") as PlannerEdge;
    expect(low.ratePerMinute).toBe(0);
    expect(low.rate).toBe("estimated");
  });
  it("two excess destinations of the same item: the leftover shared evenly, estimated", () => {
    const b = [machine("p", { out: [[INGOT, 60, 60]] }), consumes("c1", [[INGOT, 60, 30]])];
    const g = buildProductionGraph(b, [edge("a", "p", "S1"), edge("b", "S1", "c1"), edge("c", "S1", "T1"), edge("d", "S1", "N1")]);
    const ex = g.edges.filter((x) => x.flow === "excess");
    expect(ex.length).toBeGreaterThan(0);
    const share = 30 / ex.length;
    for (const x of ex) expect(x).toMatchObject({ ratePerMinute: share, rate: "estimated" });
  });
  it("a multi-product source's split edges: each item's output less what its other edges carry, estimated", () => {
    const b = [machine("p", { out: [[INGOT, 60, 60], [PLATE, 5, 5]] }), consumes("c1", [[INGOT, 60, 30]])];
    const g = buildProductionGraph(b, [edge("a", "p", "S1"), edge("b", "S1", "c1"), edge("c", "S1", "T1")]);
    const intoStorage = g.edges.filter((y) => nodeKind(g, y.to).kind === "storage");
    expect(intoStorage.map((x) => [x.itemClassName, x.ratePerMinute, x.rate]).sort()).toEqual([
      [INGOT, 30, "estimated"],
      [PLATE, 5, "estimated"],
    ]);
  });
});

describe("route: readResourceNodes", () => {
  const db = {} as never;
  const good = [{ type: "Iron Ore", purity: "normal", nodeType: "node", x: 1, y: 2, exploited: true, className: ORE }];
  const row = (o: object) => ({ hash: "h", observedAt: "2026-10-25T00:00:00.000Z", truncated: false, count: 1, data: good, ...o });
  beforeEach(() => mockLayer.fn.mockReset());
  it("no row, truncated, skipped, or schema-invalid rows are empty", async () => {
    const warn = vi.fn();
    mockLayer.fn.mockResolvedValueOnce(undefined);
    expect(await readResourceNodes(db, "s")).toEqual([]);
    mockLayer.fn.mockResolvedValueOnce(row({ truncated: true }));
    expect(await readResourceNodes(db, "s")).toEqual([]);
    mockLayer.fn.mockResolvedValueOnce(row({ hash: "skipped:whatever", data: good }));
    expect(await readResourceNodes(db, "s")).toEqual([]);
    mockLayer.fn.mockResolvedValueOnce(row({ data: [{ ...good[0], x: 1.5 }] }));
    expect(await readResourceNodes(db, "s", { warn })).toEqual([]);
    mockLayer.fn.mockResolvedValueOnce(row({ data: { not: "an array" } }));
    expect(await readResourceNodes(db, "s", { warn })).toEqual([]);
    mockLayer.fn.mockResolvedValueOnce(row({ data: [good[0], { junk: 1 }] }));
    expect(await readResourceNodes(db, "s", { warn })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
  });
  it("a valid, complete row is used", async () => {
    mockLayer.fn.mockResolvedValueOnce(row({}));
    expect(await readResourceNodes(db, "s")).toEqual(good);
  });
  it("a propagating query error is not swallowed into a silent empty list", async () => {
    mockLayer.fn.mockRejectedValueOnce(new Error("db down"));
    await expect(readResourceNodes(db, "s")).rejects.toThrow("db down");
  });
});

// ---- seeded random graphs: invariants and determinism ----
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomScene(seed: number) {
  const r = prng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const items = [ORE, COPPER, INGOT, PLATE, WIRE];
  const ids: string[] = [];
  const buildings: FactoryBuilding[] = [];
  const nMach = 2 + Math.floor(r() * 4);
  for (let i = 0; i < nMach; i++) {
    const id = `M${i}`;
    ids.push(id);
    const outs = [...new Set([pick(items), pick(items)].slice(0, 1 + Math.floor(r() * 2)))];
    const ins = [...new Set([pick(items), pick(items)].slice(0, 1 + Math.floor(r() * 2)))];
    buildings.push(machine(id, { ing: ins.map((c) => [c, 10 + Math.floor(r() * 50), Math.floor(r() * 10)]), out: outs.map((c) => [c, 10 + Math.floor(r() * 50), Math.floor(r() * 60)]), at: [Math.floor(r() * 300), Math.floor(r() * 300)] }));
  }
  for (const p of ["X1", "X2", "T1", "T2", "T3", "N1", "Z1", "S1", "G1"]) if (r() < 0.8) ids.push(p);
  const edges: ConveyorEdge[] = [];
  const nEdges = 3 + Math.floor(r() * 10);
  for (let i = 0; i < nEdges; i++) {
    const a = pick(ids);
    const b = pick(ids);
    if (a === b) continue;
    edges.push(edge(`e${String(i).padStart(2, "0")}`, a, b, { kind: r() < 0.15 ? "pipe" : "belt", at: [Math.floor(r() * 60), Math.floor(r() * 60)] }));
  }
  const nodes: ResourceNode[] = [];
  const nn = Math.floor(r() * 5);
  for (let i = 0; i < nn; i++) nodes.push(res(r() < 0.1 ? undefined : pick([ORE, COPPER]), Math.floor(r() * 80), Math.floor(r() * 80)));
  return { buildings, edges, nodes };
}
const shuffle = <T,>(xs: T[], r: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

describe("random graphs", () => {
  it("invariants hold and output is byte-identical under shuffled inputs", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const { buildings, edges, nodes } = randomScene(seed);
      const g = buildProductionGraph(buildings, edges, nodes);
      const json = JSON.stringify(g);
      const r = prng(seed * 7919);
      if (JSON.stringify(buildProductionGraph(shuffle(buildings, r), shuffle(edges, r), shuffle(nodes, r))) !== json) failures.push(`seed ${seed}: not deterministic`);
      if (!ProductionGraphSchema.safeParse(g).success) failures.push(`seed ${seed}: schema`);
      for (const e of g.edges) {
        const src = nodeKind(g, e.from);
        const dst = nodeKind(g, e.to);
        if (e.itemFrom && e.itemFrom !== "recipe" && e.rate === "measured") failures.push(`seed ${seed}: inferred edge measured`);
        if (e.itemFrom && e.itemFrom !== "recipe" && src.kind === "other") failures.push(`seed ${seed}: item inferred from an other source`);
        if (e.itemFrom === "upstream" && src.kind === "station") failures.push(`seed ${seed}: station passed upstream item`);
        if (e.itemFrom === "upstream" && src.kind !== "storage" && src.kind !== "extractor") failures.push(`seed ${seed}: upstream from ${src.kind}`);
        if (e.itemFrom === "resourceNode" && (src.kind !== "extractor" || src.resource?.className !== e.itemClassName) && src.className !== "Build_WaterPump_C")
          failures.push(`seed ${seed}: resourceNode item differs from node.resource`);
        if (e.itemClassName !== null && dst.ingredients.length > 0 && e.itemFrom !== "recipe" && !dst.ingredients.some((i) => i.className === e.itemClassName))
          failures.push(`seed ${seed}: inferred item ${e.itemClassName} not an ingredient of destination`);
        if (e.mixed && e.itemFrom === "recipe" && dst.ingredients.length === 0 && e.rate === "measured") failures.push(`seed ${seed}: mixed measured`);
      }
      for (const n of g.nodes) if (n.kind === "extractor" && n.resource && !nodes.some((x) => x.className === n.resource?.className) && n.className !== "Build_WaterPump_C" && !n.resource.className.includes("Water"))
        failures.push(`seed ${seed}: resource without a node`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
