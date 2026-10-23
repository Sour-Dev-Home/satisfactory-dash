import type { ConveyorEdge, ConveyorNodeKind } from "@satisfactory-dash/shared";

/**
 * The connection graph (bottleneck-finder amendment, Decision 3; shared with the production planner, ADR-0050 Decision 1):
 * a pure, deterministic function of one read of the conveyors layer. No I/O, no clock, no randomness. Node numbers are
 * valid only within the one graph they came from; conveyor ids are valid only within the one read (G-B1).
 */

export const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Ends whose machines the flow never passes through; an arc into one stops there. `other` (a class the adapter does not
 *  know) is a dead end rather than a guessed pass-through. Splitters, mergers, junctions and a belt joined to a belt are
 *  uncapped pass-throughs (amendment, Decision 3). */
export const TERMINAL_KINDS: ReadonlySet<ConveyorNodeKind> = new Set(["machine", "storage", "station", "extractor", "consumer", "other"]);
/** Unread supplies: their item and rate are unknown until follow-up 5, so they feed any item, uncapped and flagged. */
export const SOURCE_KINDS: ReadonlySet<ConveyorNodeKind> = new Set(["extractor", "storage", "station"]);
/** Unread drains, the downstream mirror of the sources. */
export const SINK_KINDS: ReadonlySet<ConveyorNodeKind> = new Set(["storage", "station", "consumer"]);

export type Filter = "solid" | "fluid" | "any";

export interface Arc {
  from: number;
  to: number;
  cap: number;
  edge: ConveyorEdge;
}

export interface Graph {
  kind: ConveyorNodeKind[];
  idToNode: Map<string, number>;
  out: Arc[][];
  in: Arc[][];
}

export interface Region {
  /** Arcs inside the region, root-ward (up) or leaf-ward (down). */
  arcs: Arc[];
  /** Nodes reached, root first, in discovery order. */
  nodes: number[];
  /** The terminals reached (not expanded), root excluded. */
  terminals: number[];
  terminalSet: Set<number>;
}

/** A pipe carries only fluids and a belt or lift only solids; an item of unknown unit may use either. */
export function usable(arc: Arc, filter: Filter): boolean {
  if (filter === "any") return true;
  return filter === "fluid" ? arc.edge.kind === "pipe" : arc.edge.kind !== "pipe";
}


/**
 * The connection graph (amendment, Decision 3). A belt or lift is one arc end 0 to end 1; a pipe is two arcs, because pipe
 * ends are not oriented; an open end adds no arc. A conveyor named as an end of another (`fromKind`/`toKind` "conveyor")
 * is joined to the matching end of that conveyor (end 1 of A to end 0 of B and vice versa) with a union-find, so a chain of
 * directly joined conveyors is one path. Edges are processed in id order so node numbering and kinds are deterministic.
 */
export function buildGraph(input: readonly ConveyorEdge[]): Graph {
  const edges = [...input].sort((a, b) => byString(a.id, b.id));
  const edgeById = new Map<string, ConveyorEdge>();
  for (const e of edges) if (!edgeById.has(e.id)) edgeById.set(e.id, e);

  const index = new Map<string, number>();
  const parent: number[] = [];
  const slot = (key: string): number => {
    let i = index.get(key);
    if (i === undefined) {
      i = parent.length;
      index.set(key, i);
      parent.push(i);
    }
    return i;
  };
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: string, b: string): void => {
    parent[find(slot(a))] = find(slot(b));
  };
  const endKey = (e: ConveyorEdge, end: 0 | 1): string => `\0${e.id}\0${end}`;
  const endId = (e: ConveyorEdge, end: 0 | 1): string | null => (end === 0 ? e.from : e.to);
  const endNodeKind = (e: ConveyorEdge, end: 0 | 1): ConveyorNodeKind | null => (end === 0 ? e.fromKind : e.toKind);

  for (const e of edges) {
    for (const end of [0, 1] as const) {
      const id = endId(e, end);
      if (id === null) continue;
      if (endNodeKind(e, end) === "conveyor") {
        const ref = edgeById.get(id);
        union(endKey(e, end), ref ? endKey(ref, end === 0 ? 1 : 0) : `\0missing\0${id}`);
      } else {
        union(endKey(e, end), id);
      }
    }
  }

  const nodeOfRoot = new Map<number, number>();
  const kind: ConveyorNodeKind[] = [];
  const idToNode = new Map<string, number>();
  const nodeFor = (e: ConveyorEdge, end: 0 | 1): number => {
    const root = find(slot(endKey(e, end)));
    let n = nodeOfRoot.get(root);
    if (n === undefined) {
      n = kind.length;
      nodeOfRoot.set(root, n);
      kind.push("conveyor");
    }
    const nk = endNodeKind(e, end);
    const id = endId(e, end);
    if (nk !== null && nk !== "conveyor" && id !== null) {
      // The first real kind seen (edges are in id order) names the node; every real id lands on it.
      if (kind[n] === "conveyor") kind[n] = nk;
      if (!idToNode.has(id)) idToNode.set(id, n);
    }
    return n;
  };

  const arcs: Arc[] = [];
  for (const e of edges) {
    if (e.from === null || e.to === null) continue;
    const a = nodeFor(e, 0);
    const b = nodeFor(e, 1);
    if (a === b) continue;
    const cap = e.capacityPerMinute ?? Infinity;
    arcs.push({ from: a, to: b, cap, edge: e });
    if (e.kind === "pipe") arcs.push({ from: b, to: a, cap, edge: e });
  }
  // Register ends of open-ended edges too, so a machine at the other end of a dead-end belt still counts as named.
  for (const e of edges) {
    if (e.from === null && e.to !== null) nodeFor(e, 1);
    if (e.to === null && e.from !== null) nodeFor(e, 0);
  }

  const out: Arc[][] = kind.map(() => []);
  const inn: Arc[][] = kind.map(() => []);
  for (const arc of arcs) {
    out[arc.from].push(arc);
    inn[arc.to].push(arc);
  }
  return { kind, idToNode, out, in: inn };
}

