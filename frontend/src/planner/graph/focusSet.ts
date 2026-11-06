import type { ProductionGraph } from "@satisfactory-dash/shared";
import { edgeKeyOf } from "./bubbleRow";
import type { Reach } from "./graphModel";
import { remoteInfo, type FactoryModel } from "./hierarchy";
import type { LaidEdge } from "./layoutSite";

/**
 * What the canvas draws lit, what it dims and what it emphasises (ADR-0063 Decision 3), in one pure rule. The first state
 * that applies wins:
 *
 * 1. Item focus (ADR-0060, hop-1): the focused line and its two cards.
 * 2. Show what a card feeds and needs: the card and everything upstream and downstream of it (`reachFromCard`).
 * 3. The item filter: `reachFor` of the item, every line that carries it or joins two groups on its walk.
 * 4. A card selected (its group panel open, in an opened factory or site): the card, its hop-1 neighbours and the lines
 *    between it and them.
 * 5. Nothing selected, an opened factory: its groups outside the home site dim, with their lines; the groups that make its
 *    products are emphasised.
 * 6. Otherwise everything is lit.
 *
 * A line is lit only when both its cards are, except in item focus (the focused line alone) and under a walk (2, 3), where
 * a line is lit when the walk lit it. States 2, 4 and 5 came with ports (build PR 5); the highlight (3a) dims
 * nothing since the owner dropped that (2026-11-03), so it is not a state here.
 */
export interface FocusSet {
  /** Which state applies (6: nothing dims). */
  readonly state: 1 | 2 | 3 | 4 | 5 | 6;
  /** Is anything dimmed at all. */
  readonly dims: boolean;
  card(key: string): boolean;
  edge(e: Pick<LaidEdge, "flow" | "parts">): boolean;
  /** A card drawn with the heavier border (state 5: it makes the factory's product). */
  emphasised(key: string): boolean;
}

/** The focused line: its key (`edgeKeyOf`, stable across layouts, unlike its index) and its two cards. */
export interface FocusedLine {
  readonly edgeKey: string;
  readonly from: string;
  readonly to: string;
}

/** The states that came with ports (2, 4 and 5). */
export interface MoreFocus {
  /** State 2: `reachFromCard` of the card whose "Show what … feeds and needs" is on. */
  cardReach?: Reach | null | undefined;
  /** State 4: the card whose panel is open, and its hop-1 neighbours. */
  selected?: { key: string; neighbours: ReadonlySet<string> } | null | undefined;
  /** State 5: an opened factory's cards outside its home site, and the cards that make its products. */
  context?: { outside: ReadonlySet<string>; products: ReadonlySet<string> } | null | undefined;
}

/**
 * State 5's input for an opened factory: its cards whose groups all stand outside its home site (`remoteInfo`, owner answer 1:
 * "raw inputs from outside the factory"), and its cards that make one of its products (owner answer 3).
 */
export function factoryContextOf(
  graph: ProductionGraph,
  model: FactoryModel,
  cards: readonly { key: string; card: { nodeKeys: readonly string[] } }[],
): { outside: Set<string>; products: Set<string> } {
  const remote = remoteInfo(graph, model);
  const productClasses = new Set(model.factory.products.map((p) => p.className));
  const nodeByKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const outside = new Set<string>();
  const products = new Set<string>();
  for (const c of cards) {
    const keys = c.card.nodeKeys;
    if (keys.length > 0 && keys.every((k) => remote.has(k))) outside.add(c.key);
    if (keys.some((k) => nodeByKey.get(k)?.products.some((p) => productClasses.has(p.className)) === true)) products.add(c.key);
  }
  return { outside, products };
}

const NONE = () => false;
const ALL_LIT: FocusSet = { state: 6, dims: false, card: () => true, edge: () => true, emphasised: NONE };

const walk = (state: 2 | 3, reach: Reach): FocusSet => ({
  state,
  dims: true,
  card: (key) => reach.nodes.has(key),
  edge: (e) => e.parts.some((i) => reach.edges.has(i)),
  emphasised: NONE,
});

export function focusSet(focused: FocusedLine | null, reach: Reach | null, more: MoreFocus = {}): FocusSet {
  if (focused !== null) {
    return {
      state: 1,
      dims: true,
      card: (key) => key === focused.from || key === focused.to,
      edge: (e) => edgeKeyOf(e.flow) === focused.edgeKey,
      emphasised: NONE,
    };
  }
  const { cardReach = null, selected = null, context = null } = more;
  if (cardReach !== null) return walk(2, cardReach);
  if (reach !== null) return walk(3, reach);
  if (selected !== null) {
    const lit = (key: string) => key === selected.key || selected.neighbours.has(key);
    return {
      state: 4,
      dims: true,
      card: lit,
      edge: (e) => (e.flow.from === selected.key && lit(e.flow.to)) || (e.flow.to === selected.key && lit(e.flow.from)),
      emphasised: NONE,
    };
  }
  if (context !== null && (context.outside.size > 0 || context.products.size > 0)) {
    const lit = (key: string) => !context.outside.has(key);
    return {
      state: 5,
      dims: context.outside.size > 0,
      card: lit,
      edge: (e) => lit(e.flow.from) && lit(e.flow.to),
      // A product group outside the home site is dimmed, not emphasised: a heavier border on a greyed card reads as both.
      emphasised: (key) => context.products.has(key) && !context.outside.has(key),
    };
  }
  return ALL_LIT;
}
