import type { ReactNode } from "react";
import { GLYPH_HALO_RADIUS } from "./transportModes";

/**
 * The mode icons on a transport edge (ADR-0055 Decision 6): inline SVG, no dependency, drawn in token classes
 * (`stroke-fg`, `fill-surface`, `stroke-line`), and no colour of their own (ADR-0041: no new colour meaning). A glyph is
 * centred on the origin of a 24 x 24 box so the caller can put it on a point with `translate` or move it along a path
 * with `animateMotion`. Train and Depot have data today; the truck and drone glyphs wait for their readers (ADR-0055).
 */

const SHAPES: Record<string, ReactNode> = {
  train: (
    <>
      <rect x={-6} y={-8} width={12} height={13} rx={3} />
      <path d="M-6 -1h12" />
      <circle cx={-3} cy={2.5} r={0.6} />
      <circle cx={3} cy={2.5} r={0.6} />
      <path d="M-4 9l-2 2M4 9l2 2M-3 5l-1 4M3 5l1 4" />
    </>
  ),
  truck: (
    <>
      <path d="M-10 -6h12v10h-12z" />
      <path d="M2 -3h5l3 4v3h-8" />
      <circle cx={-5} cy={5.5} r={2} />
      <circle cx={6} cy={5.5} r={2} />
    </>
  ),
  drone: (
    <>
      <rect x={-3} y={-2.5} width={6} height={5} rx={1.5} />
      <path d="M-3 -2l-4.5 -4.5M3 -2l4.5 -4.5M-3 2l-4.5 4.5M3 2l4.5 4.5" />
      <circle cx={-8} cy={-7} r={2.5} />
      <circle cx={8} cy={-7} r={2.5} />
      <circle cx={-8} cy={7} r={2.5} />
      <circle cx={8} cy={7} r={2.5} />
    </>
  ),
  depot: (
    <>
      <path d="M0 -10l9 5v10l-9 5-9-5v-10z" />
      <path d="M-9 -5l9 5 9-5M0 0v10" />
    </>
  ),
};

/** Any mode this build does not know: a plain arrow, so the edge still says "this is a transport". */
const FALLBACK = <path d="M-8 0h14M1 -6l6 6-6 6" />;

/** The glyph for a transport mode, centred on the origin. `mode` is a game-server string, so the lookup is own-key only. */
export function TransportGlyph({ mode }: { mode: string }) {
  const shape = Object.hasOwn(SHAPES, mode) ? SHAPES[mode] : FALLBACK;
  return (
    <g data-glyph={Object.hasOwn(SHAPES, mode) ? mode : "other"} aria-hidden="true">
      <circle r={GLYPH_HALO_RADIUS} strokeWidth={1} className="fill-surface stroke-line" />
      <g fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="stroke-fg">
        {shape}
      </g>
    </g>
  );
}
