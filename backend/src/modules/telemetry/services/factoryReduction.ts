import { createHash } from "node:crypto";
import {
  PLANNER_MAX_FACTORIES,
  PLANNER_MAX_RATES,
  PLANNER_MAX_SHARES,
  PLANNER_MAX_SIDE_PRODUCTS,
  type PlannerEdge,
  type PlannerFactory,
  type PlannerNode,
  type PlannerRate,
  type PlannerShare,
  type PlannerTransport,
} from "@satisfactory-dash/shared";
import { byString, disjointSets, stronglyConnected } from "./connectionGraph.js";
import { DEPOT_NODE_KEY } from "./logisticsEdges.js";
import { DEPOT_CLASS, SINK_CLASS } from "./plannerFlows.js";

/**
 * Logical factory reduction for the production planner (ADR-0055 Decision 4; build PR 6b). Pure and deterministic: no I/O,
 * no clock, no randomness; the same graph in any node, edge or transport order gives byte-identical output. Distance never
 * enters (a node's `at` only names a factory). Only MAX rates are read, never current ones, so the result depends on the
 * topology and the build, not on how busy a line is this minute (rate-noise invariance).
 *
 * Steps, each linear or close to it in the graph:
 * 1. Buffers (storage, platforms with an outgoing supply) are not contracted into their in x out edges, which would be
 *    quadratic at a hub; share vectors are linear, so propagating through a buffer gives the same result as contracting it.
 *    A buffer keeps its own factory, which the contraction would have kept too ("the folded nodes keep their factoryKey").
 * 2. Loops: strongly connected components of the supply graph; members share one vector (the mean of theirs).
 * 3. Seeds: a machine whose product leaves the supply graph (an `output` arc, directly or through buffers) or that has no
 *    supply out-arc, plus an extractor that feeds no machine at all (a farm). A machine that cannot reach any seed over
 *    supply arcs (a closed loop) is promoted to a seed, so a component without seeds is still one factory. Seeds of the same
 *    product whose upstream closures share a non-raw node are one factory (union-find), disjoint ones are separate.
 * 4. Shares: reverse topological order over the condensation; a seed is 1 for its factory, any other node the sum over its
 *    supply out-arcs of weight x the destination's vector. Weight is the arc's fraction of the node's design output: the
 *    destination's max demand for the item split between its suppliers by their max output (ADR-0050 Decision 2 on max
 *    values), unknown arcs taking the remainder in equal parts. Excess and output arcs are not in the denominator.
 *    A non-machine node with no vector (a terminal storage, the sink, a platform without supply out-arcs) takes the mean of
 *    its feeders' vectors.
 * 5. Home factory: the largest share; ties within 0.001 go to the factory whose seeds have the larger max output, then the
 *    lower factory key. Under 0.95 the node is `shared` and lists its top shares (four, the rest summed as "other").
 * 6. A factory under `MIN_FACTORY_MACHINES` machines folds into another only when it is a dependent offshoot (Decision 6,
 *    option C, the owner's answer).
 * 7. Post-dominators (Cooper, Harvey and Kennedy) on each factory's supply subgraph give `collapseUnder`. A virtual exit
 *    follows the seeds, every node that sends product out of the graph, and every node with a supply arc into another
 *    factory, so a supplier that also feeds another factory (a shared one) is never hidden by one consumer.
 * 8. Names and keys.
 */

export const MIN_FACTORY_MACHINES = 4;
/** A node whose largest share is under this is shared between factories. */
export const SHARED_BELOW = 0.95;
const TIE = 0.001;
export const OTHER_SHARE_KEY = "other";

const NAME_MAX = 200;
const KEY_PART_MAX = 80;
const SHARE_DECIMALS = 1e6;
const GENERATOR = /^Build_Generator/;
const TRANSPORT_LEAVES: ReadonlySet<string> = new Set(["depot", "sink", "export"]);

export interface ReductionInput {
  nodes: readonly PlannerNode[];
  edges: readonly PlannerEdge[];
  transports: readonly PlannerTransport[];
  /** Snaps a metre coordinate onto the node-key grid (the caller owns `KEY_GRID_M`). */
  snap: (v: number) => number;
  /**
   * ADR-0055 Decision 5: node key -> the designation that holds that machine node. Designated nodes are fixed to their
   * designation's factory (one per designation) and never reassigned; they seed it, so shared upstream is still attributed
   * to it by share. Absent or empty = fully automatic.
   */
  designations?: ReadonlyMap<string, { id: string; name: string }>;
}

export interface NodeAnnotation {
  factoryKey?: string;
  shares?: PlannerShare[];
  collapseUnder: string | null;
  role?: string;
}