/** The region a flow to (back) or from (fwd) `root` can use: expand through pass-through nodes, stop at terminals. */
export function walkRegion(g: Graph, root: number, filter: Filter, dir: "back" | "fwd"): Region {
  const arcs: Arc[] = [];
  const nodes = [root];
  const terminals: number[] = [];
  const seen = new Set<number>([root]);
  for (let qi = 0; qi < nodes.length; qi++) {
    const u = nodes[qi];
    if (qi > 0 && TERMINAL_KINDS.has(g.kind[u])) continue;
    for (const arc of dir === "back" ? g.in[u] : g.out[u]) {
      if (!usable(arc, filter)) continue;
      arcs.push(arc);
      const w = dir === "back" ? arc.from : arc.to;
      if (!seen.has(w)) {
        seen.add(w);
        nodes.push(w);
        if (TERMINAL_KINDS.has(g.kind[w])) terminals.push(w);
      }
    }
  }
  return { arcs, nodes, terminals, terminalSet: new Set(terminals) };
}

/** Union-find over `n` nodes; `link` joins two, `find` returns a representative. */
function disjointSets(n: number): { find: (i: number) => number; link: (a: number, b: number) => void } {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  return { find, link: (a, b) => void (parent[find(a)] = find(b)) };
}

/** Groups of node numbers, each ascending, the groups ordered by their smallest member (stable across runs). */
function groupsOf(n: number, root: (i: number) => number, include: (i: number) => boolean): number[][] {
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!include(i)) continue;
    const r = root(i);
    const list = byRoot.get(r);
    if (list) list.push(i);
    else byRoot.set(r, [i]);
  }
  return [...byRoot.values()].sort((a, b) => a[0] - b[0]);
}

/**
 * The graph's components ignoring arc direction (ADR-0050 Decision 8: the atoms sites are merged from). Every node is in
 * exactly one component; members ascend and components are ordered by their smallest member. Node numbering follows
 * edge-id order, so the result does not depend on the order the edges were read in.
 */
export function weaklyConnectedComponents(g: Graph): number[][] {
  const sets = disjointSets(g.kind.length);
  for (const list of g.out) for (const arc of list) sets.link(arc.from, arc.to);
  return groupsOf(g.kind.length, sets.find, () => true);
}

/** A maximal set of pure logistics nodes joined to each other, and the terminals at its edges. */
export interface PassThroughComponent {
  /** The non-terminal nodes, ascending. */
  nodes: number[];
  /** Terminals with an arc into the component (they supply it), ascending. */
  ins: number[];
  /** Terminals with an arc out of the component (they draw from it), ascending. */
  outs: number[];
}

/**
 * The components of non-terminal nodes (splitters, mergers, junctions, joined belts), ignoring direction, with the
 * terminals each touches (ADR-0050 Decision 1: machines whose inputs come from one component form a manifold group).
 * A pipe is two arcs, so a terminal on a pipe component is in both `ins` and `outs`. Ordered by smallest member.
 */
export function passThroughComponents(g: Graph): PassThroughComponent[] {
  const sets = disjointSets(g.kind.length);
  const pass = (i: number): boolean => !TERMINAL_KINDS.has(g.kind[i]);
  for (const list of g.out) for (const arc of list) if (pass(arc.from) && pass(arc.to)) sets.link(arc.from, arc.to);
  return groupsOf(g.kind.length, sets.find, pass).map((nodes) => {
    const ins = new Set<number>();
    const outs = new Set<number>();
    for (const n of nodes) {
      for (const arc of g.in[n]) if (!pass(arc.from)) ins.add(arc.from);
      for (const arc of g.out[n]) if (!pass(arc.to)) outs.add(arc.to);
    }
    const asc = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);
    return { nodes, ins: asc(ins), outs: asc(outs) };
  });
}
