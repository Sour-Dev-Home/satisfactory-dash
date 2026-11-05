import { edgeKeyOf } from "./bubbleRow";
import type { Reach } from "./graphModel";
import type { LaidEdge } from "./layoutSite";

/**
 * What the canvas draws lit and what it dims (ADR-0063 Decision 3), in one pure rule. The first state that applies wins:
 *
 * 1. Item focus (ADR-0060, hop-1): the focused line and its two cards.
 * 3. The item filter: `reachFor` of the item, every line that carries it or joins two groups on its walk.
 *
 * Otherwise everything is lit. States 2, 4 and 5 (and the emphasis) come with build PR 5; the highlight (3a) dims nothing
 * since the owner dropped that (2026-11-03), so it is not a state here.
 */
export interface FocusSet {
  /** Is anything dimmed at all. */
  readonly dims: boolean;
  card(key: string): boolean;
  edge(e: Pick<LaidEdge, "flow" | "parts">): boolean;
}

/** The focused line: its key (`edgeKeyOf`, stable across layouts, unlike its index) and its two cards. */
export interface FocusedLine {
  readonly edgeKey: string;
  readonly from: string;
  readonly to: string;
}

const ALL_LIT: FocusSet = { dims: false, card: () => true, edge: () => true };

export function focusSet(focused: FocusedLine | null, reach: Reach | null): FocusSet {
  if (focused !== null) {
    return {
      dims: true,
      card: (key) => key === focused.from || key === focused.to,
      edge: (e) => edgeKeyOf(e.flow) === focused.edgeKey,
    };
  }
  if (reach !== null) {
    return {
      dims: true,
      card: (key) => reach.nodes.has(key),
      edge: (e) => e.parts.some((i) => reach.edges.has(i)),
    };
  }
  return ALL_LIT;
}
