import { BUILDING_ICON_GAP, BUILDING_ICON_SIZE, NODE_PAD_X } from "./layoutSite";

/** The badges that straddle a card's top edge: Bottleneck at the right, Suggestion at the left. */
export const BADGE_W = 88;
export const BADGE_H = 20;
const BADGE_GAP = 8;
/** Where a suggestion's tag sits when the card is wide enough: beside the icon chip, clear of it. */
const TAG_BESIDE_ICON = NODE_PAD_X + BUILDING_ICON_SIZE + BUILDING_ICON_GAP;

/**
 * A suggested card's "Suggestion" tag: beside the icon when the card is wide enough, else at the left edge. It is left
 * out when it would meet the Bottleneck badge; the dotted outline, Keep and the card's names still say it is one.
 */
export function suggestionTag(suggested: boolean, bottleneck: boolean, width: number): { tagX: number; showTag: boolean } {
  const tagX = width >= TAG_BESIDE_ICON + BADGE_W + BADGE_GAP ? TAG_BESIDE_ICON : NODE_PAD_X;
  const meetsBadge = bottleneck && tagX + BADGE_W + BADGE_GAP > width - BADGE_W - BADGE_GAP;
  return { tagX, showTag: suggested && !meetsBadge };
}
