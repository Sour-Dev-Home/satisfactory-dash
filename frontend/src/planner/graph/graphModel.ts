import type { PlannerEdge, PlannerNode, PlannerRate } from "@satisfactory-dash/shared";
import { formatAmount } from "../../format";
import { edgeRateText, hasMax, isZeroRate, outputLine, stalledStateText } from "../plannerText";

// What a node card says and what an edge label says. One place, so the layout sizes exactly the text the canvas draws.

/** Longest line a card prints; a longer body text wraps at a space onto a further line, up to MAX_WRAP_LINES, then is cut with an ellipsis. */
export const MAX_LINE_CHARS = 22;
/** The heading is larger type, so fewer characters fit the same card width. */
export const MAX_TITLE_CHARS = 18;
export const MAX_WRAP_LINES = 2;

const cut = (text: string, max = MAX_LINE_CHARS) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * `text` as at most `maxLines` lines of at most `max` characters, broken at spaces (a word longer than a line is cut). What
 * does not fit the last line ends in an ellipsis (the full text stays in the node's tooltip and the tables). Pure.
 */
export function wrapText(text: string, max = MAX_LINE_CHARS, maxLines = MAX_WRAP_LINES): string[] {
  const lines: string[] = [];
  let rest = text.trim();
  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= max) {
      lines.push(rest);
      rest = "";
      break;
    }
    if (lines.length === maxLines - 1) {
      lines.push(cut(rest, max));
      rest = "";
      break;
    }
    const space = rest.lastIndexOf(" ", max);
    const at = space > 0 ? space : max;
    lines.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  return lines.length > 0 ? lines : [""];
}

/** The card's heading, "8× Constructor" (a single machine has no count). */
export const nodeTitle = (node: Pick<PlannerNode, "name" | "count">) => cut(node.count > 1 ? `${node.count}× ${node.name}` : node.name, MAX_TITLE_CHARS);

/** Longest summary line a card prints (the full words are in its tooltip, its keyboard name and the side panel). */
export const MAX_SUMMARY_CHARS = 26;
/** What a building with no name is called, so no card, tooltip or button name is ever empty. */
export const UNKNOWN_BUILDING = "Unknown building";

/** A name that is never blank: the given one, else the fallback. */
export const nameOr = (name: string | null | undefined, fallback: string): string => (name === null || name === undefined || name.trim() === "" ? fallback : name);

/** A node whose name came blank gets its class name, else "Unknown building", so no title, label or heading is ever empty. */
export const withName = <T extends Pick<PlannerNode, "name" | "className">>(node: T): T => (node.name.trim() === "" ? { ...node, name: nameOr(node.className, UNKNOWN_BUILDING) } : node);

/**
 * One product as a card's single line, "Iron Plate · 72/min" (a fluid says "m³/min"), cut to `MAX_SUMMARY_CHARS`; the
 * maximum is in the tooltip. A rate that reads 0 shows its maximum, "Iron Ingot · 0 of 30/min" (#728 step 2).
 */
export function productSummary(rate: PlannerRate): string {
  const per = `${rate.unit === "m3/min" ? " m³" : ""}/min`;
  const zero = isZeroRate(rate);
  const amount = zero && hasMax(rate) ? `${formatAmount(0)} of ${formatAmount(rate.maxPerMinute)}` : formatAmount(rate.currentPerMinute);
  const name = nameOr(rate.name, rate.className);
  const tail = ` · ${amount}${per}`;
  // A 0 is only honest with its maximum: a long name gives way, the tail is never the part cut off.
  return zero ? `${cut(name, Math.max(1, MAX_SUMMARY_CHARS - tail.length))}${tail}` : cut(`${name}${tail}`, MAX_SUMMARY_CHARS);
}

/**
 * The muted line under a card whose main product reads 0: its machines' state, "Backed up" or "Not producing" (#728
 * step 2). Null for a running card, or one with no product.
 */
export function stalledNote(rate: PlannerRate | undefined, stateCounts: Record<string, number>): string | null {
  if (rate === undefined || !isZeroRate(rate)) return null;
  const text = stalledStateText(stateCounts);
  return cut(`${text.charAt(0).toUpperCase()}${text.slice(1)}`, MAX_SUMMARY_CHARS);
}

