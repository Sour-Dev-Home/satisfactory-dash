import { PLANNER_DESIGNATION_MAX_DEPTH, type PlannerDesignation, type PlannerFactory, type PlannerRate, type ProductionGraph } from "@satisfactory-dash/shared";
import { aggregateFlows, factoryModelOf, factoryModels, factoryOfNode, flowParts, type FactoryModel } from "./graph/hierarchy";

/**
 * The factory tree (ADR-0061 Decisions 1 to 3), pure: the designations' `parentId` (or, without the designation list, the
 * graph factories' `parentDesignationId`) over the backend's flat factories. A parent's card is a roll-up of its parts:
 * machine and state counts are sums, and its products are its own and its children's minus what flows between them,
 * clamped at 0 and read "at least" when such an internal flow is estimated or unknown. A parent that owns machines itself
 * shows them, on its own level, as one more card named after it ("Main base (own machines)"), so every machine is drawn
 * exactly once. Bad data never throws: a parent the list lacks makes its children top level, a cycle is cut at its
 * smallest id, anything deeper than `PLANNER_DESIGNATION_MAX_DEPTH` hangs under its ancestor one level above that, and a
 * designation with no machines anywhere below it is left out.
 */

/** A parent's own machines: its key plus this. */
export const OWN_SUFFIX = "|own";
export const ownKeyOf = (key: string): string => `${key}${OWN_SUFFIX}`;
/** The key the backend gives a designated factory (`factoryReduction.ts`); a parent with no machines of its own borrows it. */
export const designatedKeyOf = (id: string): string => `factory|designation|${id}`;
export const ownName = (name: string): string => `${name} (own machines)`;

export type TreeNodeKind = "leaf" | "parent" | "own";

export interface TreeNode {
  /** The path element: a graph factory's key, a parent's key, or a parent's own-machines key. */
  key: string;
  kind: TreeNodeKind;
  name: string;
  designationId: string | null;
  parentKey: string | null;
  /** 1 = top level. An own-machines card sits one below its parent. */
  depth: number;
  /** A parent's parts in order: its own machines first, then its children. Empty for the others. */
  childKeys: string[];
  /** What the level above draws: the graph's model, a parent's roll-up, or the parent's own machines renamed and re-keyed. */
  card: FactoryModel;
  /** The graph's factory this opens into (a leaf, or a parent's own machines). Undefined for a parent: it opens into its parts. */
  opens: FactoryModel | undefined;
}

export interface FactoryTree {
  nodes: ReadonlyMap<string, TreeNode>;
  rootKeys: string[];
  /** Whether any factory has children (the breadcrumb shows only then). */
  nested: boolean;
  /** Each graph factory's key to the tree node that draws it (a leaf, or a parent's own-machines card). */
  ofFactory: ReadonlyMap<string, string>;
}

