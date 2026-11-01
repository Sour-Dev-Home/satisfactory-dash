import type { Bottleneck, PlannerNode, PlannerRate, ProductionGraph } from "@satisfactory-dash/shared";
import { isStaleNode } from "./graph/graphModel";
import { aggregateFlows, flowParts, type AggregateFlow, type ConnectionRow } from "./graph/hierarchy";
import {
  aggregateRateText,
  carrierText,
  carrierWord,
  destinationChipText,
  destinationPhrase,
  edgeCapacityText,
  edgeItemText,
  flowText,
  groupLabel,
  hasMax,
  isZeroRate,
  itemFromText,
  outputLine,
  rateText,
  stalledOf,
  stalledStateText,
  type StalledKind,
} from "./plannerText";

/**
 * The outline's words and order (ADR-0062 Decision 3), pure: the summary sentence, the "Needs attention" list by severity,
 * each group's neighbours, and the rows of the 5-column "All connections" table. No React.
 */

/** ADR-0062 Decision 3, cost: a factory with more groups than this starts closed in the outline. */
export const OUTLINE_OPEN_MAX = 20;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A group's products that read 0 although its machines could make some: what the canvas marks as stalled. */
export const stalledOutputs = (node: PlannerNode): PlannerRate[] =>
  isStaleNode(node) ? [] : node.products.filter((rate) => isZeroRate(rate) && hasMax(rate));

/** "385 machines in 160 groups: 4 stalled, 12 in loops." (machines, stalled groups, groups in a loop). */
export function outlineSummaryText(nodes: readonly PlannerNode[]): string {
  const machines = nodes.reduce((sum, n) => sum + n.count, 0);
  const stalled = nodes.filter((n) => stalledOutputs(n).length > 0).length;
  const loops = nodes.filter((n) => n.loop).length;
  return `${plural(machines, "machine", "machines")} in ${plural(nodes.length, "group", "groups")}: ${stalled} stalled, ${loops} in ${loops === 1 ? "a loop" : "loops"}.`;
}

export type AttentionKind = "stalled" | "bottleneck" | "unknownEnd";

export interface AttentionItem {
  /** Unique in the list. */
  key: string;
  kind: AttentionKind;
  /** The group it is about: "Show in graph" selects it. */
  nodeKey: string;
  /** The group's name ("8× Constructor, Iron Plate"). */
  label: string;
  /** What is wrong, in words. */
  text: string;
  /** A stalled output's mark (absent where its word has none) and its word, which always follows the mark. */
  mark?: StalledKind | undefined;
  word?: string | undefined;
}

/**
 * "Needs attention", by severity (Decision 3 does not rank them; this does): first the stalled outputs, the most output
 * lost first (a product reading 0 is a whole line stopped); then the bottleneck findings in the Factory page's own order
 * (already ranked by output lost); then the flows that end somewhere the data cannot name. Only groups in `nodes`.
 */
export function attentionItems(nodes: readonly PlannerNode[], graph: ProductionGraph, findings: readonly Bottleneck[] | undefined): AttentionItem[] {
  const inScope = new Map(nodes.map((n) => [n.key, n]));
  const stalled = nodes
    .flatMap((node) =>
      stalledOutputs(node).map((rate) => ({
        lost: Number.isFinite(rate.maxPerMinute) ? rate.maxPerMinute : 0,
        item: {
          key: `stalled|${node.key}|${rate.className}`,
          kind: "stalled" as const,
          nodeKey: node.key,
          label: groupLabel(node),
          text: outputLine(rate),
          mark: stalledOf(node.stateCounts),
          word: stalledStateText(node.stateCounts),
        },
      })),
    )
    .sort((a, b) => b.lost - a.lost)
    .map((s) => s.item);
  const byMachine = new Map<string, PlannerNode>();
  for (const node of nodes) for (const id of node.machineIds) if (!byMachine.has(id)) byMachine.set(id, node);
  const bottlenecks: AttentionItem[] = [];
  (findings ?? []).forEach((f, i) => {
    const node = byMachine.get(f.buildingId) ?? (f.affected ?? []).map((m) => byMachine.get(m.buildingId)).find((n) => n !== undefined);
    if (node === undefined) return;
    bottlenecks.push({ key: `bottleneck|${i}|${f.buildingId}`, kind: "bottleneck", nodeKey: node.key, label: groupLabel(node), text: f.text });
  });
  const unknownEnds = new Map<string, number>();
  for (const x of [...graph.edges, ...(graph.transports ?? [])])
    if (x.destination === "unknown" && inScope.has(x.from)) unknownEnds.set(x.from, (unknownEnds.get(x.from) ?? 0) + 1);
  const unknown = [...unknownEnds].flatMap(([key, count]): AttentionItem[] => {
    const node = inScope.get(key);
    return node === undefined ? [] : [{ key: `unknown|${key}`, kind: "unknownEnd", nodeKey: key, label: groupLabel(node), text: destinationChipText("unknown", count) }];
  });
  return [...stalled, ...bottlenecks, ...unknown];
}

/** One neighbour of a group: the group at the other end, the item and the summed rate between them. */
export interface Neighbour {
  key: string;
  item: string;
  rate: string;
}

export interface Neighbours {
  gets: ReadonlyMap<string, Neighbour[]>;
  sends: ReadonlyMap<string, Neighbour[]>;
  /** Flows that end in storage, the Sink, power and the like, counted per kind: `destinationChipText`'s words. */
  ends: ReadonlyMap<string, string[]>;
}

