import {
  BOTTLENECK_CHAIN_MAX_STEPS,
  BOTTLENECKS_DEFAULT_LIMIT,
  BOTTLENECKS_MAX_LIMIT,
  type Bottleneck,
  type BottleneckNote,
  type BottleneckStep,
  type Bottlenecks,
  type ConveyorEdge,
  type ConveyorNodeKind,
  type FactoryBuilding,
  type ProductionRate,
} from "@satisfactory-dash/shared";

/**
 * The bottleneck finder (ADR-0048 and its 2026-10-21 amendment, Decisions 3 and 4): a pure, deterministic function of
 * one factory snapshot's buildings and one read of the conveyors layer. No I/O, no clock, no randomness (ground rule 3):
 * ties break by item `className`, then building id; conveyor ids are valid only within the one read they came from
 * (G-B1), so nothing here keeps one.
 *
 * Two graphs joined by building id. The item graph is the verdict walk of the original ADR (noProducer, deficit,
 * upstream, logistics, and their downstream mirror). The connection graph adds, per (machine, item), a Dinic max-flow over
 * the machine's upstream region (the amendment overrides the original "not max-flow"): `notConnected`, a local `deficit`
 * and `logistics` with `cappedBy`. Capacities are rated maxima, never live flow (G-B1, G-B2).
 */

/** How often the connection graph is re-read (ADR-0038's world tier; owner answer 4). */
export const CONNECTIONS_REFRESH_MINUTES = 10;

/** The conveyors layer as the finder gets it: the edges of one fresh read, or why there are none (owner answer 3:
 *  `unsupported` = FRM older than 1.5.4; ADR-0038: `tooLarge` = past the 2 MB world-layer cap). */
export type BottleneckEdges = readonly ConveyorEdge[] | "unsupported" | "tooLarge";

export interface BottleneckOptions {
  /** Top N; default 10 (owner answer 2), clamped to 1..50. */
  limit?: number;
}

const EPS = 1e-9;

/** Ends whose machines the flow never passes through; an arc into one stops there. `other` (a class the adapter does not
 *  know) is a dead end rather than a guessed pass-through. Splitters, mergers, junctions and a belt joined to a belt are
 *  uncapped pass-throughs (amendment, Decision 3). */
const TERMINAL_KINDS: ReadonlySet<ConveyorNodeKind> = new Set(["machine", "storage", "station", "extractor", "consumer", "other"]);
/** Unread supplies: their item and rate are unknown until follow-up 5, so they feed any item, uncapped and flagged. */
const SOURCE_KINDS: ReadonlySet<ConveyorNodeKind> = new Set(["extractor", "storage", "station"]);
/** Unread drains, the downstream mirror of the sources. */
const SINK_KINDS: ReadonlySet<ConveyorNodeKind> = new Set(["storage", "station", "consumer"]);

/** Bad producer or consumer states, most definitive first. Terminal states end a chain; `underfed` and `backedUp` recurse. */
const BAD_STATE_PRIORITY: ReadonlyMap<string, number> = new Map([["unpowered", 0], ["paused", 1], ["idle", 2], ["underfed", 3], ["backedUp", 4]]);
const TERMINAL_STATES: ReadonlySet<string> = new Set(["unpowered", "paused", "idle"]);

type Filter = "solid" | "fluid" | "any";
type VerdictKind = "noProducer" | "notConnected" | "deficit" | "upstream" | "logistics" | "noConsumer" | "surplus" | "downstream";

/** Per-machine rank, lowest wins: noProducer > notConnected > deficit > upstream > logistics with a cap > logistics
 *  (ADR-0048 and Decision 3, items 1 to 6); the downstream mirror reuses the same ladder. */
const VERDICT_RANK: ReadonlyMap<VerdictKind, number> = new Map<VerdictKind, number>([
  ["noProducer", 0],
  ["noConsumer", 0],
  ["notConnected", 1],
  ["deficit", 2],
  ["surplus", 2],
  ["upstream", 3],
  ["downstream", 3],
  ["logistics", 5],
]);
const CAPPED_LOGISTICS_RANK = 4;

interface Verdict {
  kind: VerdictKind;
  rank: number;
  rate: ProductionRate;
  supply?: number;
  demand?: number;
  /** The producer (upstream) or consumer (downstream) the walk continues into. */
  other?: FactoryBuilding;
  cap?: ConveyorEdge;
  /** The belt-level form ran for this verdict; false = item-level (also the stale-graph fallback). */
  beltLevel: boolean;
}

interface Arc {
  from: number;
  to: number;
  cap: number;
  edge: ConveyorEdge;
}

