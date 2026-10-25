import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Bottleneck, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import { cn } from "../../lib/cn";
import { bottleneckCountText, groupLabel, nodeFindings } from "../plannerText";
import { GroupPanel } from "./GroupPanel";
import { edgeTitle, graphSummary, reachFor, siteItems } from "./graphModel";
import { BUILDING_ICON_SIZE, LABEL_LINE_H, LINE_H, NODE_PAD_X, TITLE_H, layoutSite, type LaidEdge, type LaidNode } from "./layoutSite";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  FALLBACK_STAGE,
  ZOOM_STEP,
  canvasHeight,
  clippedEdges,
  fitView,
  isClipped,
  keyView,
  panBy,
  pinchView,
  revealRect,
  stageBesidePanel,
  toStage,
  zoomAt,
  zoomCentre,
  type Pair,
  type Stage,
  type View,
} from "./viewport";

const ALL_ITEMS = "";
/** A pointer that moved less than this (client pixels) between down and up was a click, not a drag. */
const DRAG_SLOP = 4;
const WHEEL_SENSITIVITY = 0.0015;
const BADGE_W = 88;
const BADGE_H = 20;

const edgePath = (e: LaidEdge) => e.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");

type EdgeStyle = Pick<LaidEdge["edge"], "mixed" | "kind" | "rate">;

/** Stroke colour by what the edge carries (a pipe, a mixed belt), dash by how sure its rate is (Decision 2). */
function edgeClass(e: EdgeStyle) {
  if (e.mixed) return "stroke-warn";
  return e.kind === "pipe" ? "stroke-info" : e.rate === "unknown" ? "stroke-line" : "stroke-muted";
}
const edgeDash = (rate: LaidEdge["edge"]["rate"]) => (rate === "measured" ? undefined : rate === "estimated" ? "8 5" : "2 5");
const edgeWidth = (mixed: boolean) => (mixed ? 3 : 2);

/** The overflow fades, one per edge: where it sits, the gradient direction towards the drawing, and the edge's name. */
const FADES = [
  { edge: "left", className: "inset-y-px left-px w-graph-fade rounded-l-card bg-linear-to-r" },
  { edge: "right", className: "inset-y-px right-px w-graph-fade rounded-r-card bg-linear-to-l" },
  { edge: "top", className: "inset-x-px top-px h-graph-fade rounded-t-card bg-linear-to-b" },
  { edge: "bottom", className: "inset-x-px bottom-px h-graph-fade rounded-b-card bg-linear-to-t" },
] as const;

