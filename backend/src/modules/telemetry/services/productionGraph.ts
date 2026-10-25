import {
  PLANNER_MAX_EDGES,
  PLANNER_MAX_MACHINE_IDS,
  PLANNER_MAX_NODES,
  PLANNER_MAX_RATES,
  PLANNER_MAX_SITES,
  type BottleneckNote,
  type ConveyorNodeKind,
  type FactoryBuilding,
  type PlannerEdge,
  type PlannerNode,
  type PlannerRate,
  type PlannerSite,
  type ProductionGraph,
  type ProductionRate,
} from "@satisfactory-dash/shared";
import { CONNECTIONS_REFRESH_MINUTES, type BottleneckEdges } from "./bottleneckFinder.js";
import {
  TERMINAL_KINDS,
  buildGraph,
  byString,
  disjointSets,
  passThroughComponents,
  usable,
  weaklyConnectedComponents,
  type Arc,
  type Filter,
} from "./connectionGraph.js";
import { classifyDestinations, classifyFlows, sourceTrees, type FlowArc, type TreeGroup } from "./plannerFlows.js";

/**
 * The production planner's graph (ADR-0050, Decisions 1, 2 and 8): the whole factory as a coarse graph of machine groups,
 * a pure, deterministic function of one factory snapshot's buildings and one read of the conveyors layer. No I/O, no
 * clock, no randomness; the same input gives byte-identical output. Conveyor ids and node numbers are valid only within
 * the one read (G-B1), so nothing here keeps one. Output parses with `ProductionGraphSchema`.
 *
 * Steps: the finder's connection graph; units (one per terminal node); groups (same kind, class, recipe and feeding
 * pass-through component); edges between groups with an inferred item and a rate that says how sure it is; loops
 * (iterative Tarjan); sites (weakly connected components merged within `SITE_MERGE_DISTANCE_M`). ADR-0055 PR 3 adds
 * each edge's `flow` and `destination` and each node's `treeKey` (`plannerFlows.ts`); sites are unchanged (ADR-0055
 * replaces ADR-0053 Decision 2 with the factory reduction).
 */

/** Decision 8: components whose machines' bounding boxes are within this many metres are one site. A starting value, to be
 *  tuned on the owner's save with `ProductionGraphStats`. */
export const SITE_MERGE_DISTANCE_M = 150;
/** Decision 1: a node's key snaps its centroid to this grid (metres). */
export const KEY_GRID_M = 50;

const COORD_MAX = 1_000_000;
/** Candidate (source group, destination group, item) triples kept before the rest are dropped with a note. */
const MAX_CANDIDATES = PLANNER_MAX_EDGES * 2;
/** Source-by-destination pairs examined across all links; a guard against a pathological merger of thousands of groups. */
const MAX_PAIRS = 5_000_000;
const KEY_PART_MAX = 80;

export interface ProductionGraphStats {
  /** Weakly connected components of the connection graph that hold at least one group. */
  components: number;
  sites: number;
  groups: number;
  links: number;
}

export interface ProductionGraphResult {
  graph: ProductionGraph;
  stats: ProductionGraphStats;
}

interface Point {
  x: number;
  y: number;
}

const KIND_NAMES: ReadonlyMap<ConveyorNodeKind, string> = new Map([
  ["machine", "machines"],
  ["extractor", "extractor"],
  ["storage", "storage"],
  ["station", "station"],
  ["consumer", "consumer"],
]);
const kindName = (k: ConveyorNodeKind): string => KIND_NAMES.get(k) ?? "other";

/** Two decimals, and always a finite, non-negative number the contract accepts (a sum of huge rates can overflow). */
const r2 = (n: number): number => {
  if (Number.isNaN(n) || n <= 0) return 0;
  if (!Number.isFinite(n)) return Number.MAX_VALUE;
  return n >= 1e15 ? n : Math.round(n * 100) / 100;
};
/** A state is a record key in the contract (40 characters at most). */
const STATE_MAX = 40;
const snap = (v: number): number => Math.round(v / KEY_GRID_M) * KEY_GRID_M || 0;
const whole = (v: number): number => Math.round(v) || 0;

function filterOf(unit: ProductionRate["unit"]): Filter {
  return unit === "m3/min" ? "fluid" : unit === "items/min" ? "solid" : "any";
}

function positionOf(b: FactoryBuilding | null): Point | null {
  const loc = b?.location;
  if (!loc || !Number.isFinite(loc.xM) || !Number.isFinite(loc.yM)) return null;
  if (Math.abs(loc.xM) > COORD_MAX || Math.abs(loc.yM) > COORD_MAX) return null;
  return { x: loc.xM, y: loc.yM };
}