interface Graph {
  kind: ConveyorNodeKind[];
  idToNode: Map<string, number>;
  out: Arc[][];
  in: Arc[][];
}

interface Region {
  /** Arcs inside the region, root-ward (up) or leaf-ward (down). */
  arcs: Arc[];
  /** Nodes reached, root first, in discovery order. */
  nodes: number[];
  /** The terminals reached (not expanded), root excluded. */
  terminals: number[];
  terminalSet: Set<number>;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const num = (n: number): string => String(Math.round(n * 100) / 100);

/** Dinic max-flow over an arc list. Residual-reachable-from-source after the flow is the min cut closest to the source,
 *  unique whatever flow was found, which keeps the result deterministic. */
class Network {
  private head: number[];
  private to: number[] = [];
  private cap: number[] = [];
  private next: number[] = [];
  private level: number[] = [];
  private cursor: number[] = [];

  constructor(nodeCount: number) {
    this.head = Array.from({ length: nodeCount }, () => -1);
  }

  /** Returns the forward arc's index; its reverse is `index ^ 1`. */
  addArc(u: number, v: number, capacity: number): number {
    const e = this.to.length;
    this.to.push(v, u);
    this.cap.push(capacity, 0);
    this.next.push(this.head[u], this.head[v]);
    this.head[u] = e;
    this.head[v] = e + 1;
    return e;
  }

  tail(e: number): number {
    return this.to[e ^ 1];
  }
  headOf(e: number): number {
    return this.to[e];
  }

  maxFlow(s: number, t: number): number {
    let total = 0;
    while (this.buildLevels(s, t)) {
      this.cursor = [...this.head];
      total += this.blockingFlow(s, t);
    }
    return total;
  }

  private buildLevels(s: number, t: number): boolean {
    this.level = Array.from({ length: this.head.length }, () => -1);
    this.level[s] = 0;
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (let e = this.head[u]; e !== -1; e = this.next[e]) {
        const v = this.to[e];
        if (this.cap[e] > EPS && this.level[v] < 0) {
          this.level[v] = this.level[u] + 1;
          queue.push(v);
        }
      }
    }
    return this.level[t] >= 0;
  }

  /** A blocking flow on the level graph, found with an explicit path stack: a belt line of tens of thousands of joined
   *  segments is a path that deep, and recursion there overflows the call stack. */
  private blockingFlow(s: number, t: number): number {
    let total = 0;
    const path: number[] = [];
    let u = s;
    for (;;) {
      if (u === t) {
        let d = Infinity;
        for (const e of path) d = Math.min(d, this.cap[e]);
        if (!(d > EPS) || d === Infinity) return total;
        let retreat = -1;
        path.forEach((e, i) => {
          this.cap[e] -= d;
          this.cap[e ^ 1] += d;
          if (retreat < 0 && this.cap[e] <= EPS) retreat = i;
        });
        total += d;
        path.length = retreat < 0 ? 0 : retreat;
        u = path.length === 0 ? s : this.to[path[path.length - 1]];
        continue;
      }
      let e = this.cursor[u];
      while (e !== -1 && !(this.cap[e] > EPS && this.level[this.to[e]] === this.level[u] + 1)) e = this.next[e];
      this.cursor[u] = e;
      if (e !== -1) {
        path.push(e);
        u = this.to[e];
      } else {
        if (u === s) return total;
        const back = path.pop() as number;
        u = this.to[back ^ 1];
        this.cursor[u] = this.next[this.cursor[u]];
      }
    }
  }

  /** Nodes still reachable from `s` through arcs with residual capacity. */
  reachable(s: number): Uint8Array {
    const seen = new Uint8Array(this.head.length);
    seen[s] = 1;
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (let e = this.head[u]; e !== -1; e = this.next[e]) {
        const v = this.to[e];
        if (this.cap[e] > EPS && !seen[v]) {
          seen[v] = 1;
          queue.push(v);
        }
      }
    }
    return seen;
  }
}

/** Conveyors that sit on the min cut, lowest capacity first, then id (amendment, Decision 3). Only finite-capacity arcs
 *  can cap: a pipe with no trusted capacity can block a path, never cap it. */
function cutEdges(net: Network, owners: ReadonlyMap<number, ConveyorEdge>, source: number): ConveyorEdge[] {
  const reach = net.reachable(source);
  const found = new Map<string, ConveyorEdge>();
  for (const [arc, edge] of owners) {
    if (reach[net.tail(arc)] && !reach[net.headOf(arc)] && edge.capacityPerMinute !== null) found.set(edge.id, edge);
  }
  return [...found.values()].sort((a, b) => (a.capacityPerMinute ?? 0) - (b.capacityPerMinute ?? 0) || byString(a.id, b.id));
}