const ICON_PROPS = { viewBox: "0 0 24 24", "aria-hidden": true, className: "size-5", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** A toolbar button: an icon below `sm` (a 44 px square, the name for assistive tech), the words from `sm` up. */
function ToolButton({ name, icon, onClick, disabled }: { name: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex min-h-touch min-w-touch items-center justify-center">
      <svg {...ICON_PROPS} className="size-5 sm:hidden">
        {icon}
      </svg>
      <span className="sr-only sm:not-sr-only">{name}</span>
    </button>
  );
}

/**
 * ADR-0050 Decision 3 and 4, the graph: dagre's layout of one site drawn as SVG, with pan (drag, arrows), zoom (wheel,
 * buttons, + and -), fit, an item filter that lights what carries the item upstream and downstream, and a side panel
 * for a group's machines. The picture is `role="img"`; the keyboard reaches each group through a list of real buttons
 * beside it (an image's children are presentational, so buttons inside it would be hidden from assistive tech), and the
 * focused group is ringed in the picture. The Tables view is the full text alternative.
 */
export default function SiteGraph({
  site,
  graph,
  findings,
}: {
  site: PlannerSite;
  graph: ProductionGraph;
  findings: readonly Bottleneck[] | undefined;
}) {
  const layout = useMemo(() => layoutSite(site, graph), [site, graph]);
  const nodeByKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n])), [graph]);
  const laidByKey = useMemo(() => new Map(layout.nodes.map((n) => [n.key, n])), [layout]);
  const items = useMemo(() => siteItems(layout.sourceEdges), [layout]);
  const ids = useId();
  const markerId = `${ids}-arrow`;
  const panelId = `${ids}-panel`;

  // The SVG's measured size is the stage (1 unit = 1 CSS px); jsdom has no ResizeObserver and keeps the fallback.
  const [stage, setStage] = useState<Stage>(FALLBACK_STAGE);
  const fit = useMemo(() => fitView(layout.width, layout.height, stage), [layout.width, layout.height, stage]);
  const canvasH = canvasHeight(layout.width, layout.height, stage.width);
  // Until the user pans or zooms the view is the fit, so it follows the measured size; after that it is theirs.
  const [moved, setMoved] = useState<View | null>(null);
  const view = moved ?? fit;
  const viewRef = useRef(view);
  const stageRef = useRef(stage);
  useEffect(() => {
    viewRef.current = view;
    stageRef.current = stage;
  });
  const setView = (change: View | ((v: View) => View)) => setMoved(typeof change === "function" ? change(viewRef.current) : change);
  const [item, setItem] = useState(ALL_ITEMS);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const dragged = useRef(false);

  // A filter item that left the site (a poll changed the edges) falls back to "all items".
  const activeItem = items.some((i) => i.className === item) ? item : ALL_ITEMS;
  const reach = useMemo(() => (activeItem === ALL_ITEMS ? null : reachFor(activeItem, layout.sourceEdges)), [activeItem, layout]);
  // An open group that left the graph (a poll) shows no panel.
  const openNode = openKey === null ? undefined : nodeByKey.get(openKey);
  const clipped = clippedEdges(view, layout, stage);
  const overflowing = isClipped(clipped);
  const panelRef = useRef<HTMLDivElement>(null);

  // From lg the panel is a drawer over the canvas's right side: bring the opened group into the part left of it.
  useEffect(() => {
    const panel = panelRef.current;
    const n = openKey === null ? undefined : laidByKey.get(openKey);
    if (!panel || !n || getComputedStyle(panel).position !== "absolute") return;
    const visible = stageBesidePanel(stageRef.current, panel.offsetWidth);
    setView((v) => revealRect(v, n, visible));
  }, [openKey, laidByKey]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = Math.round(svg.clientWidth);
      const height = Math.round(svg.clientHeight);
      if (width > 0 && height > 0) setStage((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // The wheel needs preventDefault (the page must not scroll), which React's passive listener cannot do.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const p = toStage(svg.getBoundingClientRect(), stageRef.current, event.clientX, event.clientY);
      setView((v) => zoomAt(v, Math.exp(-event.deltaY * WHEEL_SENSITIVITY), p.x, p.y));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // The pointers that are down on the stage (client pixels, last seen): one pans, two pinch and pan together.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const travelled = useRef(0);

  useEffect(() => {
    const toStagePoint = (p: { x: number; y: number }) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const s = rect ? toStage(rect, stageRef.current, p.x, p.y) : p;
      return { x: s.x, y: s.y };
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const next = { x: e.clientX, y: e.clientY };
      if (pointers.current.size === 2) {
        const other = [...pointers.current].find(([id]) => id !== e.pointerId)![1];
        pointers.current.set(e.pointerId, next);
        dragged.current = true;
        const before: Pair = [toStagePoint(prev), toStagePoint(other)];
        const after: Pair = [toStagePoint(next), toStagePoint(other)];
        setView((v) => pinchView(v, before, after));
        return;
      }
      pointers.current.set(e.pointerId, next);
      const rect = svgRef.current?.getBoundingClientRect();
      const scale = rect ? toStage(rect, stageRef.current, 0, 0).scale : 1;
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      travelled.current += Math.abs(dx) + Math.abs(dy);
      if (travelled.current > DRAG_SLOP) {
        dragged.current = true;
        setView((v) => panBy(v, dx / scale, dy / scale));
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (pointers.current.size === 0) {
      dragged.current = false;
      travelled.current = 0;
    }
    // A third finger is not tracked: two define the gesture.
    if (pointers.current.size < 2) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape" && openKey !== null) {
      close();
      return;
    }
    const next = keyView(view, event.key, fit, stage);
    if (next === null) return;
    event.preventDefault();
    setView(next);
  };

  const open = (key: string) => {
    // A drag that ends on a card is not a click on it.
    if (dragged.current) return;
    setOpenKey(key);
  };
  const close = () => {
    const key = openKey;
    setOpenKey(null);
    if (key !== null) buttons.current.get(key)?.focus();
  };
  const focusNode = (n: LaidNode) => {
    setFocusKey(n.key);
    setView((v) => revealRect(v, n, stageRef.current));
  };

  const lit = (key: string) => reach === null || reach.nodes.has(key);
  const findingsOf = (key: string) => {
    const node = nodeByKey.get(key);
    return node && findings !== undefined ? nodeFindings(node, findings).length : 0;
  };
  // Tab order follows the picture: left to right, then top to bottom.
  const tabOrder = useMemo(() => [...layout.nodes].sort((a, b) => a.x - b.x || a.y - b.y || a.key.localeCompare(b.key)), [layout]);

  return (
    <div className="grid gap-3">
      {/* One row on a phone: the item, then icon buttons; the filter's status, when there is one, takes the next line. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 basis-0 items-center gap-2 sm:flex-none sm:basis-auto">
          <span>Item</span>
          <select value={activeItem} onChange={(e) => setItem(e.target.value)} className="min-h-touch min-w-0 flex-1 sm:flex-none">
            <option value={ALL_ITEMS}>All items</option>
            {items.map((i) => (
              <option key={i.className} value={i.className}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Zoom" className="flex gap-2">
          <ToolButton
            name="Zoom in"
            onClick={() => setView((v) => zoomCentre(v, ZOOM_STEP, stage))}
            disabled={view.k >= MAX_ZOOM}
            icon={<path d="M12 5v14M5 12h14" />}
          />
          <ToolButton name="Zoom out" onClick={() => setView((v) => zoomCentre(v, 1 / ZOOM_STEP, stage))} disabled={view.k <= MIN_ZOOM} icon={<path d="M5 12h14" />} />
          <ToolButton name="Fit to view" onClick={() => setView(fit)} icon={<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />} />
        </div>
        {reach !== null && (
          <span role="status" className="w-full text-sm text-muted sm:w-auto">
            {reach.nodes.size} of {layout.nodes.length} groups carry or feed this item.
          </span>
        )}
      </div>

      {/* What to do about a drawing that runs past the canvas; the line keeps its height so the page does not jump. */}
      <p className="m-0 h-lh text-sm text-muted">{overflowing && "Drag or use the arrow keys to see more →"}</p>

      {/* From lg the group panel is a drawer over the canvas's right side (it never shrinks the canvas); below, it stacks. */}
      <div className="relative flex flex-col gap-3 lg:block">
        <div
          role="group"
          tabIndex={0}
          aria-label="Graph viewport. Plus and minus zoom, arrow keys pan, 0 fits the graph."
          aria-keyshortcuts="+ - 0 ArrowUp ArrowDown ArrowLeft ArrowRight"
          onKeyDown={onKeyDown}
          className="relative min-w-0"
        >
          <svg
            ref={svgRef}
            role="img"
            aria-label={graphSummary(
              layout.nodes.flatMap((n) => nodeByKey.get(n.key) ?? []),
              layout.sourceEdges,
              site.name,
            )}
            viewBox={`0 0 ${stage.width} ${stage.height}`}
            height={canvasH}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onPointerDown}
            className="max-h-map min-h-map-min w-full cursor-grab touch-none rounded-card border border-line bg-surface"
          >
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {layout.edges.map((e) => {
                const on = reach === null || reach.edges.has(e.index);
                const from = laidByKey.get(e.edge.from);
                const to = laidByKey.get(e.edge.to);
                return (
                  <g key={e.index} className={cn("transition-opacity", !on && "opacity-graph-dim")}>
                    <title>{edgeTitle(e.edge, from?.title ?? "", to?.title ?? "")}</title>
                    <path
                      d={edgePath(e)}
                      fill="none"
                      strokeWidth={edgeWidth(e.edge.mixed)}
                      strokeDasharray={edgeDash(e.edge.rate)}
                      markerEnd={`url(#${markerId})`}
                      className={edgeClass(e.edge)}
                    />
                    {/* Just above the line; the halo only matters where another line crosses the words. */}
                    <text x={e.labelX} y={e.labelY} textAnchor="middle" dominantBaseline="central" strokeWidth={4} className="fill-fg stroke-surface text-sm paint-stroke-first">
                      {e.labelLines.map((line, i) => (
                        <tspan key={i} x={e.labelX} dy={i === 0 ? -((e.labelLines.length - 1) * LABEL_LINE_H) / 2 : LABEL_LINE_H}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </g>
                );
              })}
              {layout.nodes.map((n) => {
                const finding = findingsOf(n.key);
                const isOpen = openKey === n.key;
                const ringed = isOpen || focusKey === n.key;
                return (
                  <g
                    key={n.key}
                    transform={`translate(${n.x} ${n.y})`}
                    onClick={() => open(n.key)}
                    className={cn("cursor-pointer transition-opacity", !lit(n.key) && "opacity-graph-dim")}
                  >
                    <title>{groupLabel(nodeByKey.get(n.key)!)}</title>
                    <rect
                      width={n.width}
                      height={n.height}
                      rx={8}
                      strokeWidth={ringed ? 3 : 1}
                      className={cn("fill-surface-2", ringed ? "stroke-accent" : "stroke-line")}
                    />
                    {n.iconUrl !== undefined && (
                      <g aria-hidden="true">
                        <rect x={NODE_PAD_X} y={TITLE_H - 15} width={BUILDING_ICON_SIZE} height={BUILDING_ICON_SIZE} rx={4} className="fill-icon-chip" />
                        <image href={n.iconUrl} x={NODE_PAD_X} y={TITLE_H - 15} width={BUILDING_ICON_SIZE} height={BUILDING_ICON_SIZE} />
                      </g>
                    )}
                    <text x={n.titleX} y={TITLE_H} className="fill-fg-strong text-base font-semibold">
                      {n.title}
                    </text>
                    {/* Muted (5.6:1 on the card) only for the recipe, the first line; the rates and states read in full colour. */}
                    {n.lines.map((line, i) => (
                      <text key={i} x={NODE_PAD_X}y={TITLE_H + LINE_H * (i + 1)} className={cn("text-sm", i < n.recipeLines ? "fill-muted" : "fill-fg")}>
                        {line}
                      </text>
                    ))}
                    {finding > 0 && (
                      <g transform={`translate(${n.width - BADGE_W - 8} ${-BADGE_H / 2})`}>
                        <rect width={BADGE_W} height={BADGE_H} rx={8} className="fill-warn-solid" />
                        <text x={BADGE_W / 2} y={BADGE_H / 2} textAnchor="middle" dominantBaseline="central" className="fill-fg-strong text-sm font-semibold">
                          Bottleneck
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          {/* A fade on each edge the drawing runs past: a cue that there is more, eased in and out. */}
          {FADES.map((f) => (
            <div
              key={f.edge}
              aria-hidden="true"
              data-fade={f.edge}
              data-clipped={clipped[f.edge]}
              className={cn("pointer-events-none absolute from-surface to-transparent transition-opacity", f.className, clipped[f.edge] ? "opacity-100" : "opacity-0")}
            />
          ))}
          {/* The keyboard's way into the groups: real buttons, visually hidden, ringing the focused group in the picture. */}
          <ul aria-label="Groups in the graph" className="m-0 list-none p-0">
            {tabOrder.map((n) => {
              const node = nodeByKey.get(n.key)!;
              const count = findingsOf(n.key);
              const name = `${groupLabel(node)}${node.loop ? ", in a loop" : ""}${count > 0 ? `, ${bottleneckCountText(count)}` : ""}`;
              return (
                <li key={n.key}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) buttons.current.set(n.key, el);
                      else buttons.current.delete(n.key);
                    }}
                    aria-label={name}
                    aria-expanded={openKey === n.key}
                    aria-controls={openKey === n.key ? panelId : undefined}
                    onClick={() => setOpenKey(n.key)}
                    onFocus={() => focusNode(n)}
                    onBlur={() => setFocusKey((k) => (k === n.key ? null : k))}
                    className="sr-only"
                  />
                </li>
              );
            })}
          </ul>
        </div>
        {openNode && (
          <div ref={panelRef} className="rounded-card bg-surface lg:absolute lg:inset-y-0 lg:right-0 lg:w-graph-panel lg:overflow-y-auto">
            <GroupPanel key={openNode.key} id={panelId} node={openNode} findings={findings} onClose={close} />
          </div>
        )}
      </div>

      <Legend />
    </div>
  );
}

/** The line styles, drawn as samples with the words of the tables (ADR-0050 Decision 2). */
const LEGEND: readonly { label: string; edge: EdgeStyle }[] = [
  { label: "measured", edge: { mixed: false, kind: "belt", rate: "measured" } },
  { label: "about (estimated)", edge: { mixed: false, kind: "belt", rate: "estimated" } },
  { label: "unknown", edge: { mixed: false, kind: "belt", rate: "unknown" } },
  { label: "mixed belt", edge: { mixed: true, kind: "belt", rate: "measured" } },
  { label: "pipe", edge: { mixed: false, kind: "pipe", rate: "measured" } },
];

function Legend() {
  return (
    <ul aria-label="Line styles" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm text-muted">
      {LEGEND.map(({ label, edge }) => (
        <li key={label} className="flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 32 6" className="h-1.5 w-8 shrink-0">
            <line x1={1} y1={3} x2={31} y2={3} fill="none" strokeWidth={edgeWidth(edge.mixed)} strokeDasharray={edgeDash(edge.rate)} className={edgeClass(edge)} />
          </svg>
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}
