import { byString, disjointSets } from "./connectionGraph.js";

/**
 * Flow classes, destinations and source trees for the production planner (ADR-0053 Decisions 1 and 3, ADR-0055
 * Decision 3; ADR-0055 PR 3). Pure and deterministic: no I/O, no clock, no randomness, and nothing here reads a rate, so
 * a change of current rates alone never changes a flow, a destination or a tree. Groups and arcs are passed by index in
 * the caller's (already deterministic) order.
 */

export type PlannerFlow = "supply" | "excess" | "output";
export type PlannerDestination = "factory" | "storage" | "depot" | "sink" | "power" | "export" | "unknown";

/** ADR-0053 Decision 1, Question 1: recipes treated as terminals for gluing. Empty: the owner named the AWESOME Sink as
 *  the recycler (2026-10-24, ADR-0055 Decision 3), and the sink is already a terminal. */
export const TERMINAL_RECIPES: ReadonlySet<string> = new Set<string>();

/** The AWESOME Sink: the recycler and excess terminal. */
export const SINK_CLASS = "Build_ResourceSink_C";
/** The Dimensional Depot uploader: a storage end that never passes items on. */
export const DEPOT_CLASS = "Build_CentralStorage_C";
const GENERATOR = /^Build_Generator/;

export interface FlowGroup {
  /** `PlannerNode.kind`: machines, extractor, storage, station, consumer or other. */
  kind: string;
  /** The building class of every unit in the group (from the snapshot, else the conveyor end id), or null if they differ. */
  buildClass: string | null;
  recipe: string | null;
  /** Ingredient classes the group reports; empty = no data. */
  ingredients: ReadonlySet<string>;
}

export interface FlowArc {
  s: number;
  d: number;
  /** The item's class, or null when it could not be inferred. */
  item: string | null;
}

const isMachine = (g: FlowGroup): boolean => g.kind === "machines";
const isDepot = (g: FlowGroup): boolean => g.buildClass === DEPOT_CLASS;
/** Kinds that may hold and pass items on (a buffer); a consumer, an extractor or the depot never does. */
const mayBuffer = (g: FlowGroup): boolean => (g.kind === "storage" || g.kind === "station" || g.kind === "other") && !isDepot(g);
/** Two items match unless both are known and differ: an unknown item may be the one in question. */
const sameOrUnknown = (a: string | null, b: string | null): boolean => a === null || b === null || a === b;
const itemKey = (x: string | null): string => (x === null ? "\u0000" : x);

function outArcs(n: number, arcs: readonly FlowArc[]): number[][] {
  const out: number[][] = Array.from({ length: n }, () => []);
  arcs.forEach((a, i) => out[a.s].push(i));
  return out;
}

/**
 * ADR-0053 Decision 1. `supply`: the destination is a machine group that uses the item (or reports no ingredients, or the
 * item is unknown), or a buffer: a storage, station or `other` node with an outgoing edge that may carry the item, other
 * than straight back to the source (a pipe is an arc each way, so a tank on a producer's pipe would otherwise look like a
 * buffer). Otherwise the destination is a terminal for this item, and the edge is `excess` when the source also supplies
 * the same item (null matching null) somewhere, else `output`.
 */
export function classifyFlows(groups: readonly FlowGroup[], arcs: readonly FlowArc[]): PlannerFlow[] {
  const out = outArcs(groups.length, arcs);
  const supply = arcs.map((a) => {
    const d = groups[a.d];
    if (isMachine(d)) {
      if (d.recipe !== null && TERMINAL_RECIPES.has(d.recipe)) return false;
      return a.item === null || d.ingredients.size === 0 || d.ingredients.has(a.item);
    }
    if (!mayBuffer(d)) return false;
    return out[a.d].some((j) => arcs[j].d !== a.s && sameOrUnknown(arcs[j].item, a.item));
  });
  const supplies = new Set<string>();
  arcs.forEach((a, i) => {
    if (supply[i]) supplies.add(`${a.s}|${itemKey(a.item)}`);
  });
  return arcs.map((a, i) => (supply[i] ? "supply" : supplies.has(`${a.s}|${itemKey(a.item)}`) ? "excess" : "output"));
}

/**
 * ADR-0055 Decision 3: where each edge's flow ends, on its destination node. `factory`: a machine group, or a supply into
 * a buffer that reaches a machine group over supply edges (through storage, stations or `other`); otherwise by the
 * destination: the depot uploader, the sink, a generator (`power`), a terminal container or tank (`storage`), a station
 * whose route is not read (`export`), and `unknown` for `other`, extractors and the rest.
 */
export function classifyDestinations(groups: readonly FlowGroup[], arcs: readonly FlowArc[], flows: readonly PlannerFlow[]): PlannerDestination[] {
  const n = groups.length;
  const supIn: number[][] = Array.from({ length: n }, () => []);
  arcs.forEach((a, i) => {
    if (flows[i] === "supply") supIn[a.d].push(a.s);
  });
  // Nodes that feed a factory: machines, and buffers reaching one over supply edges (reverse BFS from the machines).
  const feeds = groups.map(isMachine);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (feeds[i]) queue.push(i);
  for (let qi = 0; qi < queue.length; qi++) {
    for (const s of supIn[queue[qi]]) {
      if (feeds[s] || !mayBuffer(groups[s])) continue;
      feeds[s] = true;
      queue.push(s);
    }
  }
  return arcs.map((a, i) => {
    const d = groups[a.d];
    if (isMachine(d)) return "factory";
    if (isDepot(d)) return "depot";
    if (d.buildClass === SINK_CLASS) return "sink";
    if (d.kind === "consumer") return d.buildClass !== null && GENERATOR.test(d.buildClass) ? "power" : "unknown";
    if (flows[i] === "supply" && feeds[a.d] && (d.kind === "storage" || d.kind === "station")) return "factory";
    if (d.kind === "storage") return "storage";
    if (d.kind === "station") return "export";
    return "unknown";
  });
}