const itemOf = (f: Pick<AggregateFlow, "itemName" | "itemClassName" | "mixed">) => edgeItemText(f);

/** Every group's neighbours in the graph: belts, pipes and transports between two groups, summed per item and carrier. */
export function neighboursOf(graph: ProductionGraph): Neighbours {
  const gets = new Map<string, Neighbour[]>();
  const sends = new Map<string, Neighbour[]>();
  const push = (map: Map<string, Neighbour[]>, key: string, n: Neighbour) => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [n]);
    else list.push(n);
  };
  for (const f of aggregateFlows(flowParts(graph), (k) => k)) {
    const rate = aggregateRateText(f);
    push(sends, f.from, { key: f.to, item: itemOf(f), rate });
    push(gets, f.to, { key: f.from, item: itemOf(f), rate });
  }
  const counts = new Map<string, Map<string, number>>();
  for (const x of [...graph.edges, ...(graph.transports ?? [])]) {
    if (destinationPhrase(x.destination) === null || x.destination === undefined) continue;
    const per = counts.get(x.from) ?? new Map<string, number>();
    per.set(x.destination, (per.get(x.destination) ?? 0) + 1);
    counts.set(x.from, per);
  }
  const ends = new Map([...counts].map(([key, per]) => [key, [...per].map(([d, n]) => destinationChipText(d, n))]));
  return { gets, sends, ends };
}

/** One row of the "All connections" table: five columns, and the capacity and the flow in the row's detail. */
export interface OutlineConnection {
  key: string;
  /** The ends' keys (groups, or factories on the overview), so a row can say which rows it joins. */
  fromKey: string;
  toKey: string;
  from: string;
  to: string;
  item: string;
  /** How an inferred item was found; null when the data named it. */
  itemNote: string | null;
  rate: string;
  /** The number the Rate column sorts by; null (unknown) sorts last. */
  rateSort: number | null;
  carrier: string;
  capacity: string | null;
  flow: string;
}

/**
 * An opened site's or factory's connections (`connectionRows`), each end named by `labelOf`. Keyed by the row's own key
 * and its count among equal keys, not its index, so a poll that adds or drops a row keeps an open Details on its row.
 */
export function groupConnections(rows: readonly ConnectionRow[], labelOf: (key: string) => string): OutlineConnection[] {
  const seen = new Map<string, number>();
  return rows.map((row) => ({
    key: `${row.key}|${nthOf(seen, row.key)}`,
    fromKey: row.from,
    toKey: row.to,
    from: labelOf(row.from),
    to: labelOf(row.to),
    item: edgeItemText(row),
    itemNote: row.itemClassName === null ? null : itemFromText(row.itemFrom),
    rate: rateText(row.rate, row.ratePerMinute, row.unit),
    rateSort: row.rate === "unknown" ? null : row.ratePerMinute,
    carrier: carrierText(row),
    capacity: row.capacityPerMinute === null ? null : edgeCapacityText({ kind: row.carrier === "pipe" ? "pipe" : "belt", capacityPerMinute: row.capacityPerMinute }),
    flow: flowText(row.flow, row.destination),
  }));
}

/** The overview's connections: the flows between the level's cards (`aggregateFlows`), each end a factory's name. */
export function factoryConnections(flows: readonly AggregateFlow[], nameOf: ReadonlyMap<string, string>): OutlineConnection[] {
  const seen = new Map<string, number>();
  return flows.map((f) => {
    const key = [f.from, f.to, f.itemClassName ?? "", f.carrier, f.flow, f.unit].join("\u0001");
    return connectionOf(f, `${key}|${nthOf(seen, key)}`, nameOf);
  });
}

/** How many times `key` was seen before (0 the first time), counted in `seen`. */
function nthOf(seen: Map<string, number>, key: string): number {
  const n = seen.get(key) ?? 0;
  seen.set(key, n + 1);
  return n;
}

function connectionOf(f: AggregateFlow, key: string, nameOf: ReadonlyMap<string, string>): OutlineConnection {
  return {
    key,
    fromKey: f.from,
    toKey: f.to,
    from: nameOf.get(f.from) ?? "Factory not listed",
    to: nameOf.get(f.to) ?? "Factory not listed",
    item: itemOf(f),
    itemNote: null,
    rate: aggregateRateText(f),
    rateSort: f.quality === "unknown" ? null : f.ratePerMinute,
    carrier: carrierWord(f.carrier),
    capacity: null,
    flow: flowText(f.flow, undefined),
  };
}

export type SortColumn = "from" | "to" | "item" | "rate" | "carrier";
export type SortOrder = { column: SortColumn; descending: boolean } | null;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** The rows in the table's order: as given until a header is chosen; an unknown rate sorts last either way. */
export function sortConnections(rows: readonly OutlineConnection[], order: SortOrder): OutlineConnection[] {
  if (order === null) return [...rows];
  const { column, descending } = order;
  const sign = descending ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      if (column === "rate") {
        const x = a.row.rateSort;
        const y = b.row.rateSort;
        if (x === null || y === null) return x === y ? a.i - b.i : x === null ? 1 : -1;
        return sign * (x - y) || a.i - b.i;
      }
      return sign * collator.compare(a.row[column], b.row[column]) || a.i - b.i;
    })
    .map(({ row }) => row);
}