/** A running sum of one item's rate over a group. */
interface Acc {
  className: string;
  name: string;
  unit: ProductionRate["unit"];
  cur: number;
  max: number;
}

function addRates(into: Map<string, Acc>, rates: readonly ProductionRate[] | undefined): void {
  for (const r of rates ?? []) {
    const acc = into.get(r.className);
    if (acc) {
      acc.cur += r.currentPerMinute;
      acc.max += r.maxPerMinute;
      if (acc.unit === undefined || acc.unit === null) acc.unit = r.unit;
    } else {
      into.set(r.className, { className: r.className, name: r.name, unit: r.unit, cur: r.currentPerMinute, max: r.maxPerMinute });
    }
  }
}

function toRates(from: ReadonlyMap<string, Acc>): PlannerRate[] {
  return [...from.values()]
    .sort((a, b) => b.max - a.max || byString(a.className, b.className))
    .slice(0, PLANNER_MAX_RATES)
    .map((a) => ({ className: a.className.slice(0, 200), name: a.name.slice(0, 200), unit: a.unit ?? null, currentPerMinute: r2(a.cur), maxPerMinute: r2(a.max) }));
}

interface Unit {
  node: number;
  /** The building's id, or the conveyor-end id of a node the factory snapshot has no building for. */
  id: string;
  building: FactoryBuilding | null;
  pos: Point | null;
}

interface Group {
  idx: number;
  node: number | null;
  kind: string;
  className: string;
  name: string;
  recipe: string | null;
  units: Unit[];
  /** Building ids only, ascending. */
  ids: string[];
  stateCounts: Record<string, number>;
  prod: Map<string, Acc>;
  ing: Map<string, Acc>;
  posSum: Point;
  posN: number;
  box: { minX: number; minY: number; maxX: number; maxY: number } | null;
  key: string;
  siteKey: string;
  loop: boolean;
}

/** A place flow passes between terminals: a pass-through component, or one conveyor joining two terminals directly. */
interface Link {
  ins: number[];
  outs: number[];
  arcs: Arc[];
  /** Exactly one terminal each side and no branching in between. */
  chain: boolean;
  mixed: boolean;
  solid: boolean;
  fluid: boolean;
  conveyorIds: Set<string>;
}

const carries = (link: Link, f: Filter): boolean => (f === "any" ? link.arcs.length > 0 : f === "solid" ? link.solid : link.fluid);

interface Cand {
  s: number;
  d: number;
  kind: "belt" | "pipe";
  item: { className: string; name: string } | null;
  inferred: boolean;
  mixed: boolean;
  /** The links this edge passes through, by reference: copying every link's conveyor ids into each candidate of a large
   *  merger (groups in x groups out, thousands of conveyors) exhausted memory. */
  links: Link[];
  chains: number[];
  linkCount: number;
}

function emptyGraph(beltData: ProductionGraph["beltData"], notes: BottleneckNote[]): ProductionGraphResult {
  return {
    graph: { nodes: [], edges: [], sites: [], unconnectedMachineIds: [], beltData, connectionsRefreshMinutes: CONNECTIONS_REFRESH_MINUTES, notes },
    stats: { components: 0, sites: 0, groups: 0, links: 0 },
  };
}

/** The planner's graph for one snapshot. `edges` is the conveyors layer of one read, or why it is missing. */
export function buildProductionGraph(buildings: readonly FactoryBuilding[], edges: BottleneckEdges): ProductionGraph {
  return buildProductionGraphWithStats(buildings, edges).graph;
}

