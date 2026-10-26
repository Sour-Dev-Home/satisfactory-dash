import { describe, expect, it } from "vitest";
import { BADGE_W, suggestionTag } from "./cardBadges";
import { BUILDING_ICON_GAP, BUILDING_ICON_SIZE, NODE_PAD_X } from "./layoutSite";

const beside = NODE_PAD_X + BUILDING_ICON_SIZE + BUILDING_ICON_GAP;

describe("suggestionTag", () => {
  it("sits beside the icon on a wide card, and never on a card that is not a suggestion", () => {
    expect(suggestionTag(true, false, 400)).toEqual({ tagX: beside, showTag: true });
    expect(suggestionTag(false, false, 400).showTag).toBe(false);
  });

  it("falls back to the left edge on a card too narrow to hold it beside the icon", () => {
    expect(suggestionTag(true, false, 100)).toEqual({ tagX: NODE_PAD_X, showTag: true });
  });

  it("is left out where it would meet the Bottleneck badge, and kept where both fit", () => {
    // The ui-reviewer's case: a 150-unit card with a finding.
    expect(suggestionTag(true, true, 150).showTag).toBe(false);
    // Tag, gap, gap, badge, gap: the narrowest card where both fit.
    const roomy = beside + 2 * BADGE_W + 2 * 8;
    expect(suggestionTag(true, true, roomy).showTag).toBe(true);
    expect(suggestionTag(true, true, roomy - 1).showTag).toBe(false);
  });
});
