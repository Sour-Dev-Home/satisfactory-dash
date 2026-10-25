import type { BottleneckNote, PlannerEdge, PlannerNode, PlannerTransport, TrainRoutePlatform, TrainRouteRecord, TrainRouteStation } from "@satisfactory-dash/shared";
import { byString } from "./connectionGraph.js";

/**
 * Transport edges for the production planner (ADR-0055 Decision 2; build PR 6a): trains, from the stored `trainRoutes`
 * layer, and the Dimensional Depot, from the uploaders the conveyors layer already has. Pure and deterministic: no I/O, no
 * clock, no randomness; the same input in any order gives byte-identical output. Drones and trucks are PR 12.
 *
 * The layer is the contract's `TrainRouteRecord` (`packages/shared/src/map.ts`), already projected from FRM by the game
 * adapter, so nothing here knows an FRM shape. The facts the rules rest on are in
 * `docs-vault/raw-sources/frm-train-gate-2026-10-21.md`: a platform's `ID` equals the belt end id (check 1), and station
 * names are player text that the game does not keep unique and that keeps its trailing space (check 2). The train
 * `TransferRate`, `InflowRate` and `OutflowRate` are unverified (check 3), so no rate is read from them. Stop filters
 * are not in the capture `[NEEDS VERIFICATION]`, so cargo comes from platform inventories and the belts at each end.
 */

/** The one virtual node every `depot` transport ends at. */
export const DEPOT_NODE_KEY = "depot|dimensional";
export const DEPOT_NODE_NAME = "Dimensional Depot";
export const DEPOT_NODE_CLASS = "Desc_DimensionalDepot";
/** Where a virtual node's `siteKey` points: no site holds it. */
export const DEPOT_SITE_KEY = "depot";

export const NOTE_DUPLICATE_STATION = "duplicateStationName";
export const NOTE_UNKNOWN_STOP = "unknownTimetableStop";

const NAME_MAX = 200;
const NOTE_NAME_MAX = 40;
const NOTE_NAMES_SHOWN = 3;

export interface LogisticsInput {
  /** The stored `trainRoutes` layer, or null when it is not read (no row, a skip, a truncation or a schema failure). */
  trainRoutes: readonly TrainRouteRecord[] | null;
  /** The planner's belt and pipe edges (node keys), for the items arriving at and leaving a platform, and rates. */
  edges: readonly PlannerEdge[];
  /** A conveyor end id (a platform's `ID`) to the key of the node holding it, or null when no kept node does. */
  nodeOfPlatform: (platformId: string) => string | null;
  /** The Dimensional Depot uploader nodes: key and centroid. */
  uploaders: readonly { key: string; at: { x: number; y: number } }[];
  /** Item class to display name, from the snapshot's recipes; an item not listed shows its class. */
  itemNames: ReadonlyMap<string, string>;
}

export interface LogisticsResult {
  transports: PlannerTransport[];
  notes: BottleneckNote[];
  /** The virtual Dimensional Depot node, when at least one uploader exists. */
  depotNode: PlannerNode | null;
}

type ItemFrom = "inventory" | "upstream" | "downstream";
interface ItemRef {
  className: string;
  from: ItemFrom;
}

interface Acc {
  from: string;
  to: string;
  item: ItemRef | null;
  trains: Set<string>;
  routeName: string;
}

const fromRank = (f: ItemFrom): number => (f === "inventory" ? 0 : f === "upstream" ? 1 : 2);
const isSupply =(e: PlannerEdge): boolean => e.flow === undefined || e.flow === "supply";
const round2 = (n: number): number => Math.round(n * 100) / 100;