/** As `buildProductionGraph`, plus component, site and group counts (to tune `SITE_MERGE_DISTANCE_M` on a real save). */
export function buildProductionGraphWithStats(buildings: readonly FactoryBuilding[], edges: BottleneckEdges): ProductionGraphResult {
  if (edges === "unsupported") {
    return emptyGraph("unsupported", [{ code: "updateFrm", text: "No production graph; update FRM to 1.5.4 or newer for belt detail." }]);
  }
  if (edges === "tooLarge") {
    return emptyGraph("tooLarge", [{ code: "beltDataTooLarge", text: "No production graph; the belt and pipe data is too large to use on this save." }]);
  }

  const sorted = [...buildings].sort((a, b) => byString(a.id, b.id));
  const byId = new Map<string, FactoryBuilding>();
  for (const b of sorted) if (!byId.has(b.id)) byId.set(b.id, b);
  const g = buildGraph(edges);
  const nodeCount = g.kind.length;
  const notes: BottleneckNote[] = [];
  let truncated = false;

  // ---- units: one per terminal node; the lowest building id on a node wins (a node with two is not expected) ----
  const idsOf = new Map<number, string[]>();
  for (const [id, n] of g.idToNode) {
    const list = idsOf.get(n);
    if (list) list.push(id);
    else idsOf.set(n, [id]);
  }
  const comps = passThroughComponents(g);
  const compOf = new Int32Array(nodeCount).fill(-1);
  comps.forEach((c, ci) => c.nodes.forEach((n) => (compOf[n] = ci)));
  const wcc = weaklyConnectedComponents(g);
  const wccOf = new Int32Array(nodeCount);
  wcc.forEach((members, wi) => members.forEach((n) => (wccOf[n] = wi)));

  const unitOf = new Map<number, Unit>();
  for (let n = 0; n < nodeCount; n++) {
    if (!TERMINAL_KINDS.has(g.kind[n])) continue;
    const ids = idsOf.get(n);
    if (!ids) continue;
    ids.sort(byString);
    const found = ids.find((id) => byId.has(id));
    const building = found === undefined ? null : (byId.get(found) as FactoryBuilding);
    // A building the snapshot lacks has no position of its own: borrow the nearest conveyor's end 0.
    const near = g.out[n][0] ?? g.in[n][0];
    unitOf.set(n, { node: n, id: found ?? ids[0], building, pos: positionOf(building) ?? (near ? { x: near.edge.at.x, y: near.edge.at.y } : null) });
  }

  // ---- groups ----
  const signature = (n: number): string => {
    const tokens = (arcs: Arc[], far: (a: Arc) => number): string =>
      [...new Set(arcs.map((a) => (compOf[far(a)] >= 0 ? `c${compOf[far(a)]}` : `t${far(a)}`)))].sort(byString).join(",");
    const ins = tokens(g.in[n], (a) => a.from);
    const outs = tokens(g.out[n], (a) => a.to);
    const wantOut = g.kind[n] === "extractor";
    if (wantOut && outs !== "") return `o:${outs}`;
    if (ins !== "") return `i:${ins}`;
    if (outs !== "") return `o:${outs}`;
    return `w:${wccOf[n]}`;
  };

  const byKey = new Map<string, Group>();
  for (const unit of [...unitOf.values()].sort((a, b) => byString(a.id, b.id))) {
    const b = unit.building;
    const kind = kindName(g.kind[unit.node]);
    // A node with no building is "other", never a guessed machine; its class is its kind.
    const className = b ? b.className : g.kind[unit.node];
    const recipe = b ? b.recipe : null;
    const gk = `${kind}\0${className}\0${recipe ?? "\u0001"}\0${signature(unit.node)}`;
    let grp = byKey.get(gk);
    if (!grp) {
      grp = {
        idx: -1,
        node: null,
        kind: b || kind !== "machines" ? kind : "other",
        className,
        name: b ? b.name : g.kind[unit.node],
        recipe,
        units: [],
        ids: [],
        stateCounts: Object.create(null) as Record<string, number>,
        prod: new Map(),
        ing: new Map(),
        posSum: { x: 0, y: 0 },
        posN: 0,
        box: null,
        key: "",
        siteKey: "",
        loop: false,
      };
      byKey.set(gk, grp);
    }
    grp.units.push(unit);
    if (b) {
      grp.ids.push(b.id);
      if (b.state !== undefined) {
        const st = b.state.slice(0, STATE_MAX);
        grp.stateCounts[st] = (grp.stateCounts[st] ?? 0) + 1;
      }
      addRates(grp.prod, b.production);
      addRates(grp.ing, b.ingredients);
    }
    if (unit.pos) {
      grp.posSum.x += unit.pos.x;
      grp.posSum.y += unit.pos.y;
      grp.posN++;
      const bx = grp.box;
      if (bx) {
        bx.minX = Math.min(bx.minX, unit.pos.x);
        bx.maxX = Math.max(bx.maxX, unit.pos.x);
        bx.minY = Math.min(bx.minY, unit.pos.y);
        bx.maxY = Math.max(bx.maxY, unit.pos.y);
      } else grp.box = { minX: unit.pos.x, minY: unit.pos.y, maxX: unit.pos.x, maxY: unit.pos.y };
    }
  }
  // Groups ordered by their lowest member id (units were added in id order), which fixes ordinals and every later order.
  const groups = [...byKey.values()];
  groups.sort((a, b) => byString(a.units[0].id, b.units[0].id));
  const groupOfNode = new Map<number, number>();
  groups.forEach((grp, i) => {
    grp.idx = i;
    grp.node = grp.units[0].node;
    for (const u of grp.units) groupOfNode.set(u.node, i);
  });

  const keyCount = new Map<string, number>();
  for (const grp of groups) {
    const cx = grp.posN > 0 ? grp.posSum.x / grp.posN : 0;
    const cy = grp.posN > 0 ? grp.posSum.y / grp.posN : 0;
    const base = `${grp.className.slice(0, KEY_PART_MAX)}|${(grp.recipe ?? "").slice(0, KEY_PART_MAX)}|${snap(cx)}|${snap(cy)}`;
    const seen = (keyCount.get(base) ?? 0) + 1;
    keyCount.set(base, seen);
    grp.key = seen === 1 ? base : `${base}#${seen}`;
  }

  // ---- links ----
  const links: Link[] = [];
  const groupsOf = (nodes: number[]): number[] => [...new Set(nodes.flatMap((n) => groupOfNode.get(n) ?? []))].sort((a, b) => a - b);
  const finishLink = (ins: number[], outs: number[], arcs: Arc[], chain: boolean, comp: boolean): void => {
    const solidItems = new Set<string>();
    const si = groupsOf(ins);
    if (comp) for (const gi of si) for (const acc of groups[gi].prod.values()) if (acc.unit !== "m3/min") solidItems.add(acc.className);
    links.push({
      ins: si,
      outs: groupsOf(outs),
      arcs,
      chain,
      mixed: solidItems.size >= 2,
      solid: arcs.some((a) => usable(a, "solid")),
      fluid: arcs.some((a) => usable(a, "fluid")),
      conveyorIds: new Set(arcs.map((a) => a.edge.id)),
    });
  };
  for (const c of comps) {
    const arcs = new Set<Arc>();
    let branched = false;
    for (const n of c.nodes) {
      for (const a of g.in[n]) arcs.add(a);
      for (const a of g.out[n]) arcs.add(a);
      if (g.in[n].length > 1 || g.out[n].length > 1) branched = true;
    }
    finishLink(c.ins, c.outs, [...arcs], !branched && c.ins.length === 1 && c.outs.length === 1, true);
  }
  for (let n = 0; n < nodeCount; n++) {
    if (!TERMINAL_KINDS.has(g.kind[n])) continue;
    for (const a of g.out[n]) if (TERMINAL_KINDS.has(g.kind[a.to])) finishLink([n], [a.to], [a], true, false);
  }

  // ---- candidate edges: item per group pair (Decision 2) ----
  const cands = new Map<string, Cand>();
  let unmatched = 0;
  let pairs = 0;
  const addCand = (link: Link, s: number, d: number, item: Cand["item"], unit: ProductionRate["unit"], inferred: boolean): void => {
    const kind: "belt" | "pipe" = item === null ? (link.solid ? "belt" : "pipe") : unit === "m3/min" ? "pipe" : "belt";
    const key = `${s}|${d}|${kind}|${item?.className ?? ""}`;
    let c = cands.get(key);
    if (!c) {
      if (cands.size >= MAX_CANDIDATES) {
        truncated = true;
        return;
      }
      c = { s, d, kind, item, inferred, mixed: false, links: [], chains: [], linkCount: 0 };
      cands.set(key, c);
    }
    c.mixed ||= link.mixed;
    c.inferred ||= inferred;
    c.links.push(link);
    c.linkCount++;
    if (link.chain && link.arcs.length > 0) c.chains.push(Math.min(...link.arcs.map((a) => a.cap)));
  };

  links.forEach((link) => {
    for (const s of link.ins) {
      const src = groups[s];
      for (const d of link.outs) {
        if (s === d) continue;
        if (++pairs > MAX_PAIRS) {
          truncated = true;
          return;
        }
        const dst = groups[d];
        const sData = src.prod.size > 0;
        const dData = dst.ing.size > 0;
        // A pipe has no direction, so each pair is tried both ways: a pure consumer is not a source, a pure producer not a sink.
        if (!link.solid && ((!sData && src.ing.size > 0) || (!dData && dst.prod.size > 0))) continue;
        if (sData && dData) {
          let found = false;
          for (const p of src.prod.values()) {
            if (!dst.ing.has(p.className) || !carries(link, filterOf(p.unit))) continue;
            found = true;
            addCand(link, s, d, { className: p.className, name: p.name }, p.unit, false);
          }
          if (!found) unmatched++;
        } else if (sData) {
          // A destination with no ingredient data (storage, a station, a sink) takes whatever the belt can carry.
          const fits = [...src.prod.values()].filter((p) => carries(link, filterOf(p.unit)));
          if (fits.length === 1) addCand(link, s, d, { className: fits[0].className, name: fits[0].name }, fits[0].unit, false);
          else if (fits.length > 1) addCand(link, s, d, null, null, false);
          else unmatched++;
        } else if (dData && src.kind === "extractor") {
          // An extractor's item: what its destination needs that no other producer on the same link supplies.
          const others = new Set<string>();
          for (const o of link.ins) if (o !== s && o !== d) for (const k of groups[o].prod.keys()) others.add(k);
          const need = [...dst.ing.values()].filter((i) => carries(link, filterOf(i.unit)) && !others.has(i.className));
          if (need.length === 1) addCand(link, s, d, { className: need[0].className, name: need[0].name }, need[0].unit, true);
          else addCand(link, s, d, null, null, false);
        } else {
          addCand(link, s, d, null, null, false);
        }
      }
    }
  });

  // ---- flow classes and destinations (ADR-0053 Decision 1, ADR-0055 Decision 3): topology and items only, no rates ----
  const candList = [...cands.values()];
  const flowGroups: TreeGroup[] = groups.map((grp) => {
    const classes = new Set(grp.units.map((u) => (u.building ? u.building.className : u.id.replace(/_\d+$/, ""))));
    return {
      key: grp.key,
      siteKey: "",
      kind: grp.kind,
      className: grp.className,
      buildClass: classes.size === 1 ? (classes.values().next().value as string) : null,
      recipe: grp.recipe,
      ingredients: new Set(grp.ing.keys()),
    };
  });
  const flowArcs: FlowArc[] = candList.map((c) => ({ s: c.s, d: c.d, item: c.item?.className ?? null }));
  const flows = classifyFlows(flowGroups, flowArcs);
  const destinations = classifyDestinations(flowGroups, flowArcs, flows);

  // ---- rates (flow balance) ----
  const byDest = new Map<string, Cand[]>();
  const destsOfSource = new Map<string, Set<number>>();
  for (const c of cands.values()) {
    if (c.item === null) continue;
    const dk = `${c.d}|${c.item.className}`;
    const list = byDest.get(dk);
    if (list) list.push(c);
    else byDest.set(dk, [c]);
    const sk = `${c.s}|${c.item.className}`;
    const set = destsOfSource.get(sk);
    if (set) set.add(c.d);
    else destsOfSource.set(sk, new Set([c.d]));
  }

  const rates: { ratePerMinute: number | null; rate: PlannerEdge["rate"] }[] = [];
  for (const c of candList) {
    let ratePerMinute: number | null = null;
    let rate: PlannerEdge["rate"] = "unknown";
    if (c.item !== null) {
      const item = c.item.className;
      const dst = groups[c.d];
      const consumed = dst.ing.get(item);
      const sources = byDest.get(`${c.d}|${item}`) as Cand[];
      const downgrade = c.mixed || c.inferred;
      if (consumed) {
        if (sources.length === 1) {
          ratePerMinute = consumed.cur;
          rate = downgrade ? "estimated" : "measured";
        } else {
          let total = 0;
          for (const o of sources) total += groups[o.s].prod.get(item)?.cur ?? 0;
          const mine = groups[c.s].prod.get(item)?.cur ?? 0;
          if (total > 0) {
            ratePerMinute = (consumed.cur * mine) / total;
            rate = "estimated";
          } else if (consumed.cur === 0) {
            ratePerMinute = 0;
            rate = "estimated";
          }
        }
      } else {
        // The destination reports no use of the item (a sink): the source's output is all that is known, and only the
        // whole of it when this is its single destination.
        const out = groups[c.s].prod.get(item);
        if (out && (destsOfSource.get(`${c.s}|${item}`)?.size ?? 0) === 1) {
          ratePerMinute = out.cur;
          rate = "estimated";
        }
      }
    }
    rates.push({ ratePerMinute, rate });
  }
  // Excess rate (ADR-0053 Decision 1): the source's output of the item minus its supply edges for it, when every one has
  // a number and this is its single excess destination for the item; estimated, never measured.
  const supplyOf = new Map<string, number[]>();
  const excessOf = new Map<string, number>();
  candList.forEach((c, i) => {
    if (c.item === null) return;
    const sk = `${c.s}|${c.item.className}`;
    if (flows[i] === "supply") {
      const list = supplyOf.get(sk);
      if (list) list.push(i);
      else supplyOf.set(sk, [i]);
    } else if (flows[i] === "excess") excessOf.set(sk, (excessOf.get(sk) ?? 0) + 1);
  });
  candList.forEach((c, i) => {
    if (flows[i] !== "excess" || c.item === null || rates[i].ratePerMinute !== null) return;
    const sk = `${c.s}|${c.item.className}`;
    const out = groups[c.s].prod.get(c.item.className);
    const sup = supplyOf.get(sk) ?? [];
    if (!out || excessOf.get(sk) !== 1 || sup.some((j) => rates[j].ratePerMinute === null)) return;
    let used = 0;
    for (const j of sup) used += rates[j].ratePerMinute as number;
    rates[i] = { ratePerMinute: Math.max(0, out.cur - used), rate: "estimated" };
  });

  const outEdges: PlannerEdge[] = [];
  candList.forEach((c, i) => {
    const { ratePerMinute, rate } = rates[i];
    const chain = c.linkCount === 1 && c.chains.length === 1 && Number.isFinite(c.chains[0]) ? c.chains[0] : null;
    outEdges.push({
      from: groups[c.s].key,
      to: groups[c.d].key,
      kind: c.kind,
      itemClassName: c.item ? c.item.className.slice(0, 200) : null,
      itemName: c.item ? c.item.name.slice(0, 200) : null,
      ratePerMinute: ratePerMinute === null ? null : r2(ratePerMinute),
      rate,
      mixed: c.mixed,
      capacityPerMinute: chain,
      conveyorCount: c.links.length === 1 ? c.links[0].conveyorIds.size : new Set(c.links.flatMap((l) => [...l.conveyorIds])).size,
      flow: flows[i],
      destination: destinations[i],
    });
  });
  outEdges.sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to) || byString(a.itemClassName ?? "", b.itemClassName ?? "") || byString(a.kind, b.kind));

  // ---- loops: strongly connected components of the group graph ----
  const adj: number[][] = groups.map(() => []);
  for (const c of cands.values()) adj[c.s].push(c.d);
  for (const list of adj) list.sort((a, b) => a - b);
  const scc = stronglyConnected(adj);
  const sccSize = new Map<number, number>();
  for (const c of scc.comp) sccSize.set(c, (sccSize.get(c) ?? 0) + 1);
  for (const grp of groups) grp.loop = (sccSize.get(scc.comp[grp.idx]) ?? 0) > 1;
  // Longest-path depth over the condensation (Tarjan emits sinks first), for the sites' default names.
  const depth = Array.from({ length: scc.count }, () => 0);
  for (let c = scc.count - 1; c >= 0; c--) {
    for (const v of scc.members[c]) for (const w of adj[v]) if (scc.comp[w] !== c) depth[scc.comp[w]] = Math.max(depth[scc.comp[w]], depth[c] + 1);
  }

  // ---- sites (Decision 8) ----
  const atomIdx = new Map<number, number>();
  const atoms: { groups: Group[]; box: Group["box"] }[] = [];
  for (const grp of groups) {
    const w = wccOf[grp.node as number];
    let ai = atomIdx.get(w);
    if (ai === undefined) {
      ai = atoms.length;
      atomIdx.set(w, ai);
      atoms.push({ groups: [], box: null });
    }
    const atom = atoms[ai];
    atom.groups.push(grp);
    if (grp.box) {
      if (!atom.box) atom.box = { ...grp.box };
      else {
        atom.box.minX = Math.min(atom.box.minX, grp.box.minX);
        atom.box.minY = Math.min(atom.box.minY, grp.box.minY);
        atom.box.maxX = Math.max(atom.box.maxX, grp.box.maxX);
        atom.box.maxY = Math.max(atom.box.maxY, grp.box.maxY);
      }
    }
  }
  const merge = disjointSets(atoms.length);
  const boxed = atoms.map((a, i) => ({ i, box: a.box })).filter((a): a is { i: number; box: NonNullable<Group["box"]> } => a.box !== null);
  boxed.sort((a, b) => a.box.minX - b.box.minX || a.i - b.i);
  for (let a = 0; a < boxed.length; a++) {
    const A = boxed[a].box;
    for (let b = a + 1; b < boxed.length; b++) {
      const B = boxed[b].box;
      const gapX = Math.max(0, B.minX - A.maxX);
      if (gapX > SITE_MERGE_DISTANCE_M) break;
      const gapY = Math.max(0, B.minY - A.maxY, A.minY - B.maxY);
      if (Math.hypot(gapX, gapY) <= SITE_MERGE_DISTANCE_M) merge.link(boxed[a].i, boxed[b].i);
    }
  }
  const siteGroups = new Map<number, Group[]>();
  atoms.forEach((atom, i) => {
    const root = merge.find(i);
    const list = siteGroups.get(root);
    if (list) list.push(...atom.groups);
    else siteGroups.set(root, [...atom.groups]);
  });
  const siteLists = [...siteGroups.values()].map((list) => list.sort((a, b) => a.idx - b.idx)).sort((a, b) => a[0].idx - b[0].idx);

  const outOf = new Map<number, Cand[]>();
  for (const c of cands.values()) {
    const list = outOf.get(c.s);
    if (list) list.push(c);
    else outOf.set(c.s, [c]);
  }
  /** Products the group makes that no other group on its edges uses as an ingredient (a sink takes anything). */
  const finalProducts = (grp: Group): Acc[] =>
    [...grp.prod.values()].filter((p) => !(outOf.get(grp.idx) ?? []).some((c) => c.item?.className === p.className && groups[c.d].ing.has(p.className)));

  const siteKeyCount = new Map<string, number>();
  const sites: PlannerSite[] = [];
  for (const list of siteLists) {
    let sx = 0;
    let sy = 0;
    let sn = 0;
    let machineCount = 0;
    const stateCounts = Object.create(null) as Record<string, number>;
    const finals = new Map<string, Acc & { depth: number }>();
    for (const grp of list) {
      sx += grp.posSum.x;
      sy += grp.posSum.y;
      sn += grp.posN;
      machineCount += grp.units.length;
      for (const [state, n] of Object.entries(grp.stateCounts)) stateCounts[state] = (stateCounts[state] ?? 0) + n;
      for (const p of finalProducts(grp)) {
        const f = finals.get(p.className);
        const dp = depth[scc.comp[grp.idx]];
        if (f) {
          f.cur += p.cur;
          f.max += p.max;
          f.depth = Math.max(f.depth, dp);
        } else finals.set(p.className, { ...p, depth: dp });
      }
    }
    const cx = sn > 0 ? whole(sx / sn) : 0;
    const cy = sn > 0 ? whole(sy / sn) : 0;
    const base = `site|${snap(cx)}|${snap(cy)}`;
    const seen = (siteKeyCount.get(base) ?? 0) + 1;
    siteKeyCount.set(base, seen);
    const key = seen === 1 ? base : `${base}#${seen}`;
    for (const grp of list) grp.siteKey = key;
    const ranked = [...finals.values()];
    const headline = [...ranked].sort((a, b) => b.depth - a.depth || b.max - a.max || byString(a.className, b.className))[0];
    const top = ranked.sort((a, b) => b.max - a.max || byString(a.className, b.className)).slice(0, 5);
    sites.push({
      key,
      name: headline ? `${headline.name.slice(0, 190)} site` : `Site near (${cx}, ${cy})`,
      at: { x: cx, y: cy },
      machineCount,
      stateCounts,
      topOutputs: toRates(new Map(top.map((t) => [t.className, t]))).slice(0, 5),
      nodeKeys: list.map((grp) => grp.key).sort(byString),
    });
  }

  // ---- source trees (ADR-0053 Decision 3): bubbles of recipe x upstream closure; sites only scope non-machine bubbles ----
  groups.forEach((grp, i) => (flowGroups[i].siteKey = grp.siteKey));
  const treeKeys = sourceTrees(flowGroups, flowArcs, flows);

  // ---- caps (deterministic): the largest sites, then the largest groups, then the first edges in key order ----
  sites.sort((a, b) => b.machineCount - a.machineCount || byString(a.key, b.key));
  let keptSites = sites;
  if (sites.length > PLANNER_MAX_SITES) {
    keptSites = sites.slice(0, PLANNER_MAX_SITES);
    truncated = true;
  }
  const siteSet = new Set(keptSites.map((s) => s.key));
  let kept = groups.filter((grp) => siteSet.has(grp.siteKey));
  if (kept.length > PLANNER_MAX_NODES) {
    kept = [...kept].sort((a, b) => b.units.length - a.units.length || byString(a.key, b.key)).slice(0, PLANNER_MAX_NODES);
    truncated = true;
  }
  if (kept.length < groups.length) truncated = true;
  const keptKeys = new Set(kept.map((grp) => grp.key));
  for (const s of keptSites) s.nodeKeys = s.nodeKeys.filter((k) => keptKeys.has(k));
  let keptEdges = outEdges.filter((e) => keptKeys.has(e.from) && keptKeys.has(e.to));
  if (keptEdges.length > PLANNER_MAX_EDGES) {
    keptEdges = keptEdges.slice(0, PLANNER_MAX_EDGES);
    truncated = true;
  }

  const nodes: PlannerNode[] = kept
    .map((grp) => {
      const n = grp.posN > 0 ? { x: whole(grp.posSum.x / grp.posN), y: whole(grp.posSum.y / grp.posN) } : { x: 0, y: 0 };
      return {
        key: grp.key,
        kind: grp.kind,
        className: grp.className.slice(0, 200),
        name: grp.name.slice(0, 200),
        recipe: grp.recipe === null ? null : grp.recipe.slice(0, 200),
        count: grp.units.length,
        machineIds: grp.ids.slice(0, PLANNER_MAX_MACHINE_IDS),
        stateCounts: grp.stateCounts,
        products: toRates(grp.prod),
        ingredients: toRates(grp.ing),
        at: n,
        siteKey: grp.siteKey,
        loop: grp.loop,
        treeKey: treeKeys[grp.idx],
      };
    })
    .sort((a, b) => byString(a.key, b.key));
  if (kept.some((grp) => grp.ids.length > PLANNER_MAX_MACHINE_IDS)) truncated = true;

  // ---- unconnected machines and notes ----
  // An id the contract cannot carry (empty, or over 128 characters) can never be named by a conveyor either, so it is left out.
  const allUnconnected = sorted.filter((b) => b.recipe !== null && !g.idToNode.has(b.id) && b.id.length >= 1 && b.id.length <= 128).map((b) => b.id);
  const unconnectedMachineIds = allUnconnected.slice(0, 20_000);
  if (allUnconnected.length > unconnectedMachineIds.length) truncated = true;
  const beltData: ProductionGraph["beltData"] = allUnconnected.length > 0 ? "stale" : "present";
  if (beltData === "stale") {
    notes.push({
      code: "connectionsRefresh",
      text: `Connections refresh every ${CONNECTIONS_REFRESH_MINUTES} minutes, so a belt built or rebuilt since may not show yet.`,
    });
  }
  if (unmatched > 0) {
    notes.push({
      code: "unmatchedLinks",
      text: `${unmatched} links carry items their destination does not use: a mixed belt, a filter or overflow.`,
    });
  }
  if (truncated) {
    notes.push({ code: "graphTruncated", text: "The factory is larger than the planner shows; the smallest sites, groups and links were left out." });
  }

  return {
    graph: { nodes, edges: keptEdges, sites: keptSites, unconnectedMachineIds, beltData, connectionsRefreshMinutes: CONNECTIONS_REFRESH_MINUTES, notes },
    stats: { components: atomIdx.size, sites: keptSites.length, groups: groups.length, links: links.length },
  };
}

