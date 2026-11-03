import { useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "../../lib/cn";
import { BUBBLE_D } from "./bubbleRow";
import { roundedOrthogonalPath } from "./edgeShapes";
import { LABEL_LINE_H, LABEL_PAD, isTransport, type LaidEdge, type LaidNode } from "./layoutSite";
import { highlightOf, targetId, type Highlight, type HighlightMode, type HighlightTarget, type PointerStore } from "./lineHighlight";
import { marchHoles } from "./marching";
import { GLYPH_HALO_RADIUS } from "./transportModes";
import type { Stage, View } from "./viewport";

/** How wide a lit line's hole in the cover is: past the arrowhead's 8-unit base, short of the next track (`TRACK_GAP` 12). */
export const HIGHLIGHT_LINE_HOLE = 10;
/** A stalled line's: its stop bar is 12 tall. */
export const HIGHLIGHT_STALLED_HOLE = 13;
/** A transport's: its glyph and halo, which ride the line. */
export const HIGHLIGHT_TRANSPORT_HOLE = 2 * GLYPH_HALO_RADIUS;
/** How far the cover reaches past the picture, as the march layer's mask does: a line's arrowhead or a badge sticks out. */
const COVER_PAD = 50;

/** Where a line's rate text sits: centred under its bubbles, in the row its label box keeps for it. The canvas's
 *  `EdgeLabel` and this layer both use it, so the lit rate lies exactly on the canvas's own (hidden) one. */
export function rateAnchor(e: Pick<LaidEdge, "labelY" | "labelHeight" | "textX">): { x: number; y: number } {
  const top = e.labelY - e.labelHeight / 2 + LABEL_PAD / 2;
  return { x: e.textX, y: top + BUBBLE_D + LABEL_LINE_H / 2 };
}

const holeWidth = (e: LaidEdge): number => (isTransport(e.flow) ? HIGHLIGHT_TRANSPORT_HOLE : e.flow.stalled !== undefined ? HIGHLIGHT_STALLED_HOLE : HIGHLIGHT_LINE_HOLE);

/**
 * The highlight (ADR-0063 amendment, 2026-11-03), in its own `<svg>` over the canvas and the march layer: the same box,
 * viewBox and pan and zoom, as `MarchLayer`. Pointing at a line or a card (`store`, the mouse) or the keyboard on one
 * (`keyTarget`) lights it; then, in `dim` mode, a canvas-coloured cover at `--opacity-graph-cover` lies over everything with
 * holes for what is lit (its cards with their badges and pills, its lines, its labels), which looks as the item focus's
 * `--opacity-graph-dim` does (a quarter of the thing over the canvas colour), and the lit lines' rates are drawn on top,
 * rising in (`animate-reveal`).
 *
 * Why a layer and not classes in the canvas: an opacity change or transition inside the canvas `<svg>` repaints the whole
 * canvas (210 lines, cards, icons) for every frame it runs (ADR-0062 amendment build PR 3). Here the canvas is never touched:
 * the layer is its own compositing layer (`will-change-transform`), its fade in and out is that layer's opacity, and a new
 * target repaints only this layer's cover and a few words. Decorative (`aria-hidden`) and pointer-transparent: the words
 * are in the lines' `<title>`s, their buttons and the outline.
 */
export function HighlightLayer({
  store,
  keyTarget,
  mode,
  enabled,
  edges,
  nodes,
  decor,
  showRates,
  bounds,
  stage,
  viewport,
  shape,
  maskId,
  height,
}: {
  store: PointerStore;
  keyTarget: HighlightTarget | null;
  mode: HighlightMode;
  /** Off during a make-room glide: the layer does not follow gliding cards. */
  enabled: boolean;
  edges: readonly LaidEdge[];
  nodes: readonly LaidNode[];
  /** How tall the controls a card centres on its top and bottom edges are (`marchHoles`' `decor`). */
  decor: number;
  /** The zoom draws words (`BubbleDetail.full`): the rates are drawn only then, as on the canvas. */
  showRates: boolean;
  bounds: { width: number; height: number };
  stage: Stage;
  viewport: View;
  shape: string;
  maskId: string;
  /** The canvas's own height attribute (see `MarchLayer`). */
  height: number;
}) {
  const pointer = useSyncExternalStore(store.subscribe, store.get, store.get);
  const target = enabled ? (pointer ?? keyTarget) : null;
  const cardKeys = useMemo(() => new Set(nodes.map((n) => n.key)), [nodes]);
  const hl = useMemo(() => highlightOf(target, edges, cardKeys), [target, edges, cardKeys]);
  // The last highlight stays drawn while the layer fades out. Adjusting state while rendering, guarded so it settles in one pass.
  const [shown, setShown] = useState<{ id: string; hl: Highlight } | null>(null);
  if (hl !== null && target !== null && (shown === null || shown.hl !== hl)) setShown({ id: targetId(target), hl });
  const active = hl !== null;
  const lit = shown?.hl;
  const litEdges = lit === undefined ? [] : edges.filter((e) => lit.edges.has(e.index));
  const litNodes = lit === undefined ? [] : nodes.filter((n) => lit.cards.has(n.key));
  const cover = mode === "dim";
  const pad = { x: -COVER_PAD, y: -COVER_PAD, width: bounds.width + 2 * COVER_PAD, height: bounds.height + 2 * COVER_PAD };
  return (
    <svg
      aria-hidden="true"
      data-highlight-layer=""
      data-highlight={active ? mode : undefined}
      viewBox={`0 0 ${stage.width} ${stage.height}`}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      className={cn(
        "pointer-events-none absolute top-0 left-0 max-h-map min-h-graph-min w-full rounded-card border border-transparent transition-opacity will-change-transform",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      {shown !== null && cover && (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" {...pad}>
            {/* A luminance mask: white covers, black is a hole. Not colours of the picture, so no theme token. */}
            <rect {...pad} className="fill-white" />
            {marchHoles(litNodes, litEdges, decor).map((h, i) => (
              <rect key={i} x={h.x} y={h.y} width={h.width} height={h.height} rx={h.rx} className="fill-black" />
            ))}
            {litEdges.map((e) => (
              <path key={e.index} d={roundedOrthogonalPath(e.points)} fill="none" strokeWidth={holeWidth(e)} strokeLinecap="round" className="stroke-black" />
            ))}
          </mask>
        </defs>
      )}
      {shown !== null && (
        <g key={shape} transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
          {cover && <rect {...pad} mask={`url(#${maskId})`} data-highlight-cover="" className="fill-surface opacity-graph-cover" />}
          {showRates && (
            <g key={shown.id} data-highlight-rates="" className="animate-reveal">
              {litEdges.map((e) => {
                const at = rateAnchor(e);
                return (
                  <text key={e.index} x={at.x} y={at.y} textAnchor="middle" dominantBaseline="central" strokeWidth={4} data-highlight-rate={e.index} className="fill-fg stroke-surface text-sm paint-stroke-first">
                    {e.bubbles.rateText}
                  </text>
                );
              })}
            </g>
          )}
        </g>
      )}
    </svg>
  );
}
