import { useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "../../lib/cn";
import type { LaidEdge, LaidNode } from "./layoutSite";
import { highlightOf, rateAnchor, targetId, type Highlight, type HighlightTarget, type PointerStore } from "./lineHighlight";
import type { Stage, View } from "./viewport";

/**
 * The highlight (ADR-0063 amendment, 2026-11-03), in its own `<svg>` over the canvas and the march layer: the same box,
 * viewBox and pan and zoom, as `MarchLayer`. Pointing at a line or a card (`store`, the mouse) or the keyboard on one
 * (`keyTarget`) lights it: the lit lines' rates are drawn, rising in (`animate-reveal`). Nothing else dims (the owner
 * dropped the dimming, 2026-11-03); item focus and the item filter still dim the canvas their own way.
 *
 * Why a layer and not classes in the canvas: an opacity change or transition inside the canvas `<svg>` repaints the whole
 * canvas (210 lines, cards, icons) for every frame it runs (ADR-0062 amendment build PR 3). Here the canvas is never touched:
 * the layer is its own compositing layer (`will-change-transform`), its fade in and out is that layer's opacity, and a new
 * target repaints only a few words. Decorative (`aria-hidden`) and pointer-transparent: the words are in the lines'
 * `<title>`s, their buttons and the outline.
 */
export function HighlightLayer({
  store,
  keyTarget,
  enabled,
  edges,
  nodes,
  showRates,
  stage,
  viewport,
  shape,
  height,
}: {
  store: PointerStore;
  keyTarget: HighlightTarget | null;
  /** Off during a make-room glide: the layer does not follow gliding cards. */
  enabled: boolean;
  edges: readonly LaidEdge[];
  nodes: readonly LaidNode[];
  /** The zoom draws words (`BubbleDetail.full`): the rates are drawn only then, as on the canvas. */
  showRates: boolean;
  stage: Stage;
  viewport: View;
  shape: string;
  /** The canvas's own height attribute (see `MarchLayer`). */
  height: number;
}) {
  const pointer = useSyncExternalStore(store.subscribe, store.get, store.get);
  const cardKeys = useMemo(() => new Set(nodes.map((n) => n.key)), [nodes]);
  // A pointer target a poll took away must not mask the keyboard's: fall back to it when the pointer's is not in the picture.
  const pointerHl = useMemo(() => (enabled ? highlightOf(pointer, edges, cardKeys) : null), [enabled, pointer, edges, cardKeys]);
  const keyHl = useMemo(() => (enabled && pointerHl === null ? highlightOf(keyTarget, edges, cardKeys) : null), [enabled, pointerHl, keyTarget, edges, cardKeys]);
  const hl = pointerHl ?? keyHl;
  const target = pointerHl !== null ? pointer : keyHl !== null ? keyTarget : null;
  // The last highlight stays drawn while the layer fades out. Adjusting state while rendering, guarded so it settles in one pass.
  const [shown, setShown] = useState<{ id: string; hl: Highlight } | null>(null);
  if (hl !== null && target !== null && (shown === null || shown.hl !== hl)) setShown({ id: targetId(target), hl });
  const active = hl !== null;
  const lit = shown?.hl;
  const litEdges = lit === undefined ? [] : edges.filter((e) => lit.edges.has(e.index));
  return (
    <svg
      aria-hidden="true"
      data-highlight-layer=""
      data-highlight={active ? "" : undefined}
      viewBox={`0 0 ${stage.width} ${stage.height}`}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      className={cn(
        "pointer-events-none absolute top-0 left-0 max-h-graph-max min-h-graph-min w-full rounded-card border border-transparent transition-opacity will-change-transform",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      {shown !== null && showRates && (
        <g key={shape} transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
          <g key={shown.id} data-highlight-rates="" className="animate-reveal">
            {litEdges.map((e) => {
              // A line with end labels (ADR-0063 Decision 2) shows its rate in both labels' rate rows, where the canvas keeps
              // them hidden with a mouse; one without, in the middle under its bubbles.
              if (e.endLabels !== undefined) {
                return [e.endLabels.src, e.endLabels.tgt].map((l, i) =>
                  l.rate === "" ? null : (
                    <text key={`${e.index}-${i}`} x={l.x} y={l.rateY} textAnchor={l.anchor} dominantBaseline="central" strokeWidth={4} data-highlight-rate={e.index} className="fill-fg stroke-surface text-sm paint-stroke-first">
                      {l.rate}
                    </text>
                  ),
                );
              }
              const at = rateAnchor(e);
              return (
                <text key={e.index} x={at.x} y={at.y} textAnchor="middle" dominantBaseline="central" strokeWidth={4} data-highlight-rate={e.index} className="fill-fg stroke-surface text-sm paint-stroke-first">
                  {e.bubbles.rateText}
                </text>
              );
            })}
          </g>
        </g>
      )}
    </svg>
  );
}