/**
 * Tarjan's strongly connected components, iterative: belt chains can be tens of thousands of segments deep, so no
 * recursion. Components are numbered in emission order (sinks first), the reverse of a topological order.
 */
function stronglyConnected(adj: readonly number[][]): { comp: number[]; count: number; members: number[][] } {
  const n = adj.length;
  const index = Array.from({ length: n }, () => -1);
  const low = Array.from({ length: n }, () => 0);
  const onStack = Array.from({ length: n }, () => false);
  const comp = Array.from({ length: n }, () => -1);
  const members: number[][] = [];
  const stack: number[] = [];
  let next = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    const work: { v: number; i: number }[] = [{ v: root, i: 0 }];
    index[root] = low[root] = next++;
    stack.push(root);
    onStack[root] = true;
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame.v;
      if (frame.i < adj[v].length) {
        const w = adj[v][frame.i++];
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = true;
          work.push({ v: w, i: 0 });
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].v;
        low[parent] = Math.min(low[parent], low[v]);
      }
      if (low[v] === index[v]) {
        const id = members.length;
        const list: number[] = [];
        let w: number;
        do {
          w = stack.pop() as number;
          onStack[w] = false;
          comp[w] = id;
          list.push(w);
        } while (w !== v);
        members.push(list);
      }
    }
  }
  return { comp, count: members.length, members };
}