interface Entity {
  id: string;
  key: string;
  name: string;
  designationId: string | null;
  parent: string | null;
  own: FactoryModel | undefined;
  /** The graph's order of the first factory in its subtree, so a flat tree keeps the backend's order. */
  order: number;
  children: Entity[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function entitiesOf(models: readonly FactoryModel[], designations: readonly PlannerDesignation[] | undefined, nesting: boolean): Map<string, Entity> {
  const listed = new Map((designations ?? []).map((d) => [d.id, d]));
  const entities = new Map<string, Entity>();
  models.forEach((model, order) => {
    const f = model.factory;
    const did = f.designationId;
    // An automatic factory is never a parent, so its id only has to be unique: a designation id is a uuid, never this.
    const id = did !== null && !entities.has(did) ? did : `\u0000${f.key}`;
    const listing = did === null ? undefined : listed.get(did);
    const parent = !nesting || did === null ? null : listing !== undefined ? (listing.parentId ?? null) : (f.parentDesignationId ?? null);
    entities.set(id, { id, key: f.key, name: listing?.name ?? f.name, designationId: did, parent, own: model, order, children: [] });
  });
  // A parent with no machines of its own has no graph factory (ADR-0061 Decision 2): its name comes from the list.
  if (nesting)
    for (const d of designations ?? [])
      if (!entities.has(d.id))
        entities.set(d.id, { id: d.id, key: designatedKeyOf(d.id), name: d.name, designationId: d.id, parent: d.parentId ?? null, own: undefined, order: Infinity, children: [] });
  return entities;
}

/** Parents that are missing or the entity itself become top level; each cycle is cut at its smallest id. */
function repairParents(entities: Map<string, Entity>): void {
  for (const e of entities.values()) if (e.parent !== null && (e.parent === e.id || !entities.has(e.parent))) e.parent = null;
  const done = new Set<string>();
  for (const id of [...entities.keys()].sort(byText)) {
    const stack: string[] = [];
    const onStack = new Set<string>();
    let at: string | null = id;
    while (at !== null && !done.has(at) && !onStack.has(at)) {
      stack.push(at);
      onStack.add(at);
      at = entities.get(at)?.parent ?? null;
    }
    if (at !== null && onStack.has(at)) {
      const head = stack.slice(stack.indexOf(at)).sort(byText)[0];
      const cut = head === undefined ? undefined : entities.get(head);
      if (cut !== undefined) cut.parent = null;
    }
    for (const s of stack) done.add(s);
  }
  // Too deep (defensive: the backend refuses it): hang it under its ancestor at the level above the deepest.
  const moves = new Map<string, string>();
  for (const e of entities.values()) {
    const chain: string[] = [];
    for (let p = e.parent; p !== null; p = entities.get(p)?.parent ?? null) chain.push(p);
    const to = chain[chain.length - (PLANNER_DESIGNATION_MAX_DEPTH - 1)];
    if (chain.length + 1 > PLANNER_DESIGNATION_MAX_DEPTH && to !== undefined) moves.set(e.id, to);
  }
  for (const [id, to] of moves) {
    const e = entities.get(id);
    if (e !== undefined) e.parent = to;
  }
}

/** Builds the children lists and drops what has no machines anywhere below it; returns the roots, ordered. */
function linkAndPrune(entities: Map<string, Entity>): Entity[] {
  const roots: Entity[] = [];
  for (const e of entities.values()) {
    const parent = e.parent === null ? undefined : entities.get(e.parent);
    if (parent === undefined) roots.push(e);
    else parent.children.push(e);
  }
  const keep = (e: Entity): boolean => {
    e.children = e.children.filter(keep);
    e.order = Math.min(e.order, ...e.children.map((c) => c.order));
    e.children.sort(bySiblingOrder);
    return e.own !== undefined || e.children.length > 0;
  };
  return roots.filter(keep).sort(bySiblingOrder);
}

const bySiblingOrder = (a: Entity, b: Entity): number => a.order - b.order || byText(a.key, b.key);

/** Each group's card at the level under `parentKey` (null = the top level); undefined for a group outside it. */
export function levelOwner(graph: ProductionGraph, tree: FactoryTree, parentKey: string | null): Map<string, string> {
  const owner = new Map<string, string>();
  const factoryOf = factoryOfNode(graph);
  for (const [nodeKey, factoryKey] of factoryOf) {
    let at = tree.ofFactory.get(factoryKey);
    let guard = 0;
    while (at !== undefined && guard++ <= PLANNER_DESIGNATION_MAX_DEPTH + 1) {
      const node = tree.nodes.get(at);
      if (node === undefined) break;
      if (node.parentKey === parentKey) {
        owner.set(nodeKey, at);
        break;
      }
      at = node.parentKey ?? undefined;
    }
  }
  return owner;
}

interface Acc {
  rate: PlannerRate;
  cut: boolean;
}

/** A parent's card: the sums over its parts, with the flows between them taken off its products. */
function rollup(graph: ProductionGraph, tree: FactoryTree, node: TreeNode, parts: readonly TreeNode[]): FactoryModel {
  const products = new Map<string, Acc>();
  const atLeast = new Set<string>();
  for (const part of parts) {
    for (const r of part.card.factory.products) {
      const acc = products.get(r.className);
      if (acc === undefined) products.set(r.className, { rate: { ...r }, cut: false });
      else {
        acc.rate.currentPerMinute += r.currentPerMinute;
        acc.rate.maxPerMinute += r.maxPerMinute;
      }
    }
    for (const c of part.card.atLeast ?? []) atLeast.add(c);
  }
  const owner = levelOwner(graph, tree, node.key);
  for (const f of aggregateFlows(flowParts(graph), (key) => owner.get(key))) {
    const acc = f.itemClassName === null ? undefined : products.get(f.itemClassName);
    if (acc === undefined) continue;
    if (f.ratePerMinute !== null && f.ratePerMinute > 0) {
      acc.cut = acc.cut || acc.rate.currentPerMinute > 0;
      acc.rate.currentPerMinute = Math.max(0, acc.rate.currentPerMinute - f.ratePerMinute);
      acc.rate.maxPerMinute = Math.max(0, acc.rate.maxPerMinute - f.ratePerMinute);
    }
    if (f.quality !== "measured") atLeast.add(acc.rate.className);
  }
  // A product its parts use up between them is not an output of the whole; one that read 0 before stays (it is stalled).
  const net = [...products.values()]
    .filter((a) => !(a.cut && a.rate.currentPerMinute === 0))
    .map((a) => a.rate)
    .sort((a, b) => b.maxPerMinute - a.maxPerMinute || byText(a.className, b.className));
  const shown = new Set(net.map((r) => r.className));
  const factory: PlannerFactory = {
    key: node.key,
    name: node.name,
    designationId: node.designationId,
    products: net,
    sideProducts: [],
    nodeKeys: [...new Set(parts.flatMap((p) => p.card.factory.nodeKeys))],
    siteKeys: [...new Set(parts.flatMap((p) => p.card.factory.siteKeys))],
    machineCount: parts.reduce((sum, p) => sum + p.card.factory.machineCount, 0),
    sharedNodeCount: parts.reduce((sum, p) => sum + p.card.factory.sharedNodeCount, 0),
    parentDesignationId: null,
  };
  return { ...factoryModelOf(graph, factory), atLeast: new Set([...atLeast].filter((c) => shown.has(c))) };
}

/**
 * The tree over the graph's factories. `designations` is the list when it has answered (undefined otherwise: the tree is
 * then built from the graph's `parentDesignationId`, and a parent with no machines of its own is not known). With
 * `nesting` off (the `planner.nesting` flag) every factory is top level, as before ADR-0061.
 */
export function buildFactoryTree(graph: ProductionGraph, designations: readonly PlannerDesignation[] | undefined, nesting = true): FactoryTree {
  const entities = entitiesOf(factoryModels(graph), designations, nesting);
  repairParents(entities);
  const roots = linkAndPrune(entities);
  const nodes = new Map<string, TreeNode>();
  const ofFactory = new Map<string, string>();
  const parents: { node: TreeNode; parts: TreeNode[] }[] = [];
  const add = (node: TreeNode): TreeNode | undefined => {
    // Keys come from the server: a repeat (never expected) is left out rather than overwriting the first.
    if (nodes.has(node.key)) return undefined;
    nodes.set(node.key, node);
    if (node.opens !== undefined && !ofFactory.has(node.opens.factory.key)) ofFactory.set(node.opens.factory.key, node.key);
    return node;
  };
  const place = (e: Entity, parentKey: string | null, depth: number): TreeNode | undefined => {
    const base = { name: e.name, designationId: e.designationId, parentKey, depth };
    if (e.children.length === 0) {
      if (e.own === undefined) return undefined;
      return add({ ...base, key: e.key, kind: "leaf", childKeys: [], card: e.own, opens: e.own });
    }
    // The card is filled in once its parts are (below, deepest first).
    const node = add({ ...base, key: e.key, kind: "parent", childKeys: [], card: factoryModelOf(graph, emptyFactory(e)), opens: undefined });
    if (node === undefined) return undefined;
    const parts: TreeNode[] = [];
    if (e.own !== undefined) {
      const key = ownKeyOf(e.key);
      const card = { ...e.own, factory: { ...e.own.factory, key, name: ownName(e.name) } };
      const own = add({ name: ownName(e.name), designationId: e.designationId, parentKey: e.key, depth: depth + 1, key, kind: "own", childKeys: [], card, opens: e.own });
      if (own !== undefined) parts.push(own);
    }
    for (const c of e.children) {
      const child = place(c, e.key, depth + 1);
      if (child !== undefined) parts.push(child);
    }
    node.childKeys = parts.map((p) => p.key);
    parents.push({ node, parts });
    return node;
  };
  const rootKeys = roots.flatMap((e) => place(e, null, 1)?.key ?? []);
  const tree: FactoryTree = { nodes, rootKeys, nested: parents.length > 0, ofFactory };
  // A parent joins `parents` after its parts are placed (post-order), so every child's card is filled before its parent's.
  for (const { node, parts } of parents) node.card = rollup(graph, tree, node, parts);
  return tree;
}

const emptyFactory = (e: Entity): PlannerFactory => ({
  key: e.key,
  name: e.name,
  designationId: e.designationId,
  products: [],
  sideProducts: [],
  nodeKeys: [],
  siteKeys: [],
  machineCount: 0,
  sharedNodeCount: 0,
});

/** What the overview shows for a path: the parts of its last element when that is a parent, else the top level. */
export function levelOf(tree: FactoryTree, path: readonly string[]): { parent: TreeNode | undefined; entries: TreeNode[] } {
  const last = path.length === 0 ? undefined : tree.nodes.get(path[path.length - 1] ?? "");
  const parent = last?.kind === "parent" ? last : undefined;
  const keys = parent === undefined ? tree.rootKeys : parent.childKeys;
  return { parent, entries: keys.flatMap((k) => tree.nodes.get(k) ?? []) };
}

/**
 * ADR-0061 Decision 4, validation: the longest prefix of `path` in which the first element is top level and each other is
 * a part of the one before. Never throws; a shorter result means the tail named a factory that is no longer there.
 */
export function resolvePath(tree: FactoryTree, path: readonly string[]): string[] {
  const kept: string[] = [];
  let allowed: readonly string[] = tree.rootKeys;
  for (const key of path) {
    const node = tree.nodes.get(key);
    if (node === undefined || !allowed.includes(key)) break;
    kept.push(key);
    allowed = node.childKeys;
  }
  return kept;
}
