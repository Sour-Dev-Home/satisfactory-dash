import { describe, it, expect } from "vitest";
import type { ConveyorEdge } from "@satisfactory-dash/shared";
import { buildGraph, passThroughComponents, walkRegion, weaklyConnectedComponents, type Graph } from "./connectionGraph.js";

/** `from`/`to` are node ids; null = open end. Kind by id prefix: "S" splitter, "M" merger, "J" junction, else machine. */
function edge(id: string, from: string | null, to: string | null, kind: ConveyorEdge["kind"] = "belt"): ConveyorEdge {
  const kindOf = (n: string | null): ConveyorEdge["fromKind"] =>
    n === null ? null : n.startsWith("S") ? "splitter" : n.startsWith("M") ? "merger" : n.startsWith("J") ? "junction" : "machine";
  return { id, kind, from, fromKind: kindOf(from), to, toKind: kindOf(to), capacityPerMinute: 780, tier: "Conveyor Belt", at: { x: 0, y: 0 } };
}

/** Building ids of a node list, for readable assertions. */
const names = (g: Graph, nodes: number[]): string[] => {
  const byNode = new Map<number, string>();
  for (const [id, n] of g.idToNode) byNode.set(n, id);
  return nodes.map((n) => byNode.get(n) ?? `#${n}`);
};

const reverse = <T>(list: T[]): T[] => [...list].reverse();

describe("weaklyConnectedComponents", () => {
  it("is empty for an empty graph", () => {
    expect(weaklyConnectedComponents(buildGraph([]))).toEqual([]);
    expect(passThroughComponents(buildGraph([]))).toEqual([]);
  });

  it("splits two disjoint sites, ordered by smallest member", () => {
    const g = buildGraph([edge("e1", "A", "B"), edge("e2", "B", "C"), edge("e3", "X", "Y")]);
    const comps = weaklyConnectedComponents(g).map((c) => names(g, c));
    expect(comps).toEqual([["A", "B", "C"], ["X", "Y"]]);
  });

  it("ignores direction", () => {
    const g = buildGraph([edge("e1", "A", "B"), edge("e2", "C", "B")]);
    expect(weaklyConnectedComponents(g)).toHaveLength(1);
  });

  it("treats a cycle as one component", () => {
    const g = buildGraph([edge("e1", "A", "B"), edge("e2", "B", "C"), edge("e3", "C", "A")]);
    expect(weaklyConnectedComponents(g).map((c) => names(g, c))).toEqual([["A", "B", "C"]]);
  });

  it("joins directly chained conveyors into one node", () => {
    const e1 = edge("e1", "A", "e2");
    e1.toKind = "conveyor";
    const e2 = edge("e2", "e1", "B");
    e2.fromKind = "conveyor";
    const g = buildGraph([e1, e2]);
    // The join is one unnamed pass-through node between the two machines.
    expect(weaklyConnectedComponents(g).map((c) => names(g, c))).toEqual([["A", "#1", "B"]]);
    expect(passThroughComponents(g).map((c) => c.nodes)).toEqual([[1]]);
  });

  it("is the same for shuffled input", () => {
    const edges = [edge("e1", "A", "B"), edge("e2", "X", "Y"), edge("e3", "B", "C"), edge("e4", "Y", "Z")];
    const g = buildGraph(edges);
    const expected = weaklyConnectedComponents(g);
    for (const shuffled of [reverse(edges), [edges[2], edges[0], edges[3], edges[1]]]) {
      const h = buildGraph(shuffled);
      expect(weaklyConnectedComponents(h)).toEqual(expected);
      expect(passThroughComponents(h)).toEqual(passThroughComponents(g));
    }
  });
});

describe("passThroughComponents", () => {
  it("has none when every end is a terminal", () => {
    expect(passThroughComponents(buildGraph([edge("e1", "A", "B")]))).toEqual([]);
  });

  it("collapses a manifold: one producer, a splitter chain, many consumers", () => {
    const g = buildGraph([
      edge("e1", "P", "S1"),
      edge("e2", "S1", "C1"),
      edge("e3", "S1", "S2"),
      edge("e4", "S2", "C2"),
      edge("e5", "S2", "S3"),
      edge("e6", "S3", "C3"),
      edge("e7", "S3", "C4"),
    ]);
    const comps = passThroughComponents(g);
    expect(comps).toHaveLength(1);
    expect(names(g, comps[0].nodes).sort()).toEqual(["S1", "S2", "S3"]);
    expect(names(g, comps[0].ins)).toEqual(["P"]);
    expect(names(g, comps[0].outs).sort()).toEqual(["C1", "C2", "C3", "C4"]);
  });

  it("keeps separate components apart and merges many suppliers", () => {
    const g = buildGraph([
      edge("e1", "P1", "M1"),
      edge("e2", "P2", "M1"),
      edge("e3", "M1", "C1"),
      edge("e4", "P3", "S1"),
      edge("e5", "S1", "C2"),
    ]);
    const comps = passThroughComponents(g);
    expect(comps.map((c) => names(g, c.nodes))).toEqual([["M1"], ["S1"]]);
    expect(names(g, comps[0].ins).sort()).toEqual(["P1", "P2"]);
    expect(names(g, comps[0].outs)).toEqual(["C1"]);
    expect(names(g, comps[1].ins)).toEqual(["P3"]);
    expect(names(g, comps[1].outs)).toEqual(["C2"]);
  });

  it("handles a cycle of pass-throughs", () => {
    const g = buildGraph([edge("e1", "P", "S1"), edge("e2", "S1", "S2"), edge("e3", "S2", "S1"), edge("e4", "S2", "C")]);
    const comps = passThroughComponents(g);
    expect(comps).toHaveLength(1);
    expect(names(g, comps[0].nodes).sort()).toEqual(["S1", "S2"]);
    expect(names(g, comps[0].ins)).toEqual(["P"]);
    expect(names(g, comps[0].outs)).toEqual(["C"]);
  });

  it("lists a pipe terminal on both sides (a pipe is two arcs)", () => {
    const g = buildGraph([edge("e1", "A", "J1", "pipe"), edge("e2", "J1", "B", "pipe")]);
    const [c] = passThroughComponents(g);
    expect(names(g, c.ins)).toEqual(["A", "B"]);
    expect(names(g, c.outs)).toEqual(["A", "B"]);
  });
});

