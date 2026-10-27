import type { ProductionGraph } from "@satisfactory-dash/shared";

/**
 * ADR-0055 Decision 12 (#727): whether factories are connected, checked on the client only, from the latest production
 * graph. Ignoring direction, two factories touch when an edge or a transport joins a node of one to a node of the other,
 * or when a node is shared between them (its `shares`). Automatic (suggested) factories are nodes of this graph like
 * designated ones. Keys are game-derived strings, so every lookup is a Map.
 */

/** Every factory a node belongs to: the factories that list it, its own `factoryKey`, and each factory its shares name. */
function factoriesOfNodes(graph: ProductionGraph): Map<string, Set<string>> {
  const of = new Map<string, Set<string>>();
  const add = (nodeKey: string, factoryKey: string) => {
    let set = of.get(nodeKey);
    if (set === undefined) of.set(nodeKey, (set = new Set()));
    set.add(factoryKey);
  };
  for (const f of graph.factories ?? []) for (const key of f.nodeKeys) add(key, f.key);
  for (const n of graph.nodes) {
    if (n.factoryKey !== undefined) add(n.key, n.factoryKey);
    for (const s of n.shares ?? []) add(n.key, s.factoryKey);
  }
  return of;
}

/** The undirected factory graph: for each factory, the other factories it touches. A factory never links to itself. */
export function factoryLinks(graph: ProductionGraph): Map<string, Set<string>> {
  const of = factoriesOfNodes(graph);
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    let set = links.get(a);
    if (set === undefined) links.set(a, (set = new Set()));
    set.add(b);
  };
  const join = (left: ReadonlySet<string>, right: ReadonlySet<string>) => {
    for (const a of left) for (const b of right) {
      link(a, b);
      link(b, a);
    }
  };
  // A shared node joins every factory it belongs to.
  for (const set of of.values()) join(set, set);
  for (const x of [...graph.edges, ...(graph.transports ?? [])]) {
    const from = of.get(x.from);
    const to = of.get(x.to);
    if (from !== undefined && to !== undefined) join(from, to);
  }
  return links;
}

/**
 * Whether the selected factories form one piece by themselves: a path must run through selected factories only, since
 * merging two factories joined only through a third would make one factory of two unconnected parts. One factory (or
 * none) is trivially connected; an unknown key is never connected to anything.
 */
export function factoriesConnected(graph: ProductionGraph, keys: readonly string[]): boolean {
  const selected = new Set(keys);
  if (selected.size <= 1) return true;
  const links = factoryLinks(graph);
  const [first] = selected;
  const reached = new Set<string>([first!]);
  const queue = [first!];
  while (queue.length > 0) {
    const at = queue.pop()!;
    for (const next of links.get(at) ?? []) {
      if (selected.has(next) && !reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached.size === selected.size;
}

/** How many unconnected parts the given groups make, through the edges and transports between them only. */
export function partsOf(graph: ProductionGraph, nodeKeys: ReadonlySet<string>): number {
  const parent = new Map<string, string>();
  for (const k of nodeKeys) parent.set(k, k);
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(k, root);
    return root;
  };
  let parts = nodeKeys.size;
  for (const x of [...graph.edges, ...(graph.transports ?? [])]) {
    if (!nodeKeys.has(x.from) || !nodeKeys.has(x.to)) continue;
    const a = find(x.from);
    const b = find(x.to);
    if (a !== b) {
      parent.set(a, b);
      parts -= 1;
    }
  }
  return parts;
}