/** A machine whose recipe is unassigned in the game (#728 step 3). */
export const NOT_CONFIGURED = "Not configured";
/** An extractor whose item the backend could not match to a resource node. */
export const RESOURCE_UNKNOWN = "Resource not identified";
/** The muted note after an extractor's item: it is guessed from the node it stands on, and no rate is read. */
export const INFERRED_FROM_NODE = "(inferred from the node)";

/**
 * #728 cause 11: a node built only from conveyor ends that name machines the latest factory read lacks (the backend's
 * `stale`). The conveyor data is read every 10 minutes (the backend's CONNECTIONS_REFRESH_MINUTES), the factory every 30 s.
 */
export const STALE_NODE_NOTE = "Conveyor data older than the factory read · refreshes within 10 minutes";
export const isStaleNode = (node: Pick<PlannerNode, "stale">): boolean => node.stale === true;
/** The card's muted lines for such a node, within the card's line limits (the full words are in the tooltip and tables). */
export const staleNodeLines = (): string[] => wrapText(STALE_NODE_NOTE);

/**
 * What an extractor without output data mines (#728 step 1): the backend's `resource` (the node within 20 m), else an
 * honest "Resource not identified". Null for anything else, or for an extractor that does have output data.
 */
export function extractorOutput(node: Pick<PlannerNode, "kind" | "products" | "resource">): { name: string; inferred: boolean } | null {
  if (node.kind !== "extractor" || node.products.length > 0) return null;
  const name = nameOr(node.resource?.name, nameOr(node.resource?.className, "")).trim();
  return name === "" ? { name: RESOURCE_UNKNOWN, inferred: false } : { name, inferred: true };
}

/** The same for a bubble of groups: only when every group is such an extractor and they agree on the resource. */
export function groupsExtractorOutput(nodes: readonly Pick<PlannerNode, "kind" | "products" | "resource">[]): { name: string; inferred: boolean } | null {
  const outs = nodes.map(extractorOutput);
  const first = outs[0];
  if (first === undefined || first === null) return null;
  return outs.every((o) => o !== null && o.name === first.name && o.inferred === first.inferred) ? first : null;
}

/** An extractor's output as one line of words: "Iron Ore (inferred from the node)". */
export const extractorOutputText = (out: { name: string; inferred: boolean }): string => (out.inferred ? `${out.name} ${INFERRED_FROM_NODE}` : out.name);

/** The one line a group's card prints: its main product and rate, else an extractor's resource, else "No output data". Never empty. */
export function nodeSummary(node: Pick<PlannerNode, "products"> & Partial<Pick<PlannerNode, "kind" | "resource">>): string {
  if (node.products.length > 0) return productSummary(node.products[0]);
  const mined = extractorOutput({ kind: node.kind ?? "", products: node.products, resource: node.resource });
  return mined === null ? "No output data" : cut(mined.name, MAX_SUMMARY_CHARS);
}

/**
 * The recipe in words: the recipe, "Not configured" for a machine without one, and null where none is shown (an extractor,
 * storage, a station, a consumer such as a sink or a generator, or a building of unknown kind).
 */
export function recipeText(node: Pick<PlannerNode, "kind" | "recipe">): string | null {
  const recipe = nameOr(node.recipe, "");
  if (recipe !== "") return recipe;
  return node.kind === "machines" ? NOT_CONFIGURED : null;
}

const NO_RECIPE_KINDS: ReadonlySet<string> = new Set(["extractor", "storage", "station", "consumer"]);

/** The Recipe cell's words where `recipeText` is null: these kinds have no recipe in the game; of any other, we can't say. */
export const noRecipeCellText = (node: Pick<PlannerNode, "kind">): string => (NO_RECIPE_KINDS.has(node.kind) ? "Not applicable" : "Not known");

/**
 * Everything a group's card no longer prints, in full and unwrapped: the recipe (null where none applies), every output
 * (actual over max, or an extractor's inferred resource), a loop marker. The tooltip, the keyboard name and the side
 * panel all read these.
 */
export function nodeFacts(node: PlannerNode): { recipe: string | null; outputs: string[]; loop: boolean } {
  if (isStaleNode(node)) return { recipe: recipeText(node), outputs: [STALE_NODE_NOTE], loop: node.loop };
  const mined = extractorOutput(node);
  const outputs = mined !== null ? [extractorOutputText(mined)] : node.products.length === 0 ? ["No output data"] : node.products.map((r) => outputLine(r, node.stateCounts));
  return { recipe: recipeText(node), outputs, loop: node.loop };
}

