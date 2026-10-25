import type { PlannerEdge, PlannerNode } from "@satisfactory-dash/shared";
import { edgeRateText, outputLine } from "../plannerText";

// What a node card says and what an edge label says. One place, so the layout sizes exactly the text the canvas draws.

/** Longest line a card prints; a longer body text wraps at a space onto a further line, up to MAX_WRAP_LINES, then is cut with an ellipsis. */
export const MAX_LINE_CHARS = 22;
/** The heading is larger type, so fewer characters fit the same card width. */
export const MAX_TITLE_CHARS = 18;
export const MAX_WRAP_LINES = 2;
const MAX_OUTPUT_LINES = 2;

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

/** "Iron Ingot: 120 / 120 items/min" with no-break spaces after the colon, so a wrap leaves the figures and their unit together. */
function keepFigures(line: string): string {
  const at = line.indexOf(": ");
  return at < 0 ? line : line.slice(0, at + 2) + line.slice(at + 2).replaceAll(" ", " ");
}

/** The card's heading, "8× Constructor" (a single machine has no count). */
export const nodeTitle = (node: Pick<PlannerNode, "name" | "count">) => cut(node.count > 1 ? `${node.count}× ${node.name}` : node.name, MAX_TITLE_CHARS);

/**
 * The card's body lines after the title: recipe, up to two outputs (actual over max), a loop marker; a long one wraps. Never
 * empty. `recipeLines` is how many leading lines are the recipe (drawn muted).
 */
export function nodeBody(node: PlannerNode): { lines: string[]; recipeLines: number } {
  const recipe = wrapText(node.recipe ?? "No recipe");
  const lines = [...recipe];
  if (node.products.length === 0) lines.push("No output data");
  else {
    for (const rate of node.products.slice(0, MAX_OUTPUT_LINES)) lines.push(...wrapText(keepFigures(outputLine(rate))));
    const more = node.products.length - MAX_OUTPUT_LINES;
    if (more > 0) lines.push(`+${more} more ${more === 1 ? "output" : "outputs"}`);
  }
  if (node.loop) lines.push("In a loop");
  return { lines, recipeLines: recipe.length };
}

export const nodeBodyLines = (node: PlannerNode): string[] => nodeBody(node).lines;

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