function nameList(names: readonly string[]): string {
  const sorted = [...new Set(names)].sort(byString);
  const shown = sorted.slice(0, NOTE_NAMES_SHOWN).map((n) => `"${n.length > NOTE_NAME_MAX ? `${n.slice(0, NOTE_NAME_MAX)}...` : n}"`);
  const more = sorted.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

/** Item classes known on each node's belts: arriving (any edge) and wanted downstream (supply edges leaving), with rates. */
function beltIndex(edges: readonly PlannerEdge[]) {
  const arriving = new Map<string, Set<string>>();
  const leaving = new Map<string, Map<string, { sum: number; known: boolean }>>();
  for (const e of edges) {
    if (e.itemClassName === null) continue;
    let into = arriving.get(e.to);
    if (!into) arriving.set(e.to, (into = new Set()));
    into.add(e.itemClassName);
    if (!isSupply(e)) continue;
    let out = leaving.get(e.from);
    if (!out) leaving.set(e.from, (out = new Map()));
    const cur = out.get(e.itemClassName) ?? { sum: 0, known: true };
    if (e.ratePerMinute === null) cur.known = false;
    else cur.sum += e.ratePerMinute;
    out.set(e.itemClassName, cur);
  }
  return { arriving, leaving };
}

/**
 * The items a loading platform sends to an unloading one. Both sides known: the items both name (ADR-0055 Decision 2: B's
 * inventory holds X or its downstream consumes X). One side known: that side's items. Neither: one edge with no item.
 */
function carried(load: ItemRef[], unload: ItemRef[]): (ItemRef | null)[] {
  if (load.length > 0 && unload.length > 0) {
    const wanted = new Set(unload.map((u) => u.className));
    return load.filter((l) => wanted.has(l.className));
  }
  if (load.length > 0) return load;
  if (unload.length > 0) return unload;
  return [null];
}

export function buildLogisticsEdges(input: LogisticsInput): LogisticsResult {
  const nameOf = (cls: string): string => (input.itemNames.get(cls) ?? cls).slice(0, NAME_MAX);
  const { arriving, leaving } = beltIndex(input.edges);
  const notes: BottleneckNote[] = [];
  const acc = new Map<string, Acc>();

  if (input.trainRoutes !== null) {
    const stations: TrainRouteStation[] = [];
    const trains: Extract<TrainRouteRecord, { recordType: "train" }>[] = [];
    for (const r of input.trainRoutes) {
      if (r.recordType === "station") stations.push(r);
      else trains.push(r);
    }
    stations.sort((a, b) => byString(a.id, b.id));
    trains.sort((a, b) => byString(a.id, b.id));
    // Names match after the same trim on both sides; a name two stations share resolves to nobody (gate check 2).
    const byName = new Map<string, TrainRouteStation[]>();
    for (const s of stations) {
      const list = byName.get(s.name.trim());
      if (list) list.push(s);
      else byName.set(s.name.trim(), [s]);
    }
    const duplicated = new Set<string>();
    const unknown = new Set<string>();
    const resolve = (stop: string): TrainRouteStation | null => {
      const list = byName.get(stop.trim());
      if (list === undefined) {
        unknown.add(stop.trim());
        return null;
      }
      if (list.length > 1) {
        duplicated.add(stop.trim());
        return null;
      }
      return list[0];
    };
    const itemsAt = (p: TrainRoutePlatform, loading: boolean): ItemRef[] => {
      const node = input.nodeOfPlatform(p.id);
      const out = new Map<string, ItemRef>();
      for (const cls of p.items) out.set(cls, { className: cls, from: "inventory" });
      if (node !== null) {
        // Loading: what the belts bring in. Unloading: what the belts onward take (the downstream consumes it).
        const belt = loading ? (arriving.get(node) ?? new Set<string>()) : new Set((leaving.get(node) ?? new Map<string, never>()).keys());
        for (const cls of belt) if (!out.has(cls)) out.set(cls, { className: cls, from: loading ? "upstream" : "downstream" });
      }
      return [...out.values()].sort((a, b) => byString(a.className, b.className));
    };

    // What one station sends to another, worked out once per ordered pair however many trains and stops reach it.
    const pairCache = new Map<string, { key: string; from: string; to: string; item: ItemRef | null; routeName: string }[]>();
    const pairEdges = (a: TrainRouteStation, b: TrainRouteStation) => {
      const pairKey = `${a.id}\0${b.id}`;
      const hit = pairCache.get(pairKey);
      if (hit) return hit;
      const out: { key: string; from: string; to: string; item: ItemRef | null; routeName: string }[] = [];
      const routeName = `${a.name.trim()} to ${b.name.trim()}`.slice(0, NAME_MAX);
      for (const lp of a.platforms) {
        if (lp.mode !== "load") continue;
        const from = input.nodeOfPlatform(lp.id);
        if (from === null) continue;
        for (const up of b.platforms) {
          if (up.mode !== "unload") continue;
          const to = input.nodeOfPlatform(up.id);
          if (to === null || to === from) continue;
          for (const item of carried(itemsAt(lp, true), itemsAt(up, false))) out.push({ key: `${from}\0${to}\0${item?.className ?? ""}`, from, to, item, routeName });
        }
      }
      pairCache.set(pairKey, out);
      return out;
    };

    for (const train of trains) {
      const stops = train.stops.map(resolve);
      const n = stops.length;
      const seen = new Set<string>();
      for (let i = 0; i < n; i++) {
        const a = stops[i];
        if (a === null) continue;
        // Each later stop before the train comes back to A.
        for (let k = 1; k < n; k++) {
          const b = stops[(i + k) % n];
          if (b !== null && b.id === a.id) break;
          if (b === null) continue;
          const pairKey = `${a.id}\0${b.id}`;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          for (const { key, from, to, item, routeName } of pairEdges(a, b)) {
            const cur = acc.get(key);
            if (cur) {
              cur.trains.add(train.id);
              if (byString(routeName, cur.routeName) < 0) cur.routeName = routeName;
              // The same item reached by two platforms of one node: the strongest evidence wins, whatever the order.
              if (item !== null && cur.item !== null && fromRank(item.from) < fromRank(cur.item.from)) cur.item = item;
            } else acc.set(key, { from, to, item, trains: new Set([train.id]), routeName });
          }
        }
      }
    }
    if (duplicated.size > 0) notes.push({ code: NOTE_DUPLICATE_STATION, text: `Station name used twice: ${nameList([...duplicated])}. No train route is drawn through it.`.slice(0, 300) });
    if (unknown.size > 0) notes.push({ code: NOTE_UNKNOWN_STOP, text: `A timetable names a station that does not exist: ${nameList([...unknown])}. No train route is drawn through it.`.slice(0, 300) });
  }

  // Train edges. A rate only where one transport brings the item to that node: the downstream supply it serves.
  const arrivals = new Map<string, number>();
  for (const a of acc.values()) if (a.item !== null) arrivals.set(`${a.to}\0${a.item.className}`, (arrivals.get(`${a.to}\0${a.item.className}`) ?? 0) + 1);
  const supplyFrom = new Map<string, PlannerEdge[]>();
  const edgesInto = new Map<string, PlannerEdge[]>();
  const push = (m: Map<string, PlannerEdge[]>, k: string, e: PlannerEdge) => {
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  };
  for (const e of input.edges) {
    if (isSupply(e)) push(supplyFrom, e.from, e);
    push(edgesInto, e.to, e);
  }
  const destinationOf =(node: string, cls: string | null): string => {
    const dests = new Set<string>();
    for (const e of supplyFrom.get(node) ?? []) if ((cls === null || e.itemClassName === null || e.itemClassName === cls) && e.destination !== undefined) dests.add(e.destination);
    return dests.size === 1 ? [...dests][0] : "unknown";
  };
  const transports: PlannerTransport[] = [];
  for (const a of acc.values()) {
    const cls = a.item?.className ?? null;
    const served = cls === null ? undefined : leaving.get(a.to)?.get(cls);
    const sole = cls !== null && arrivals.get(`${a.to}\0${cls}`) === 1;
    const rated = sole && served !== undefined && served.known;
    const destination = destinationOf(a.to, cls);
    transports.push({
      from: a.from,
      to: a.to,
      mode: "train",
      itemClassName: cls,
      itemName: cls === null ? null : nameOf(cls),
      ...(a.item === null ? {} : { itemFrom: a.item.from }),
      ratePerMinute: rated ? round2(served.sum) : null,
      rate: rated ? "estimated" : "unknown",
      carriers: a.trains.size,
      routeName: a.routeName,
      flow: destination === "factory" ? "supply" : "output",
      destination,
    });
  }

  // Depot edges: one per uploader and item, ending at the virtual node.
  const uploaders = [...input.uploaders].sort((a, b) => byString(a.key, b.key));
  for (const u of uploaders) {
    const into = edgesInto.get(u.key) ?? [];
    const byItem = new Map<string, PlannerEdge[]>();
    let anonymous = false;
    for (const e of into) {
      if (e.itemClassName === null) {
        anonymous = true;
        continue;
      }
      const list = byItem.get(e.itemClassName);
      if (list) list.push(e);
      else byItem.set(e.itemClassName, [e]);
    }
    const depotEdge = (cls: string | null, list: readonly PlannerEdge[]): PlannerTransport => {
      const known = cls !== null && list.length > 0 && list.every((e) => e.ratePerMinute !== null);
      return {
        from: u.key,
        to: DEPOT_NODE_KEY,
        mode: "depot",
        itemClassName: cls,
        itemName: cls === null ? null : nameOf(cls),
        ...(cls === null ? {} : { itemFrom: "upstream" }),
        ratePerMinute: known ? round2(list.reduce((s, e) => s + (e.ratePerMinute as number), 0)) : null,
        rate: known ? (list.length === 1 ? list[0].rate : "estimated") : "unknown",
        carriers: 0,
        routeName: null,
        flow: "output",
        destination: "depot",
      };
    };
    for (const [cls, list] of byItem) transports.push(depotEdge(cls, list));
    // An uploader nothing is known to feed, or with an unidentified belt, still shows its edge to the Depot.
    if (anonymous || byItem.size === 0) transports.push(depotEdge(null, []));
  }

  transports.sort(
    (a, b) => byString(a.from, b.from) || byString(a.to, b.to) || byString(a.mode, b.mode) || byString(a.itemClassName ?? "", b.itemClassName ?? ""),
  );

  let depotNode: PlannerNode | null = null;
  if (uploaders.length > 0) {
    const at = {
      x: Math.round(uploaders.reduce((s, u) => s + u.at.x, 0) / uploaders.length) || 0,
      y: Math.round(uploaders.reduce((s, u) => s + u.at.y, 0) / uploaders.length) || 0,
    };
    depotNode = {
      key: DEPOT_NODE_KEY,
      kind: "storage",
      className: DEPOT_NODE_CLASS,
      name: DEPOT_NODE_NAME,
      recipe: null,
      count: 1,
      machineIds: [],
      stateCounts: {},
      products: [],
      ingredients: [],
      at,
      siteKey: DEPOT_SITE_KEY,
      loop: false,
      role: "depot",
    };
  }
  return { transports, notes, depotNode };
}