export interface ReductionStats {
  seeds: number;
  factories: number;
  /** Weak components of the logical graph (the Depot's virtual node not joining them) that hold at least one factory. */
  components: number;
  /** Factories in each such component, largest first, at most 20 entries. */
  factoriesPerComponent: number[];
  sharedNodes: number;
  /** The most factories any one node's design output is split across (1 = nothing shared). */
  maxShareFactories: number;
  /** The smallest largest-share of any shared node (the widest split); 1 when nothing is shared. */
  lowestTopShare: number;
  largestFactoryMachines: number;
  /** Machine groups with no factory: must be 0. */
  unassignedGroups: number;
  /** Factories left out for the contract's cap. */
  droppedFactories: number;
}

export interface ReductionResult {
  annotations: Map<string, NodeAnnotation>;
  factories: PlannerFactory[];
  topologyHash: string;
  stats: ReductionStats;
}

interface Arc {
  s: number;
  d: number;
  item: string | null;
  supply: boolean;
  /** "belt", "pipe" or the transport mode. */
  tag: string;
  transport: boolean;
  flow: string;
  destination: string;
}

type Vec = Map<number, number>;

/** Two decimals, and always a finite, non-negative number the contract accepts (a sum of huge rates can overflow). */
const r2 = (n: number): number => {
  if (Number.isNaN(n) || n <= 0) return 0;
  if (!Number.isFinite(n)) return Number.MAX_VALUE;
  return n >= 1e15 ? n : Math.round(n * 100) / 100;
};

function maxMap(rates: readonly PlannerRate[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rates) m.set(r.className, (m.get(r.className) ?? 0) + r.maxPerMinute);
  return m;
}