export interface TreeGroup extends FlowGroup {
  key: string;
  siteKey: string;
  className: string;
}

/**
 * ADR-0053 Decision 3: each group's bubble, recipe x source tree. For a machine group, its upstream closure is every
 * machine group reachable backwards over supply edges, passing through buffers (non-machines with a supply input) but
 * never entering a raw source (an extractor, or a non-machine with no supply input). Groups of one recipe (kind, class,
 * recipe) whose closures share a machine group are one bubble, by union-find; a loop's same-recipe groups always are.
 * Per recipe, starts in key order each walk backwards marking what they reach; reaching a node an earlier start marked
 * joins the two when that node is a machine or a buffer with a machine upstream, and stops (its upstream is marked
 * already). O(R x (V + E)). Non-machine bubbles: by site, kind, building class and the items they receive (an extractor:
 * the items it sends; a node receiving nothing: what it sends). The key is `tree|` plus the bubble's lowest group key.
 */
export function sourceTrees(groups: readonly TreeGroup[], arcs: readonly FlowArc[], flows: readonly PlannerFlow[]): string[] {
  const n = groups.length;
  const supIn: number[][] = Array.from({ length: n }, () => []);
  arcs.forEach((a, i) => {
    if (flows[i] === "supply" && a.s !== a.d) supIn[a.d].push(a.s);
  });
  for (const list of supIn) list.sort((a, b) => a - b);
  const machine = groups.map(isMachine);
  const buffer = groups.map((g, i) => !machine[i] && supIn[i].length > 0);
  // A buffer has a machine upstream when a machine reaches it forward over supply edges through buffers.
  const supOut: number[][] = Array.from({ length: n }, () => []);
  for (let d = 0; d < n; d++) for (const s of supIn[d]) supOut[s].push(d);
  const machineUp = Array.from({ length: n }, () => false);
  const queue: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!machine[s]) continue;
    for (const d of supOut[s]) {
      if (buffer[d] && !machineUp[d]) {
        machineUp[d] = true;
        queue.push(d);
      }
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    for (const d of supOut[queue[qi]]) {
      if (buffer[d] && !machineUp[d]) {
        machineUp[d] = true;
        queue.push(d);
      }
    }
  }

  const byKey = (a: number, b: number): number => byString(groups[a].key, groups[b].key) || a - b;
  const recipes = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (!machine[i]) continue;
    const g = groups[i];
    const rk = `${g.kind}\u0000${g.className}\u0000${g.recipe ?? "\u0001"}`;
    const list = recipes.get(rk);
    if (list) list.push(i);
    else recipes.set(rk, [i]);
  }
  const sets = disjointSets(n);
  const markPass = new Int32Array(n).fill(-1);
  const markStart = new Int32Array(n).fill(-1);
  let pass = 0;
  for (const rk of [...recipes.keys()].sort(byString)) {
    const starts = (recipes.get(rk) as number[]).sort(byKey);
    if (starts.length > 1) {
      for (const st of starts) {
        if (markPass[st] === pass) {
          // Inside an earlier start's closure: the two closures share this very group.
          sets.link(st, markStart[st]);
          continue;
        }
        markPass[st] = pass;
        markStart[st] = st;
        const stack = [st];
        while (stack.length > 0) {
          const v = stack.pop() as number;
          for (const u of supIn[v]) {
            if (!machine[u] && !buffer[u]) continue; // a raw source is a shared input, never a factory
            if (markPass[u] === pass) {
              if (markStart[u] !== st && (machine[u] || machineUp[u])) sets.link(st, markStart[u]);
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

  // Non-machine bubbles.
  const inItems: (string | null)[][] = Array.from({ length: n }, () => []);
  const outItems: (string | null)[][] = Array.from({ length: n }, () => []);
  for (const a of arcs) {
    inItems[a.d].push(a.item);
    outItems[a.s].push(a.item);
  }
  const sig = (list: (string | null)[]): string => [...new Set(list.map((x) => x ?? "?"))].sort(byString).join(",");
  const bucket = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (machine[i]) continue;
    const g = groups[i];
    const items = g.kind === "extractor" || inItems[i].length === 0 ? sig(outItems[i]) : sig(inItems[i]);
    const bk = `${g.siteKey}\u0000${g.kind}\u0000${g.buildClass ?? g.className}\u0000${items}`;
    const first = bucket.get(bk);
    if (first === undefined) bucket.set(bk, i);
    else sets.link(i, first);
  }

  const lowest = new Map<number, string>();
  for (let i = 0; i < n; i++) {
    const r = sets.find(i);
    const k = lowest.get(r);
    if (k === undefined || byString(groups[i].key, k) < 0) lowest.set(r, groups[i].key);
  }
  return groups.map((_, i) => `tree|${lowest.get(sets.find(i)) as string}`);
}
