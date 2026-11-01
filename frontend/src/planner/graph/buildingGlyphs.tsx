import type { ReactNode } from "react";
import { ownValue } from "@satisfactory-dash/shared";
import type { GlyphKind } from "./buildingIcons";

/**
 * The generic glyphs a Planner card wears when its building class has no icon (ADR-0053): inline SVG, drawn in token
 * classes (`stroke-fg`), no colour of their own, one per kind of node. Each is centred on the origin of a 24 x 24 box so a
 * caller can put it in a chip with `translate` and `scale`. Copied from how `transportGlyphs.tsx` does the transport modes.
 */
export const GLYPH_BOX = 24;

const SHAPES: Record<GlyphKind, ReactNode> = {
  machines: <path d="M-9 8V-1l6 3V-1l6 3V-9h6v17zM-9 8h18" />,
  storage: (
    <>
      <rect x={-8} y={-7} width={16} height={14} rx={2} />
      <path d="M-8 -2h16M-3 2h6" />
    </>
  ),
  extractor: <path d="M-7 -8h14M0 -8v14M-4 2l4 6 4-6" />,
  station: <path d="M-9 8h18M-5 8V-8h10v16M-5 -2h10M-1 3h2" />,
  power: <path d="M2 -10l-8 12h6l-2 8 8-12h-6z" />,
  consumer: <path d="M-9 -8h18l-7 9v8h-4v-8z" />,
  // A clock: built from conveyor data older than the factory read (#728 cause 11).
  stale: (
    <>
      <circle r={9} />
      {/* Hands, and ticks at 12, 3, 6 and 9, so it never reads as the unknown glyph's circle at chip size. */}
      <path d="M0 -5v5l4 2.5M0 -9v2M9 0h-2M0 9v-2M-9 0h2" />
    </>
  ),
  unknown: (
    <>
      <circle r={9} />
      <path d="M-3 -3a3 3 0 1 1 4 3c-1 1-1 1.5-1 3" />
      <circle cx={0} cy={6} r={0.6} />
    </>
  ),
};

/**
 * The glyph for a kind, centred on the origin; a kind this build does not know draws the "unknown" one. `tone` and
 * `strokeWidth` let a caller on another background keep it legible (a destination cap draws it dark and heavier on its light
 * chip, ADR-0062 Decision 1).
 */
export function BuildingGlyph({ kind, tone = "stroke-fg", strokeWidth = 1.75 }: { kind: GlyphKind; tone?: string; strokeWidth?: number }) {
  const shape = ownValue(SHAPES, kind);
  return (
    <g data-building-glyph={shape === undefined ? "unknown" : kind} aria-hidden="true" fill="none" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={tone}>
      {shape ?? SHAPES.unknown}
    </g>
  );
}