export function reduceFactories(input: ReductionInput): ReductionResult {
  const nodes = [...input.nodes].sort((a, b) => byString(a.key, b.key));
  const n = nodes.length;
  const idx = new Map<string, number>();
  nodes.forEach((nd, i) => idx.set(nd.key, i));

  // ---- arcs, in a canonical order ----
  const arcs: Arc[] = [];
  for (const e of input.edges) {
    const s = idx.get(e.from);
    const d = idx.get(e.to);
    if (s === undefined || d === undefined || s === d) continue;
    const flow = e.flow ?? "supply";
    arcs.push({ s, d, item: e.itemClassName, supply: flow === "supply", tag: e.kind, transport: false, flow, destination: e.destination ?? "" });
  }
  for (const t of input.transports) {
    const s = idx.get(t.from);
    const d = idx.get(t.to);
    if (s === undefined || d === undefined || s === d) continue;
    const flow = t.flow ?? "supply";
    arcs.push({ s, d, item: t.itemClassName, supply: flow === "supply", tag: t.mode, transport: true, flow, destination: t.destination ?? "" });
  }
  arcs.sort(
    (a, b) =>
      a.s - b.s ||
      a.d - b.d ||
      byString(a.item ?? "", b.item ?? "") ||
      byString(a.tag, b.tag) ||
      byString(a.flow, b.flow) ||
      byString(a.destination, b.destination),
  );
  const outAll: number[][] = Array.from({ length: n }, () => []);
  const outS: number[][] = Array.from({ length: n }, () => []);
  const inS: number[][] = Array.from({ length: n }, () => []);
  arcs.forEach((a, i) => {
    outAll[a.s].push(i);
    if (a.supply) {
      outS[a.s].push(i);
      inS[a.d].push(i);
    }
  });

  const isDepotNode = (i: number): boolean => nodes[i].key === DEPOT_NODE_KEY;
  const isMachine = (i: number): boolean => nodes[i].kind === "machines";
  const prodMax = nodes.map((nd) => maxMap(nd.products));
  const ingMax = nodes.map((nd) => maxMap(nd.ingredients));
  const outputTotal = nodes.map((nd) => nd.products.reduce((s, p) => s + p.maxPerMinute, 0));
  const machinesIn = (i: number): number => (isMachine(i) ? nodes[i].count : 0);
  const desigOf: ({ id: string; name: string } | undefined)[] = nodes.map((nd) => (nd.kind === "machines" ? input.designations?.get(nd.key) : undefined));

  // ---- roles ----
  const roles: (string | undefined)[] = nodes.map((nd, i) => {
    if (nd.role !== undefined) return nd.role;
    if (nd.className === SINK_CLASS) return "sink";
    if (nd.className === DEPOT_CLASS) return "depot";
    if (nd.kind === "consumer" && GENERATOR.test(nd.className)) return "power";
    if (nd.kind === "storage" || nd.kind === "station") {
      if (outS[i].length > 0) return "buffer";
      return nd.kind === "storage" ? "storage" : "export";
    }
    return undefined;
  });
  const isBuffer = (i: number): boolean =>
    !isMachine(i) && (nodes[i].kind === "storage" || nodes[i].kind === "station" || nodes[i].kind === "other") && roles[i] !== "depot" && outS[i].length > 0;

  // ---- seeds ----
  // A buffer "leaks" when its stock can leave the supply graph: an output arc of its own, or a supply arc to a buffer that leaks.
  const leaks = Array.from({ length: n }, () => false);
  {
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (isBuffer(i) && outAll[i].some((a) => arcs[a].flow === "output")) {
        leaks[i] = true;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      for (const a of inS[queue[q]]) {
        const u = arcs[a].s;
        if (isBuffer(u) && !leaks[u]) {
          leaks[u] = true;
          queue.push(u);
        }
      }
    }
  }
  // Nodes that can reach a machine over supply arcs (reverse BFS from the machines).
  const feedsMachine = Array.from({ length: n }, () => false);
  {
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!isMachine(i)) continue;
      feedsMachine[i] = true;
      queue.push(i);
    }
    for (let q = 0; q < queue.length; q++) {
      for (const a of inS[queue[q]]) {
        const u = arcs[a].s;
        if (!feedsMachine[u]) {
          feedsMachine[u] = true;
          queue.push(u);
        }
      }
    }
  }
  const isSeed = Array.from({ length: n }, () => false);
  for (let i = 0; i < n; i++) {
    if (isDepotNode(i)) continue;
    if (isMachine(i)) {
      isSeed[i] = outS[i].length === 0 || outAll[i].some((a) => arcs[a].flow === "output") || outS[i].some((a) => leaks[arcs[a].d]);
    } else if (nodes[i].kind === "extractor") {
      isSeed[i] = outAll[i].length > 0 && !feedsMachine[i];
    }
  }
  // A designated machine is always a seed: whatever leaves the designation is its output (ADR-0055 Decision 5).
  for (let i = 0; i < n; i++) if (desigOf[i] !== undefined) isSeed[i] = true;
  // A machine that reaches no seed (a closed loop, say) becomes one, lowest key first, so no machine is left without a factory.
  {
    const reached = Array.from({ length: n }, () => false);
    const mark = (from: number): void => {
      const queue = [from];
      reached[from] = true;
      for (let q = 0; q < queue.length; q++) {
        for (const a of inS[queue[q]]) {
          const u = arcs[a].s;
          if (!reached[u]) {
            reached[u] = true;
            queue.push(u);
          }
        }
      }
    };
    for (let i = 0; i < n; i++) if (isSeed[i] && !reached[i]) mark(i);
    for (let i = 0; i < n; i++) {
      if (isMachine(i) && !reached[i]) {
        isSeed[i] = true;
        mark(i);
      }
    }
  }
  const seedList: number[] = [];
  for (let i = 0; i < n; i++) if (isSeed[i]) seedList.push(i);

  /** A seed's product: the item on its output arcs with the largest max rate, else its largest product, else its resource. */
  const productOf = (i: number): { className: string; name: string } => {
    const nd = nodes[i];
    const outItems = new Set<string>();
    for (const a of outAll[i]) if (arcs[a].flow === "output" && arcs[a].item !== null) outItems.add(arcs[a].item as string);
    const ranked = [...nd.products].sort((a, b) => b.maxPerMinute - a.maxPerMinute || byString(a.className, b.className));
    const pick = ranked.find((p) => outItems.has(p.className)) ?? ranked[0];
    if (pick) return { className: pick.className, name: pick.name };
    if (nd.resource) return { className: nd.resource.className, name: nd.resource.name };
    return { className: nd.className, name: nd.name };
  };
  const seedProduct = new Map<number, { className: string; name: string }>();
  for (const s of seedList) seedProduct.set(s, productOf(s));

  // Seeds of one product whose upstream closures share a non-raw node are one factory (the union rule of ADR-0053 Decision 3).
  const sets = disjointSets(n);
  {
    const buffer = nodes.map((_, i) => !isMachine(i) && inS[i].length > 0);
    const machineUp = Array.from({ length: n }, () => false);
    const queue: number[] = [];
    for (let s = 0; s < n; s++) {
      if (!isMachine(s)) continue;
      for (const a of outS[s]) {
        const d = arcs[a].d;
        if (buffer[d] && !machineUp[d]) {
          machineUp[d] = true;
          queue.push(d);
        }
      }
    }
    for (let q = 0; q < queue.length; q++) {
      for (const a of outS[queue[q]]) {
        const d = arcs[a].d;
        if (buffer[d] && !machineUp[d]) {
          machineUp[d] = true;
          queue.push(d);
        }
      }
    }
    const byProduct = new Map<string, number[]>();
    // Designated seeds never join this union: a designation is exactly one factory, linked below.
    const firstOfDesignation = new Map<string, number>();
    for (const s of seedList) {
      const d = desigOf[s];
      if (d === undefined) continue;
      const first = firstOfDesignation.get(d.id);
      if (first === undefined) firstOfDesignation.set(d.id, s);
      else sets.link(first, s);
    }
    for (const s of seedList) {
      if (desigOf[s] !== undefined) continue;
      const cls = (seedProduct.get(s) as { className: string }).className;
      const list = byProduct.get(cls);
      if (list) list.push(s);
      else byProduct.set(cls, [s]);
    }
    const markPass = new Int32Array(n).fill(-1);
    const markStart = new Int32Array(n).fill(-1);
    let pass = 0;
    for (const cls of [...byProduct.keys()].sort(byString)) {
      const starts = byProduct.get(cls) as number[];
      if (starts.length > 1) {
        for (const st of starts) {
          if (markPass[st] === pass) {
            sets.link(st, markStart[st]);
            continue;
          }
          markPass[st] = pass;
          markStart[st] = st;
          const stack = [st];
          while (stack.length > 0) {
            const v = stack.pop() as number;
            for (const a of inS[v]) {
              const u = arcs[a].s;
              if (desigOf[u] !== undefined) continue;
              if (!isMachine(u) && !buffer[u]) continue;
              if (markPass[u] === pass) {
                if (markStart[u] !== st && (isMachine(u) || machineUp[u])) sets.link(st, markStart[u]);
                continue;
              }
              markPass[u] = pass;
              markStart[u] = st;
              stack.push(u);
            }
          }
        }
      }
      pass++;
    }
  }
  // Factory indices in order of each factory's lowest seed key.
  const factoryOfRoot = new Map<number, number>();
  const seedsOf: number[][] = [];
  for (const s of seedList) {
    const r = sets.find(s);
    let f = factoryOfRoot.get(r);
    if (f === undefined) {
      f = seedsOf.length;
      factoryOfRoot.set(r, f);
      seedsOf.push([]);
    }
    seedsOf[f].push(s);
  }
  const F = seedsOf.length;
  const seedFactory = new Map<number, number>();
  seedsOf.forEach((list, f) => list.forEach((s) => seedFactory.set(s, f)));
  const fProduct = seedsOf.map((list) => seedProduct.get(list[0]) as { className: string; name: string });
  const fSeedMax = seedsOf.map((list) =>
    list.reduce((sum, s) => sum + (prodMax[s].get((seedProduct.get(s) as { className: string }).className) ?? 0), 0),
  );
  /** The designation a factory is (every seed of a designated factory has the same one), or undefined for an automatic one. */
  const desigF = seedsOf.map((list) => desigOf[list[0]]);
  const fKey: string[] = [];
  {
    const count = new Map<string, number>();
    seedsOf.forEach((list, f) => {
      const d = desigF[f];
      if (d !== undefined) {
        fKey.push(`factory|designation|${d.id.slice(0, KEY_PART_MAX)}`);
        return;
      }
      let sx = 0;
      let sy = 0;
      for (const s of list) {
        sx += nodes[s].at.x;
        sy += nodes[s].at.y;
      }
      const cx = Math.round(sx / list.length) || 0;
      const cy = Math.round(sy / list.length) || 0;
      const base = `factory|${fProduct[f].className.slice(0, KEY_PART_MAX)}|${input.snap(cx)}|${input.snap(cy)}`;
      const seen = (count.get(base) ?? 0) + 1;
      count.set(base, seen);
      fKey.push(seen === 1 ? base : `${base}#${seen}`);
    });
  }

  // ---- design-rate shares ----
  const supplierTotal = new Map<string, number>();
  for (const a of arcs) {
    if (!a.supply || a.item === null) continue;
    const mo = prodMax[a.s].get(a.item) ?? 0;
    if (mo > 0) supplierTotal.set(`${a.d}\0${a.item}`, (supplierTotal.get(`${a.d}\0${a.item}`) ?? 0) + mo);
  }
  const amountOf = (a: Arc): number | null => {
    if (a.item === null) return null;
    const mo = prodMax[a.s].get(a.item) ?? 0;
    const dem = ingMax[a.d].get(a.item) ?? 0;
    const tot = supplierTotal.get(`${a.d}\0${a.item}`) ?? 0;
    if (!(mo > 0) || !(dem > 0) || !(tot > 0)) return null;
    const amount = Math.min(mo, (mo / tot) * dem);
    // A sum of huge rates can overflow; an amount that is not a finite number is simply unknown.
    return Number.isFinite(amount) ? amount : null;
  };

  const nodeVec: (Vec | null)[] = Array.from({ length: n }, () => null);
  /** The vector a non-seed node gets from the given supply arcs: weights as described in the header, then normalised. */
  const fromArcs = (u: number, list: readonly number[]): Vec | null => {
    const usable = list.filter((a) => {
      const v = nodeVec[arcs[a].d];
      return v !== null && v.size > 0;
    });
    if (usable.length === 0) return null;
    const known = usable.map((a) => amountOf(arcs[a]));
    let kt = 0;
    let unknown = 0;
    for (const k of known) {
      if (k === null) unknown++;
      else kt += k;
    }
    const denom = Math.max(outputTotal[u], kt);
    const weights = known.map((k) => (k !== null ? (denom > 0 ? k / denom : 0) : denom > 0 ? Math.max(0, 1 - kt / denom) / unknown : 1 / unknown));
    const build = (w: readonly number[]): { vec: Vec; mass: number } => {
      const vec: Vec = new Map();
      let mass = 0;
      usable.forEach((a, k) => {
        if (!(w[k] > 0)) return;
        for (const [f, x] of nodeVec[arcs[a].d] as Vec) {
          vec.set(f, (vec.get(f) ?? 0) + w[k] * x);
          mass += w[k] * x;
        }
      });
      return { vec, mass };
    };
    let { vec, mass } = build(weights);
    if (!(mass > 0)) ({ vec, mass } = build(usable.map(() => 1)));
    if (!(mass > 0)) return null;
    for (const [f, x] of vec) vec.set(f, x / mass);
    return vec;
  };

  {
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (const a of arcs) if (a.supply) adj[a.s].push(a.d);
    const scc = stronglyConnected(adj);
    for (let c = 0; c < scc.count; c++) {
      const group = [...scc.members[c]].sort((a, b) => a - b);
      const vecOf = (u: number): Vec | null => {
        const f = seedFactory.get(u);
        if (f !== undefined) return new Map([[f, 1]]);
        return fromArcs(
          u,
          outS[u].filter((a) => scc.comp[arcs[a].d] !== c),
        );
      };
      if (group.length === 1) {
        nodeVec[group[0]] = vecOf(group[0]);
        continue;
      }
      const sum: Vec = new Map();
      let parts = 0;
      for (const u of group) {
        const v = vecOf(u);
        if (v === null) continue;
        parts++;
        for (const [f, x] of v) sum.set(f, (sum.get(f) ?? 0) + x);
      }
      if (parts > 0) {
        for (const [f, x] of sum) sum.set(f, x / parts);
        for (const u of group) nodeVec[u] = sum;
      }
    }
  }
  // A designated machine is fixed to its factory even inside a cycle (where the mean above could pull it elsewhere).
  for (let i = 0; i < n; i++) {
    const f = seedFactory.get(i);
    if (desigOf[i] !== undefined && f !== undefined) nodeVec[i] = new Map([[f, 1]]);
  }
  // A non-machine node without a vector (terminal storage, the sink, a platform that ends a route) takes the mean of the
  // vectors of what feeds it, level by level so the order never matters.
  {
    const inAll: number[][] = Array.from({ length: n }, () => []);
    for (const a of arcs) if (!isDepotNode(a.d) && !isDepotNode(a.s)) inAll[a.d].push(a.s);
    let frontier: number[] = [];
    for (let i = 0; i < n; i++) if (nodeVec[i] !== null) frontier.push(i);
    while (frontier.length > 0) {
      const cand = new Set<number>();
      for (const x of frontier) {
        for (const a of outAll[x]) {
          const y = arcs[a].d;
          if (nodeVec[y] === null && !isDepotNode(y)) cand.add(y);
        }
      }
      const next: number[] = [];
      const fresh = new Map<number, Vec>();
      for (const y of [...cand].sort((a, b) => a - b)) {
        const sources = [...new Set(inAll[y])].sort((a, b) => a - b).filter((s) => nodeVec[s] !== null);
        if (sources.length === 0) continue;
        const vec: Vec = new Map();
        for (const s of sources) for (const [f, x] of nodeVec[s] as Vec) vec.set(f, (vec.get(f) ?? 0) + x / sources.length);
        fresh.set(y, vec);
        next.push(y);
      }
      for (const [y, v] of fresh) nodeVec[y] = v;
      frontier = next;
    }
  }

  // ---- home factory (before folding) ----
  const homeOf = (vec: Vec): number => {
    let top = 0;
    for (const x of vec.values()) if (x > top) top = x;
    let best = -1;
    for (const [f, x] of vec) {
      if (x < top - TIE) continue;
      if (best === -1 || fSeedMax[f] > fSeedMax[best] || (fSeedMax[f] === fSeedMax[best] && byString(fKey[f], fKey[best]) < 0)) best = f;
    }
    return best;
  };
  const home0 = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const v = nodeVec[i];
    if (v !== null && v.size > 0) home0[i] = homeOf(v);
  }

  // ---- fold small dependent factories (Decision 6, option C) ----
  const parent = Array.from({ length: F }, (_, f) => f);
  const rootOf = (f: number): number => {
    let r = f;
    while (parent[r] !== r) r = parent[r];
    let c = f;
    while (parent[c] !== r) {
      const nx = parent[c];
      parent[c] = r;
      c = nx;
    }
    return r;
  };
  const members: number[][] = Array.from({ length: F }, () => []);
  for (let i = 0; i < n; i++) if (home0[i] >= 0) members[home0[i]].push(i);
  const machineCountOf = (f: number): number => members[f].reduce((s, i) => s + machinesIn(i), 0);
  const sideNames: string[][] = Array.from({ length: F }, () => []);
  const homeNow = (i: number): number => (home0[i] < 0 ? -1 : rootOf(home0[i]));
  /** The factory `f` would fold into, or null (it keeps its own card). */
  const foldTarget = (f: number): number | null => {
    const inputs = new Set<number>();
    for (const u of members[f]) {
      if (nodes[u].kind === "extractor") return null;
      for (const a of inS[u]) {
        const h = homeNow(arcs[a].s);
        if (h === f) continue;
        if (h < 0) return null;
        inputs.add(h);
      }
      for (const a of outAll[u]) {
        const arc = arcs[a];
        // Its output leaves by train, truck, drone or the Depot (a transport), or by the sink or the Depot's uploader; the
        // terminal that receives it is assigned to this factory too, so the arc's own class decides, not where it ends.
        if (arc.flow === "output" && (arc.transport || TRANSPORT_LEAVES.has(arc.destination))) return null;
        if (arc.transport && homeNow(arc.d) !== f) return null;
      }
    }
    // A designated factory is fixed: nothing automatic folds into it.
    if (inputs.size !== 1) return null;
    const only = [...inputs][0];
    return desigF[only] !== undefined ? null : only;
  };
  for (let guard = 0; guard <= F; guard++) {
    const small = [];
    for (let f = 0; f < F; f++) if (parent[f] === f && desigF[f] === undefined && machineCountOf(f) < MIN_FACTORY_MACHINES) small.push(f);
    small.sort((a, b) => machineCountOf(a) - machineCountOf(b) || byString(fKey[a], fKey[b]));
    let changed = false;
    for (const f of small) {
      const target = foldTarget(f);
      if (target === null) continue;
      parent[f] = target;
      for (const u of members[f]) members[target].push(u);
      members[f] = [];
      sideNames[target].push(fProduct[f].name, ...sideNames[f]);
      sideNames[f] = [];
      changed = true;
      break;
    }
    if (!changed) break;
  }

  // Merge folded factories' vectors, then the final home and shares.
  const finalVec: (Vec | null)[] = nodeVec.map((v) => {
    if (v === null) return null;
    let moved = false;
    for (const f of v.keys()) if (parent[f] !== f) moved = true;
    if (!moved) return v;
    const merged: Vec = new Map();
    for (const [f, x] of v) merged.set(rootOf(f), (merged.get(rootOf(f)) ?? 0) + x);
    return merged;
  });
  const home = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const v = finalVec[i];
    if (v !== null && v.size > 0) home[i] = homeOf(v);
  }

  // ---- factories: caps, names, keys ----
  const rootsAll: number[] = [];
  for (let f = 0; f < F; f++) if (parent[f] === f) rootsAll.push(f);
  const machineCount = Array.from({ length: F }, () => 0);
  for (let i = 0; i < n; i++) if (home[i] >= 0) machineCount[home[i]] += machinesIn(i);
  // Designated factories are never the ones dropped for the cap: they sort first.
  rootsAll.sort((a, b) => Number(desigF[b] !== undefined) - Number(desigF[a] !== undefined) || machineCount[b] - machineCount[a] || byString(fKey[a], fKey[b]));
  const roots = rootsAll.slice(0, PLANNER_MAX_FACTORIES);
  const dropped = rootsAll.length - roots.length;
  const kept = new Set(roots);

  const baseName = (f: number): string => {
    const own = seedsOf[f];
    const farm = own.every((s) => nodes[s].kind === "extractor");
    return `${fProduct[f].name.slice(0, NAME_MAX - 30)} ${farm ? "farm" : "factory"}`;
  };
  const nameOf = new Map<number, string>();
  {
    const seen = new Map<string, number>();
    for (const f of roots) {
      const d = desigF[f];
      if (d !== undefined) {
        nameOf.set(f, d.name.slice(0, NAME_MAX));
        continue;
      }
      const base = baseName(f);
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      nameOf.set(f, k === 1 ? base : `${base} ${k}`);
    }
  }

  // ---- annotations, shares, factory records ----
  const annotations = new Map<string, NodeAnnotation>();
  const nodesOf = new Map<number, number[]>();
  let sharedNodes = 0;
  let maxShareFactories = 1;
  let lowestTopShare = 1;
  for (let i = 0; i < n; i++) {
    const ann: NodeAnnotation = { collapseUnder: null };
    if (roles[i] !== undefined) ann.role = roles[i];
    const v = finalVec[i];
    const h = home[i];
    if (h >= 0 && kept.has(h) && v !== null) {
      ann.factoryKey = fKey[h];
      const list = nodesOf.get(h);
      if (list) list.push(i);
      else nodesOf.set(h, [i]);
      let top = 0;
      for (const x of v.values()) if (x > top) top = x;
      if (top < SHARED_BELOW) {
        const ranked = [...v.entries()]
          .filter(([f]) => kept.has(f))
          .sort((a, b) => b[1] - a[1] || byString(fKey[a[0]], fKey[b[0]]));
        const shown = ranked.slice(0, ranked.length > PLANNER_MAX_SHARES ? PLANNER_MAX_SHARES - 1 : ranked.length);
        const shares: PlannerShare[] = shown.map(([f, x]) => ({ factoryKey: fKey[f], share: Math.round(x * SHARE_DECIMALS) / SHARE_DECIMALS }));
        if (ranked.length > shown.length) {
          const rest = ranked.slice(shown.length).reduce((s, [, x]) => s + x, 0);
          shares.push({ factoryKey: OTHER_SHARE_KEY, share: Math.round(rest * SHARE_DECIMALS) / SHARE_DECIMALS });
        }
        if (shares.length > 0) {
          ann.shares = shares;
          sharedNodes++;
          maxShareFactories = Math.max(maxShareFactories, v.size);
          lowestTopShare = Math.min(lowestTopShare, top);
        }
      }
    }
    annotations.set(nodes[i].key, ann);
  }

  // ---- post-dominators per factory (Cooper, Harvey and Kennedy) ----
  const loc = new Int32Array(n).fill(-1);
  for (const f of roots) {
    const list = nodesOf.get(f) ?? [];
    const m = list.length;
    list.forEach((u, k) => (loc[u] = k));
    const EXIT = m;
    const isIn = (u: number): boolean => loc[u] >= 0 && home[u] === f;
    const succ: number[][] = list.map((u) => outS[u].map((a) => arcs[a].d).filter(isIn));
    const exits: number[] = [];
    const pred: number[][] = Array.from({ length: m }, () => []);
    list.forEach((u, k) => {
      for (const d of succ[k]) pred[loc[d]].push(k);
      // An exit: the product leaves the supply graph, or goes on to another factory (a shared supplier is never hidden by one consumer).
      if (isSeed[u] || succ[k].length !== outS[u].length || succ[k].length === 0 || outAll[u].some((a) => arcs[a].flow === "output")) exits.push(k);
    });
    // Reverse graph: EXIT -> exit nodes, v -> its forward predecessors. Iterative DFS for the reverse postorder.
    const rpo = new Int32Array(m + 1).fill(-1);
    const post: number[] = [];
    const seen = new Uint8Array(m + 1);
    seen[EXIT] = 1;
    const stack: { v: number; i: number }[] = [{ v: EXIT, i: 0 }];
    while (stack.length > 0) {
      const fr = stack[stack.length - 1];
      const nexts = fr.v === EXIT ? exits : pred[fr.v];
      if (fr.i < nexts.length) {
        const w = nexts[fr.i++];
        if (!seen[w]) {
          seen[w] = 1;
          stack.push({ v: w, i: 0 });
        }
        continue;
      }
      post.push(fr.v);
      stack.pop();
    }
    const order = post.reverse();
    order.forEach((v, k) => (rpo[v] = k));
    const idom = new Int32Array(m + 1).fill(-1);
    idom[EXIT] = EXIT;
    const intersect = (a0: number, b0: number): number => {
      let a = a0;
      let b = b0;
      while (a !== b) {
        while (rpo[a] > rpo[b]) a = idom[a];
        while (rpo[b] > rpo[a]) b = idom[b];
      }
      return a;
    };
    const isExit = new Uint8Array(m);
    for (const k of exits) isExit[k] = 1;
    let changed = true;
    while (changed) {
      changed = false;
      for (let k = 1; k < order.length; k++) {
        const b = order[k];
        // The predecessors of b in the reverse graph are its forward successors, and EXIT for an exit node.
        let ni = isExit[b] ? EXIT : -1;
        for (const p of succ[b]) {
          if (idom[loc[p]] === -1) continue;
          ni = ni === -1 ? loc[p] : intersect(loc[p], ni);
        }
        if (ni !== -1 && idom[b] !== ni) {
          idom[b] = ni;
          changed = true;
        }
      }
    }
    list.forEach((u, k) => {
      const d = idom[k];
      if (d >= 0 && d !== EXIT && rpo[k] >= 0) (annotations.get(nodes[u].key) as NodeAnnotation).collapseUnder = nodes[list[d]].key;
    });
    for (const u of list) loc[u] = -1;
  }

  // ---- factory records ----
  const factories: PlannerFactory[] = roots.map((f) => {
    const list = nodesOf.get(f) ?? [];
    const rates = new Map<string, { className: string; name: string; unit: PlannerRate["unit"]; cur: number; max: number }>();
    for (const s of seedsOf[f]) {
      const cls = (seedProduct.get(s) as { className: string }).className;
      const p = nodes[s].products.find((x) => x.className === cls);
      if (!p) continue;
      const acc = rates.get(cls);
      if (acc) {
        acc.cur += p.currentPerMinute;
        acc.max += p.maxPerMinute;
      } else rates.set(cls, { className: cls, name: p.name, unit: p.unit, cur: p.currentPerMinute, max: p.maxPerMinute });
    }
    const siteKeys = [...new Set(list.map((i) => nodes[i].siteKey))].filter((k) => k !== "depot").sort(byString);
    const own = nameOf.get(f) as string;
    const side = [...new Set(sideNames[f])].filter((nm) => nm !== fProduct[f].name).sort(byString).slice(0, PLANNER_MAX_SIDE_PRODUCTS);
    return {
      key: fKey[f],
      name: own,
      designationId: desigF[f]?.id ?? null,
      products: [...rates.values()]
        .sort((a, b) => b.max - a.max || byString(a.className, b.className))
        .slice(0, PLANNER_MAX_RATES)
        .map((a) => ({ className: a.className.slice(0, NAME_MAX), name: a.name.slice(0, NAME_MAX), unit: a.unit ?? null, currentPerMinute: r2(a.cur), maxPerMinute: r2(a.max) })),
      sideProducts: side.map((nm) => nm.slice(0, NAME_MAX)),
      nodeKeys: list.map((i) => nodes[i].key).sort(byString),
      siteKeys,
      machineCount: machineCount[f],
      sharedNodeCount: list.filter((i) => annotations.get(nodes[i].key)?.shares !== undefined).length,
    };
  });
  factories.sort((a, b) => b.machineCount - a.machineCount || byString(a.key, b.key));

  // ---- stats ----
  const comps = disjointSets(n);
  for (const a of arcs) if (!isDepotNode(a.s) && !isDepotNode(a.d)) comps.link(a.s, a.d);
  const perComponent = new Map<number, number>();
  for (const f of roots) {
    const first = (nodesOf.get(f) ?? [])[0];
    if (first === undefined) continue;
    const c = comps.find(first);
    perComponent.set(c, (perComponent.get(c) ?? 0) + 1);
  }
  let unassignedGroups = 0;
  for (let i = 0; i < n; i++) if (isMachine(i) && (home[i] < 0 || !kept.has(home[i]))) unassignedGroups++;
  const stats: ReductionStats = {
    seeds: seedList.length,
    factories: factories.length,
    components: perComponent.size,
    factoriesPerComponent: [...perComponent.values()].sort((a, b) => b - a).slice(0, 20),
    sharedNodes,
    maxShareFactories,
    lowestTopShare: Math.round(lowestTopShare * SHARE_DECIMALS) / SHARE_DECIMALS,
    largestFactoryMachines: factories.reduce((m, f) => Math.max(m, f.machineCount), 0),
    unassignedGroups,
    droppedFactories: dropped,
  };

  return { annotations, factories, topologyHash: topologyHash(nodes, arcs), stats };
}

/** A hash of everything the reduction reads and nothing it does not: no current rate, state or machine id. */
function topologyHash(nodes: readonly PlannerNode[], arcs: readonly Arc[]): string {
  const rates = (list: readonly PlannerRate[]): string =>
    list
      .map((r) => `${r.className}=${r.maxPerMinute}`)
      .sort(byString)
      .join(",");
  const parts: string[] = [];
  for (const nd of nodes) {
    parts.push(
      [nd.key, nd.kind, nd.className, nd.recipe ?? "", nd.count, nd.siteKey, nd.role ?? "", nd.resource?.className ?? "", nd.at.x, nd.at.y, rates(nd.products), rates(nd.ingredients)].join("\u0001"),
    );
  }
  parts.push("--");
  for (const a of arcs) parts.push(`${a.s}\u0001${a.d}\u0001${a.item ?? ""}\u0001${a.tag}\u0001${a.flow}\u0001${a.destination}`);
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}