/**
 * An edge's label on the canvas (ADR-0050 Decision 2): the item, then the rate in the table's words ("about" for an
 * estimate), and no number at all for an unknown one; a mixed belt says so.
 */
export function edgeLabel(edge: PlannerEdge): string {
  const parts = [edge.itemName ?? edge.itemClassName ?? "Item unknown"];
  if (edge.rate !== "unknown" && edge.ratePerMinute !== null) parts.push(edgeRateText(edge));
  if (edge.mixed) parts.push("mixed");
  return parts.join(" · ");
}

/**
 * The same label split for the canvas, so a rank gap needs only the longer line: the item (and "mixed" when the belt is),
 * then the rate; an unknown rate has no second line.
 */
export function edgeLabelLines(edge: PlannerEdge): string[] {
  const item = edge.itemName ?? edge.itemClassName ?? "Item unknown";
  const lines = [edge.mixed ? `${item} · mixed` : item];
  if (edge.rate !== "unknown" && edge.ratePerMinute !== null) lines.push(edgeRateText(edge));
  return lines;
}

/** An edge's full words for its tooltip and the accessible text: the label plus how sure the rate is. */
export function edgeTitle(edge: PlannerEdge, from: string, to: string): string {
  const sure = edge.rate === "measured" ? "measured" : edge.rate === "estimated" ? "estimated" : "rate unknown";
  return `${from} to ${to}: ${edgeLabel(edge)} (${sure})`;
}

/** The item a filter option stands for. */
export interface ItemOption {
  className: string;
  name: string;
}

/** The items the site's connections carry, sorted by name; connections whose item could not be inferred are left out. */
export function siteItems(edges: readonly Pick<PlannerEdge, "itemClassName" | "itemName">[]): ItemOption[] {
  const byClass = new Map<string, string>();
  for (const e of edges) if (e.itemClassName !== null) byClass.set(e.itemClassName, e.itemName ?? e.itemClassName);
  return [...byClass].map(([className, name]) => ({ className, name })).sort((a, b) => a.name.localeCompare(b.name) || a.className.localeCompare(b.className));
}

/** What an item filter lights up. */
export interface Reach {
  nodes: ReadonlySet<string>;
  /** Indexes into the edge list the walk was given. */
  edges: ReadonlySet<number>;
}

function closure(seeds: Iterable<string>, next: ReadonlyMap<string, string[]>): Set<string> {
  const seen = new Set(seeds);
  const stack = [...seen];
  while (stack.length > 0) {
    for (const n of next.get(stack.pop()!) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

/**
 * The reachability walk of ADR-0050 Decision 4, on the coarse graph. The seeds are the groups at either end of a
 * connection that carries the item: upstream from the groups it leaves (what feeds them) and downstream from the groups
 * it arrives at (what they feed). A connection is lit when it carries the item or both its ends are on one walk.
 */
export function reachFor(itemClassName: string, edges: readonly Pick<PlannerEdge, "from" | "to" | "itemClassName">[]): Reach {
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  const sources = new Set<string>();
  const sinks = new Set<string>();
  for (const e of edges) {
    push(forward, e.from, e.to);
    push(backward, e.to, e.from);
    if (e.itemClassName === itemClassName) {
      sources.add(e.from);
      sinks.add(e.to);
    }
  }
  // Upstream of where the item leaves, downstream of where it arrives: a sibling branch or a second feeder is not lit.
  const up = closure(sources, backward);
  const down = closure(sinks, forward);
  const lit = new Set<number>();
  edges.forEach((e, i) => {
    if (e.itemClassName === itemClassName || (up.has(e.from) && up.has(e.to)) || (down.has(e.from) && down.has(e.to))) lit.add(i);
  });
  return { nodes: new Set([...down, ...up]), edges: lit };
}

/** The canvas's accessible name: counts only, since the tables carry the detail. */
export function graphSummary(nodes: readonly PlannerNode[], edges: readonly PlannerEdge[], siteName: string): string {
  const loops = nodes.filter((n) => n.loop).length;
  const g = `${nodes.length} ${nodes.length === 1 ? "group" : "groups"}`;
  const c = `${edges.length} ${edges.length === 1 ? "connection" : "connections"}`;
  return `Graph of ${siteName}: ${g}, ${c}${loops > 0 ? `, ${loops} in a loop` : ""}. The Tables view lists the same.`;
}