/**
 * The connection graph (amendment, Decision 3). A belt or lift is one arc end 0 to end 1; a pipe is two arcs, because pipe
 * ends are not oriented; an open end adds no arc. A conveyor named as an end of another (`fromKind`/`toKind` "conveyor")
 * is joined to the matching end of that conveyor (end 1 of A to end 0 of B and vice versa) with a union-find, so a chain of
 * directly joined conveyors is one path. Edges are processed in id order so node numbering and kinds are deterministic.
 */
function buildGraph(input: readonly ConveyorEdge[]): Graph {
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

function filterOf(unit: ProductionRate["unit"]): Filter {
  return unit === "m3/min" ? "fluid" : unit === "items/min" ? "solid" : "any";
}

/** A pipe carries only fluids and a belt or lift only solids; an item of unknown unit may use either. */
function usable(arc: Arc, filter: Filter): boolean {
  if (filter === "any") return true;
  return filter === "fluid" ? arc.edge.kind === "pipe" : arc.edge.kind !== "pipe";
}

function sumRate(rates: readonly ProductionRate[] | undefined, className: string): number {
  let total = 0;
  for (const r of rates ?? []) if (r.className === className) total += r.maxPerMinute;
  return total;
}

interface SharedCut {
  edge: ConveyorEdge;
  /** Nodes of the machines behind the cut conveyor. */
  behind: Set<number>;
}

class Finder {
  private readonly byId = new Map<string, FactoryBuilding>();
  private readonly producersOf = new Map<string, FactoryBuilding[]>();
  private readonly consumersOf = new Map<string, FactoryBuilding[]>();
  private readonly graph: Graph | null;
  private readonly regions = new Map<string, Region>();
  private readonly verdicts = new Map<string, Verdict | null>();
  private readonly sharedCuts = new Map<string, SharedCut[]>();
  private readonly feeds = new Map<string, { fed: Set<number>; total: number }>();

  constructor(readonly buildings: readonly FactoryBuilding[], edges: readonly ConveyorEdge[] | null) {
    this.graph = edges === null ? null : buildGraph(edges);
    for (const b of buildings) {
      this.byId.set(b.id, b);
      for (const r of b.production) this.add(this.producersOf, r.className, b);
      for (const r of b.ingredients ?? []) this.add(this.consumersOf, r.className, b);
    }
  }

  private add(map: Map<string, FactoryBuilding[]>, key: string, b: FactoryBuilding): void {
    const list = map.get(key);
    if (!list) map.set(key, [b]);
    else if (list[list.length - 1] !== b) list.push(b);
  }

  /** Recipe machines no conveyor names: built since the last connections read (Decision 3, staleness). */
  unnamedMachineCount(): number {
    if (!this.graph) return 0;
    let n = 0;
    for (const b of this.buildings) if (b.recipe !== null && !this.graph.idToNode.has(b.id)) n++;
    return n;
  }

  private nodeOf(b: FactoryBuilding): number | undefined {
    return this.graph?.idToNode.get(b.id);
  }

  /** The region a flow to (back) or from (fwd) `root` can use: expand through pass-through nodes, stop at terminals. */
  private region(root: number, filter: Filter, dir: "back" | "fwd"): Region {
    const key = `${dir}\0${filter}\0${root}`;
    const cached = this.regions.get(key);
    if (cached) return cached;
    const g = this.graph as Graph;
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
    const region = { arcs, nodes, terminals, terminalSet: new Set(terminals) };
    this.regions.set(key, region);
    return region;
  }

  /** A backed-up producer is healthy (ADR-0048, upstream rule 4); a backed-up consumer is not (downstream recurses). */
  private bestBad(list: readonly FactoryBuilding[], dir: "up" | "down"): FactoryBuilding | undefined {
    let best: FactoryBuilding | undefined;
    let bestP = Infinity;
    for (const b of list) {
      const p = BAD_STATE_PRIORITY.get(b.state ?? "");
      if (p === undefined || (dir === "up" && b.state === "backedUp")) continue;
      if (p < bestP || (p === bestP && best !== undefined && b.id < best.id)) {
        best = b;
        bestP = p;
      }
    }
    return best;
  }

  /** The best verdict for machine `m` across its ingredients (up) or outputs (down), skipping `skipItem`. */
  best(m: FactoryBuilding, dir: "up" | "down", skipItem: string | null): Verdict | null {
    const seen = new Set<string>();
    let best: Verdict | null = null;
    const rates = dir === "up" ? (m.ingredients ?? []) : m.production;
    for (const rate of [...rates].sort((a, b) => byString(a.className, b.className))) {
      if (rate.className === skipItem || seen.has(rate.className)) continue;
      seen.add(rate.className);
      const v = this.verdict(m, dir, rate);
      if (!best || v.rank < best.rank) best = v;
    }
    return best;
  }

  private verdict(m: FactoryBuilding, dir: "up" | "down", rate: ProductionRate): Verdict {
    const key = `${dir}\0${m.id}\0${rate.className}`;
    const cached = this.verdicts.get(key);
    if (cached) return cached;
    const v = dir === "up" ? this.verdictUp(m, rate) : this.verdictDown(m, rate);
    this.verdicts.set(key, v);
    return v;
  }

  private mk(kind: VerdictKind, rate: ProductionRate, beltLevel: boolean, extra: Partial<Verdict> = {}): Verdict {
    const rank = kind === "logistics" && extra.cap ? CAPPED_LOGISTICS_RANK : VERDICT_RANK.get(kind) as number;
    return { kind, rank, rate, beltLevel, ...extra };
  }

  // ---- upstream: an underfed machine ----

  private verdictUp(m: FactoryBuilding, rate: ProductionRate): Verdict {
    const x = rate.className;
    const demand = sumRate(m.ingredients, x);
    const producers = (this.producersOf.get(x) ?? []).filter((p) => p !== m);
    const node = this.nodeOf(m);
    // Belt level needs M and every producer of X on the graph; one built since the last read means item level (staleness).
    const beltLevel = this.graph !== null && node !== undefined && producers.every((p) => this.nodeOf(p) !== undefined);

    if (!beltLevel) {
      if (producers.length === 0) return this.mk("noProducer", rate, false);
      const supply = producers.reduce((s, p) => s + sumRate(p.production, x), 0);
      const total = (this.consumersOf.get(x) ?? []).reduce((s, c) => s + sumRate(c.ingredients, x), 0);
      if (total > supply + EPS) return this.mk("deficit", rate, false, { supply, demand: total });
      const bad = this.bestBad(producers, "up");
      if (bad) return this.mk("upstream", rate, false, { other: bad });
      return this.mk("logistics", rate, false, { demand });
    }

    const g = this.graph as Graph;
    const filter = filterOf(rate.unit);
    const region = this.region(node as number, filter, "back");
    const inRegion = producers.filter((p) => region.terminalSet.has(this.nodeOf(p) as number));
    const hasSource = region.terminals.some((t) => SOURCE_KINDS.has(g.kind[t]));
    if (producers.length === 0 && !hasSource) return this.mk("noProducer", rate, true);
    if (inRegion.length === 0 && !hasSource) return this.mk("notConnected", rate, true);

    if (!hasSource) {
      // Local deficit: what the reachable producers make against what every consumer they can feed wants.
      const supply = inRegion.reduce((s, p) => s + sumRate(p.production, x), 0);
      // Every machine on one manifold sees the same producers, so the fed set is built once per producer set.
      const feedKey = `${x}\0${filter}\0${inRegion.map((p) => this.nodeOf(p)).join(",")}`;
      let feed = this.feeds.get(feedKey);
      if (!feed) {
        const fed = new Set<number>();
        for (const p of inRegion) {
          const fwd = this.region(this.nodeOf(p) as number, filter, "fwd");
          for (const t of fwd.terminals) fed.add(t);
        }
        const total = (this.consumersOf.get(x) ?? [])
          .filter((c) => fed.has(this.nodeOf(c) ?? -1))
          .reduce((s, c) => s + sumRate(c.ingredients, x), 0);
        feed = { fed, total };
        this.feeds.set(feedKey, feed);
      }
      const wanted = feed.total + (feed.fed.has(node as number) ? 0 : demand);
      if (wanted > supply + EPS) return this.mk("deficit", rate, true, { supply, demand: wanted });
    }
    const bad = this.bestBad(inRegion, "up");
    if (bad) return this.mk("upstream", rate, true, { other: bad });

    const cut = this.upCut(region, node as number, x, demand, inRegion);
    if (cut) return this.mk("logistics", rate, true, { cap: cut, demand });
    const shared = this.sharedCut(x, filter, node as number);
    if (shared) return this.mk("logistics", rate, true, { cap: shared, demand });
    return this.mk("logistics", rate, true, { demand });
  }

  /** Dinic from a super-source (the reachable producers at their `maxPerMinute`, the unread sources uncapped) to M's
   *  demand; the cap on the min cut when the flow falls short. */
  private upCut(region: Region, root: number, x: string, demand: number, producers: readonly FactoryBuilding[]): ConveyorEdge | null {
    const g = this.graph as Graph;
    const local = new Map<number, number>();
    region.nodes.forEach((n, i) => local.set(n, i));
    const s = region.nodes.length;
    const t = s + 1;
    const net = new Network(s + 2);
    const owners = new Map<number, ConveyorEdge>();
    for (const arc of region.arcs) owners.set(net.addArc(local.get(arc.from) as number, local.get(arc.to) as number, arc.cap), arc.edge);
    for (const p of producers) net.addArc(s, local.get(this.nodeOf(p) as number) as number, sumRate(p.production, x));
    for (const term of region.terminals) if (SOURCE_KINDS.has(g.kind[term])) net.addArc(s, local.get(term) as number, Infinity);
    net.addArc(local.get(root) as number, t, demand);
    if (net.maxFlow(s, t) >= demand - EPS) return null;
    return cutEdges(net, owners, s)[0] ?? null;
  }

  /**
   * The shared manifold (Decision 3): a second Dinic per item over the whole graph, from every producer of X to every
   * consumer of X. Its cut can starve several consumers at once even when each one's own region has room. Returns the
   * lowest-capacity cut conveyor with `node` behind it.
   */
  private sharedCut(x: string, filter: Filter, node: number): ConveyorEdge | null {
    const key = `${x}\0${filter}`;
    let cuts = this.sharedCuts.get(key);
    if (!cuts) {
      cuts = this.computeSharedCuts(x, filter);
      this.sharedCuts.set(key, cuts);
    }
    return cuts.find((c) => c.behind.has(node))?.edge ?? null;
  }

  private computeSharedCuts(x: string, filter: Filter): SharedCut[] {
    const g = this.graph as Graph;
    const n = g.kind.length;
    // A terminal has an in-copy (index i) and an out-copy (i + n) so flow never passes through a machine.
    const outCopy = (i: number): number => (TERMINAL_KINDS.has(g.kind[i]) ? i + n : i);
    const s = 2 * n;
    const t = s + 1;
    const net = new Network(2 * n + 2);
    const owners = new Map<number, ConveyorEdge>();
    for (let u = 0; u < n; u++) {
      for (const arc of g.out[u]) if (usable(arc, filter)) owners.set(net.addArc(outCopy(arc.from), arc.to, arc.cap), arc.edge);
    }
    for (let i = 0; i < n; i++) if (SOURCE_KINDS.has(g.kind[i])) net.addArc(s, outCopy(i), Infinity);
    for (const p of this.producersOf.get(x) ?? []) {
      const i = this.nodeOf(p);
      if (i !== undefined) net.addArc(s, outCopy(i), sumRate(p.production, x));
    }
    let total = 0;
    for (const c of this.consumersOf.get(x) ?? []) {
      const i = this.nodeOf(c);
      if (i === undefined) continue;
      const d = sumRate(c.ingredients, x);
      total += d;
      net.addArc(i, t, d);
    }
    if (net.maxFlow(s, t) >= total - EPS) return [];
    return cutEdges(net, owners, s).map((edge) => {
      const behind = new Set<number>();
      for (const arc of this.arcsOf(edge, filter)) {
        behind.add(arc.to);
        for (const term of this.region(arc.to, filter, "fwd").terminals) behind.add(term);
      }
      return { edge, behind };
    });
  }

  private arcsOf(edge: ConveyorEdge, filter: Filter): Arc[] {
    const g = this.graph as Graph;
    const found: Arc[] = [];
    for (const list of g.out) for (const arc of list) if (arc.edge === edge && usable(arc, filter)) found.push(arc);
    return found;
  }

  // ---- downstream: a backed-up machine ----

  private verdictDown(m: FactoryBuilding, rate: ProductionRate): Verdict {
    const x = rate.className;
    const made = sumRate(m.production, x);
    const consumers = (this.consumersOf.get(x) ?? []).filter((c) => c !== m);
    const node = this.nodeOf(m);
    const beltLevel = this.graph !== null && node !== undefined && consumers.every((c) => this.nodeOf(c) !== undefined);

    if (!beltLevel) {
      if (consumers.length === 0) return this.mk("noConsumer", rate, false);
      const supply = (this.producersOf.get(x) ?? []).reduce((s, p) => s + sumRate(p.production, x), 0);
      const demand = consumers.reduce((s, c) => s + sumRate(c.ingredients, x), 0);
      if (supply > demand + EPS) return this.mk("surplus", rate, false, { supply, demand });
      const bad = this.bestBad(consumers, "down");
      if (bad) return this.mk("downstream", rate, false, { other: bad });
      return this.mk("logistics", rate, false);
    }

    const g = this.graph as Graph;
    const filter = filterOf(rate.unit);
    const region = this.region(node as number, filter, "fwd");
    const inRegion = consumers.filter((c) => region.terminalSet.has(this.nodeOf(c) as number));
    const hasSink = region.terminals.some((t) => SINK_KINDS.has(g.kind[t]));
    if (inRegion.length === 0 && !hasSink) return this.mk("noConsumer", rate, true);

    if (!hasSink) {
      const demand = inRegion.reduce((s, c) => s + sumRate(c.ingredients, x), 0);
      const feeders = new Set<FactoryBuilding>([m]);
      for (const c of inRegion) {
        const back = this.region(this.nodeOf(c) as number, filter, "back");
        for (const p of this.producersOf.get(x) ?? []) if (back.terminalSet.has(this.nodeOf(p) ?? -1)) feeders.add(p);
      }
      const supply = [...feeders].reduce((s, p) => s + sumRate(p.production, x), 0);
      if (supply > demand + EPS) return this.mk("surplus", rate, true, { supply, demand });
    }
    const bad = this.bestBad(inRegion, "down");
    if (bad) return this.mk("downstream", rate, true, { other: bad });

    const cut = this.downCut(region, node as number, x, made, inRegion);
    if (cut) return this.mk("logistics", rate, true, { cap: cut, supply: made });
    return this.mk("logistics", rate, true);
  }

  private downCut(region: Region, root: number, x: string, made: number, consumers: readonly FactoryBuilding[]): ConveyorEdge | null {
    const g = this.graph as Graph;
    const local = new Map<number, number>();
    region.nodes.forEach((n, i) => local.set(n, i));
    const s = region.nodes.length;
    const t = s + 1;
    const net = new Network(s + 2);
    const owners = new Map<number, ConveyorEdge>();
    for (const arc of region.arcs) owners.set(net.addArc(local.get(arc.from) as number, local.get(arc.to) as number, arc.cap), arc.edge);
    net.addArc(s, local.get(root) as number, made);
    for (const c of consumers) net.addArc(local.get(this.nodeOf(c) as number) as number, t, sumRate(c.ingredients, x));
    for (const term of region.terminals) if (SINK_KINDS.has(g.kind[term])) net.addArc(local.get(term) as number, t, Infinity);
    if (net.maxFlow(s, t) >= made - EPS) return null;
    return cutEdges(net, owners, s)[0] ?? null;
  }
}

// ---- chains and sentences ----

function unitSuffix(unit: BottleneckStep["unit"]): string {
  return unit === "m3/min" ? " m3/min" : "/min";
}

function stepOf(v: Verdict): BottleneckStep {
  const step: BottleneckStep = { kind: v.kind, itemClassName: v.rate.className, itemName: v.rate.name };
  if (v.rate.unit !== undefined) step.unit = v.rate.unit;
  if (v.other) step.buildingId = v.other.id;
  if (v.cap) {
    step.cappedBy = {
      conveyorId: v.cap.id,
      kind: v.cap.kind,
      tier: v.cap.tier,
      capacityPerMinute: v.cap.capacityPerMinute ?? 0,
      fromId: v.cap.from,
      toId: v.cap.to,
      at: v.cap.at,
    };
  }
  if (v.kind === "logistics" && v.cap) {
    // Up: what can get through against what is wanted. Down: what the machine makes against what the output belt takes.
    const through = v.cap.capacityPerMinute ?? 0;
    if (v.demand !== undefined) {
      step.supplyMaxPerMinute = through;
      step.demandMaxPerMinute = v.demand;
    } else if (v.supply !== undefined) {
      step.supplyMaxPerMinute = v.supply;
      step.demandMaxPerMinute = through;
    }
  } else {
    if (v.supply !== undefined) step.supplyMaxPerMinute = v.supply;
    if (v.demand !== undefined && v.kind !== "logistics") step.demandMaxPerMinute = v.demand;
  }
  return step;
}

function terminalStep(b: FactoryBuilding, x: ProductionRate): BottleneckStep {
  const step: BottleneckStep = { kind: b.state ?? "idle", buildingId: b.id, itemClassName: x.className, itemName: x.name };
  if (x.unit !== undefined) step.unit = x.unit;
  return step;
}

/**
 * Walks the chain from `m`: the best verdict, then into the producer (up) or consumer (down) it points at, to a terminal.
 * ADR-0048: a visited set of item nodes ends a loop ("loop through X"); the chain is at most 8 steps. Of several bad
 * producers the walk follows one (terminal states first, then id), so it is linear and deterministic.
 */
function walk(
  finder: Finder,
  m: FactoryBuilding,
  dir: "up" | "down",
  skipItem: string | null,
  visited: Set<string>,
  steps: BottleneckStep[],
  verdicts: Verdict[],
): void {
  const v = finder.best(m, dir, skipItem);
  if (!v || steps.length >= BOTTLENECK_CHAIN_MAX_STEPS) return;
  if (visited.has(v.rate.className)) {
    steps.push({ kind: "loop", itemClassName: v.rate.className, itemName: v.rate.name });
    return;
  }
  visited.add(v.rate.className);
  steps.push(stepOf(v));
  verdicts.push(v);
  if (!v.other || (v.kind !== "upstream" && v.kind !== "downstream")) return;
  const state = v.other.state ?? "";
  if (TERMINAL_STATES.has(state)) {
    if (steps.length < BOTTLENECK_CHAIN_MAX_STEPS) steps.push(terminalStep(v.other, v.rate));
  } else if (v.kind === "upstream") {
    walk(finder, v.other, "up", null, visited, steps, verdicts);
  } else if (state === "backedUp") {
    walk(finder, v.other, "down", null, visited, steps, verdicts);
  } else {
    // An underfed consumer: why it is short of its other inputs.
    walk(finder, v.other, "up", v.rate.className, visited, steps, verdicts);
  }
}

interface Raw {
  m: FactoryBuilding;
  state: "underfed" | "backedUp";
  steps: BottleneckStep[];
  itemLevelFallback: boolean;
  key: string;
  lost: number;
}

/** Findings that share a root cause share a key: the same kind, item and capping conveyor or blocked building. */
function rootKey(raw: { m: FactoryBuilding; steps: BottleneckStep[] }): string {
  const root = raw.steps[raw.steps.length - 1];
  if (root.kind === "logistics" && !root.cappedBy) return `logistics\0${raw.m.id}`;
  return `${root.kind}\0${root.itemClassName ?? ""}\0${root.cappedBy?.conveyorId ?? root.buildingId ?? ""}`;
}

function describe(step: BottleneckStep, dir: "up" | "down", who: string, nameOf: (id: string | undefined) => string): string {
  const item = step.itemName ?? step.itemClassName ?? "the item";
  const u = unitSuffix(step.unit);
  switch (step.kind) {
    case "noProducer":
      return `nothing in the factory makes ${item}`;
    case "notConnected":
      return `${item} is made in the factory, but no belt or pipe connects a producer or a source to ${who}`;
    case "deficit":
      return `${item} is made at most ${num(step.supplyMaxPerMinute ?? 0)}${u} and its consumers want ${num(step.demandMaxPerMinute ?? 0)}${u}`;
    case "upstream":
      return `${item} comes from ${nameOf(step.buildingId)}, which is short itself`;
    case "logistics": {
      const c = step.cappedBy;
      if (!c) {
        return dir === "up"
          ? `enough ${item} is made, but it is not reaching ${who}; the data cannot say why (splitter balancing, filters, mixed belts or overflow)`
          : `${item} has somewhere to go, but it is not leaving ${who}; the data cannot say why (splitter balancing, filters, mixed belts or overflow)`;
      }
      const at = `near (${c.at.x}, ${c.at.y})`;
      return dir === "up"
        ? `a ${c.tier} (${num(c.capacityPerMinute)}${u}) ${at} caps ${item} at ${num(c.capacityPerMinute)}${u}; ${who} wants ${num(step.demandMaxPerMinute ?? 0)}${u}`
        : `a ${c.tier} (${num(c.capacityPerMinute)}${u}) ${at} caps ${item} leaving ${who} at ${num(c.capacityPerMinute)}${u}; it makes ${num(step.supplyMaxPerMinute ?? 0)}${u}`;
    }
    case "unpowered":
    case "paused":
    case "idle":
      return `${nameOf(step.buildingId)} is ${step.kind}`;
    case "loop":
      return `the shortage loops back through ${item}`;
    case "noConsumer":
      return `nothing reachable consumes ${item}; it may go to storage, a sink or a generator, which the data does not show`;
    case "surplus":
      return `${item} is made at most ${num(step.supplyMaxPerMinute ?? 0)}${u} and its consumers take ${num(step.demandMaxPerMinute ?? 0)}${u}`;
    case "downstream":
      return `${item} goes to ${nameOf(step.buildingId)}, which is held up itself`;
    default:
      return `${step.kind} on ${item}`;
  }
}

const STALE_SENTENCE = ` Connections refresh within ${CONNECTIONS_REFRESH_MINUTES} minutes.`;

function noteFor(code: string): BottleneckNote {
  switch (code) {
    case "updateFrm":
      return { code, text: "Item-level results only; update FRM to 1.5.4 or newer for belt detail." };
    case "beltDataTooLarge":
      return { code, text: "Item-level results only; the belt and pipe data is too large to use on this save." };
    default:
      return {
        code: "connectionsRefresh",
        text: `Connections refresh every ${CONNECTIONS_REFRESH_MINUTES} minutes, so a belt built or rebuilt since may not show yet.`,
      };
  }
}

/**
 * The bottleneck finder. `edges` is the conveyors layer of one read, or why it is missing (`beltData` in the result says
 * which mode ran). Ranking (ADR-0048): findings whose root cause is shared by the most machines first, then by lost output
 * (`maxPerMinute - currentPerMinute` of the main product), then building id. The sort is total, so output does not flicker.
 */
export function findBottlenecks(
  buildings: readonly FactoryBuilding[],
  edges: BottleneckEdges,
  options: BottleneckOptions = {},
): Bottlenecks {
  const asked = Math.trunc(options.limit ?? BOTTLENECKS_DEFAULT_LIMIT);
  const limit = Number.isNaN(asked) ? BOTTLENECKS_DEFAULT_LIMIT : Math.min(BOTTLENECKS_MAX_LIMIT, Math.max(1, asked));
  const sorted = [...buildings].sort((a, b) => byString(a.id, b.id));
  const finder = new Finder(sorted, typeof edges === "string" ? null : edges);

  const beltData: Bottlenecks["beltData"] =
    edges === "unsupported" ? "unsupported" : edges === "tooLarge" ? "tooLarge" : finder.unnamedMachineCount() > 0 ? "stale" : "present";

  const raws: Raw[] = [];
  for (const m of sorted) {
    const dir = m.state === "underfed" ? "up" : m.state === "backedUp" ? "down" : null;
    if (dir === null) continue;
    const steps: BottleneckStep[] = [];
    const verdicts: Verdict[] = [];
    walk(finder, m, dir, null, new Set(), steps, verdicts);
    if (steps.length === 0 || verdicts.length === 0) continue;
    const main = m.production.reduce<ProductionRate | null>((best, r) => {
      if (!best || r.maxPerMinute > best.maxPerMinute) return r;
      // Equal maxima: the lower className, so the pick does not depend on the order of the rates.
      return r.maxPerMinute === best.maxPerMinute && r.className < best.className ? r : best;
    }, null);
    raws.push({
      m,
      state: dir === "up" ? "underfed" : "backedUp",
      steps,
      // Only a stale graph (not an absent one) earns the "connections refresh" sentence.
      itemLevelFallback: typeof edges !== "string" && !verdicts[0].beltLevel,
      key: rootKey({ m, steps }),
      lost: main ? Math.max(0, main.maxPerMinute - main.currentPerMinute) : 0,
    });
  }

  const shared = new Map<string, number>();
  for (const r of raws) shared.set(r.key, (shared.get(r.key) ?? 0) + 1);
  raws.sort(
    (a, b) => (shared.get(b.key) ?? 0) - (shared.get(a.key) ?? 0) || b.lost - a.lost || byString(a.m.id, b.m.id),
  );

  const nameIndex = new Map(sorted.map((b) => [b.id, b.name]));
  const lookup = (id: string | undefined): string => (id === undefined ? "a machine" : (nameIndex.get(id) ?? "a machine"));

  const findings: Bottleneck[] = raws.slice(0, limit).map((r) => {
    const root = r.steps[r.steps.length - 1];
    const dir = r.state === "underfed" ? "up" : "down";
    const first = describe(r.steps[0], dir, r.m.name, lookup);
    const cause = r.steps.length > 1 ? `; root cause: ${describe(root, dir, r.m.name, lookup)}` : "";
    const count = shared.get(r.key) ?? 1;
    const sharedText = count > 1 ? ` The same cause affects ${count} machines.` : "";
    const stale = r.itemLevelFallback ? STALE_SENTENCE : "";
    let text = `${r.m.name} is ${r.state === "underfed" ? "underfed" : "backed up"}: ${first}${cause}.${sharedText}${stale}`;
    if (text.length > 500) {
      let cut = 499;
      // Do not end on the first half of a surrogate pair.
      if (text.charCodeAt(cut - 1) >= 0xd800 && text.charCodeAt(cut - 1) <= 0xdbff) cut--;
      text = `${text.slice(0, cut)}…`;
    }
    return {
      buildingId: r.m.id,
      buildingName: r.m.name.slice(0, 200),
      state: r.state,
      rootCause: root,
      chain: r.steps,
      text,
    };
  });

  const notes: BottleneckNote[] =
    beltData === "unsupported" ? [noteFor("updateFrm")] : beltData === "tooLarge" ? [noteFor("beltDataTooLarge")] : [noteFor("connectionsRefresh")];

  return { findings, truncated: raws.length > limit, beltData, connectionsRefreshMinutes: CONNECTIONS_REFRESH_MINUTES, notes };
}
