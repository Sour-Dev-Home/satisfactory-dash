import type { ReactNode } from "react";
import { machineState } from "../../factory/machineState";
import { cn } from "../../lib/cn";
import type { StalledKind } from "../plannerText";
import { GLYPH_BOX } from "./buildingGlyphs";

/**
 * The stalled-state marks (ADR-0062 Decision 2), one shape per kind so they read without colour: a line stopped at a bar
 * (backed up), a half ring (underfed), pause bars (paused), a dash (idle). Drawn like the building glyphs: centred on the
 * origin of a `GLYPH_BOX` square, strokes in a token class. The colour is the state's own tone from `machineState.ts`, so a
 * mark and the Factory page's word for the same state always agree. Always `aria-hidden`: its word sits beside it, in the
 * `<title>`, the aria text and the outline.
 */
const SHAPES = new Map<StalledKind, ReactNode>([
  ["backedUp", <path key="backedUp" d="M-8 0h8M3 -8v16" />],
  ["underfed", <path key="underfed" d="M-8 4a8 8 0 0 1 16 0" />],
  ["paused", <path key="paused" d="M-4 -7v14M4 -7v14" />],
  ["idle", <path key="idle" d="M-7 0h14" />],
]);

/** The mark for a kind inside the canvas's SVG, centred on the origin; nothing for a kind this build doesn't draw. */
export function StateMarkGlyph({ kind }: { kind: StalledKind }) {
  const shape = SHAPES.get(kind);
  if (shape === undefined) return null;
  return (
    <g
      data-state-mark={kind}
      aria-hidden="true"
      fill="none"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("stroke-current", machineState(kind)?.tone ?? "text-muted")}
    >
      {shape}
    </g>
  );
}

/** The same mark as an inline icon for the DOM (the outline, the Factory page), sized by the caller's class. */
export function StateMark({ kind, className }: { kind: StalledKind; className?: string }) {
  if (!SHAPES.has(kind)) return null;
  const half = GLYPH_BOX / 2;
  return (
    <svg viewBox={`${-half} ${-half} ${GLYPH_BOX} ${GLYPH_BOX}`} aria-hidden="true" focusable="false" className={cn("inline-block size-4 shrink-0", className)}>
      <StateMarkGlyph kind={kind} />
    </svg>
  );
}
