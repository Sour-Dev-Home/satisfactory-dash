import { motionPathAround } from "./edgeShapes";
import { isTransport, labelBox, type LaidEdge } from "./layoutSite";
import { GLYPH_MAX_S, GLYPH_MIN_S, GLYPH_MOVE_MAX, GLYPH_SPEED, routeBox, type Box } from "./marching";
import { GLYPH_HALO_RADIUS } from "./transportModes";
import { isInView, type Stage, type View } from "./viewport";

/**
 * The transport glyphs that move (ADR-0055 PR 8b; ADR-0062 amendment Decision 6, build PR 4): a transport's line is a still
 * double line and its glyph rides it instead, drawn in SiteGraph's `MarchLayer` (never in the canvas, whose any animation
 * repainted it whole, #808). Kept apart from `marching.ts`, which the e2e specs import, so they never pull in the layout.
 */

type GlyphEdge = Pick<LaidEdge, "index" | "flow" | "points" | "length" | "labelX" | "labelY" | "labelWidth" | "labelHeight"> & Partial<Pick<LaidEdge, "endLabels">>;

/** A transport whose glyph could move: its edge, the path it rides, one trip's seconds and its route's bounds. */
export interface GlyphCandidate<E extends GlyphEdge = GlyphEdge> {
  edge: E;
  /** The route minus its own label box and end labels, grown by the glyph's halo (`motionPathAround`), so it never crosses them. */
  path: string;
  seconds: number;
  box: Box;
}

/**
 * The transports whose glyph could move, in edge order: every transport edge but a stalled one in marks mode (ADR-0062
 * Decision 2; words mode is today's canvas) and one whose route lies wholly in its own label boxes (nothing left to ride: the
 * glyph stays at rest). Per layout and state style, not per view, so a pan only tests boxes.
 */
export function glyphCandidates<E extends GlyphEdge>(edges: readonly E[], marks: boolean): GlyphCandidate<E>[] {
  const out: GlyphCandidate<E>[] = [];
  for (const e of edges) {
    if (!isTransport(e.flow) || e.points.length < 2 || (marks && e.flow.stalled !== undefined)) continue;
    // Its end labels too (ADR-0063 Decision 2): they sit over the line's first legs, so a glyph riding there crossed their words.
    const ends = e.endLabels === undefined ? [] : [e.endLabels.src.box, e.endLabels.tgt.box];
    const path = motionPathAround(e.points, [labelBox(e), ...ends], GLYPH_HALO_RADIUS + 1);
    if (path === null) continue;
    out.push({ edge: e, path, seconds: Math.min(GLYPH_MAX_S, Math.max(GLYPH_MIN_S, e.length / GLYPH_SPEED)), box: routeBox(e.points) });
  }
  return out;
}

/** The glyphs that move at this view: each candidate whose route's bounds meet the stage, in order, until `cap`. */
export function movingGlyphs<E extends GlyphEdge>(candidates: readonly GlyphCandidate<E>[], view: View, stage: Stage, cap = GLYPH_MOVE_MAX): GlyphCandidate<E>[] {
  const out: GlyphCandidate<E>[] = [];
  for (const c of candidates) {
    if (out.length >= cap) break;
    if (isInView(view, stage, c.box)) out.push(c);
  }
  return out;
}