describe("edge cases (fresh-eyes pass)", () => {
  it("keeps a self-loop as a single-node component with no arcs", () => {
    const g = buildGraph([edge("e1", "A", "A"), edge("e2", "S1", "S1")]);
    expect(weaklyConnectedComponents(g).map((c) => names(g, c))).toEqual([["A"], ["S1"]]);
    expect(passThroughComponents(g)).toEqual([{ nodes: [1], ins: [], outs: [] }]);
  });

  it("ignores an edge with both ends open and lists a dead-end pass-through as an isolated component", () => {
    const g = buildGraph([edge("e0", null, null), edge("e1", "S1", null), edge("e2", null, "A")]);
    expect(weaklyConnectedComponents(g).map((c) => names(g, c))).toEqual([["S1"], ["A"]]);
    expect(passThroughComponents(g)).toEqual([{ nodes: [0], ins: [], outs: [] }]);
  });

  it("does not repeat a terminal for duplicate parallel edges", () => {
    const g = buildGraph([edge("e1", "P", "S1"), edge("e2", "P", "S1"), edge("e3", "S1", "C"), edge("e4", "S1", "C")]);
    const [c] = passThroughComponents(g);
    expect(names(g, c.ins)).toEqual(["P"]);
    expect(names(g, c.outs)).toEqual(["C"]);
    expect(weaklyConnectedComponents(g)).toHaveLength(1);
  });

  it("covers a node that has no arcs (hand-built graph) in both functions", () => {
    const g: Graph = { kind: ["machine", "splitter", "machine"], idToNode: new Map(), out: [[], [], []], in: [[], [], []] };
    expect(weaklyConnectedComponents(g)).toEqual([[0], [1], [2]]);
    expect(passThroughComponents(g)).toEqual([{ nodes: [1], ins: [], outs: [] }]);
  });

  it("treats a terminal between two pass-through groups as a boundary, not a link", () => {
    const g = buildGraph([edge("e1", "S1", "T", "pipe"), edge("e2", "T", "S2", "pipe")]);
    expect(weaklyConnectedComponents(g)).toHaveLength(1);
    const comps = passThroughComponents(g);
    expect(comps.map((c) => names(g, c.nodes))).toEqual([["S1"], ["S2"]]);
    for (const c of comps) {
      expect(names(g, c.ins)).toEqual(["T"]);
      expect(names(g, c.outs)).toEqual(["T"]);
    }
  });

  it("is order independent over many permutations of a mixed graph", () => {
    const edges = [
      edge("e1", "P", "S1"),
      edge("e2", "S1", "M"),
      edge("e3", "M", "S2", "pipe"),
      edge("e4", "S2", "S2"),
      edge("e5", null, "J1"),
      edge("e6", "J1", "C"),
      edge("e7", "X", "Y"),
    ];
    const base = buildGraph(edges);
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 40; i++) {
      const shuffled = [...edges].sort(() => rnd() - 0.5);
      const h = buildGraph(shuffled);
      expect(weaklyConnectedComponents(h)).toEqual(weaklyConnectedComponents(base));
      expect(passThroughComponents(h)).toEqual(passThroughComponents(base));
    }
  });

  it("handles a 20,000-node chain without recursion", () => {
    const n = 20000;
    const edges: ConveyorEdge[] = [];
    for (let i = 0; i < n; i++) edges.push(edge(`e${String(i).padStart(6, "0")}`, i === 0 ? "P" : `S${i}`, i === n - 1 ? "C" : `S${i + 1}`));
    const g = buildGraph(edges);
    expect(weaklyConnectedComponents(g)).toHaveLength(1);
    const [c] = passThroughComponents(g);
    expect(c.nodes).toHaveLength(n - 1);
    expect(names(g, c.ins)).toEqual(["P"]);
    expect(names(g, c.outs)).toEqual(["C"]);
    const r = walkRegion(g, g.idToNode.get("C") as number, "any", "back");
    expect(r.nodes).toHaveLength(n + 1);
    expect(names(g, r.terminals)).toEqual(["P"]);
  });
});
