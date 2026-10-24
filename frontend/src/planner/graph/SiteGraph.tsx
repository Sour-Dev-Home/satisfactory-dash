import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Bottleneck, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import { cn } from "../../lib/cn";
import { bottleneckCountText, groupLabel, nodeFindings } from "../plannerText";
import { GroupPanel } from "./GroupPanel";
import { edgeTitle, graphSummary, reachFor, siteItems } from "./graphModel";
import { layoutSite, type LaidEdge, type LaidNode } from "./layoutSite";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  FALLBACK_STAGE,
  ZOOM_STEP,
  canvasHeight,
  fitView,
  keyView,
  panBy,
  revealRect,
  toStage,
  zoomAt,
  zoomCentre,
  type Stage,
  type View,
} from "./viewport";

const ALL_ITEMS = "";
/** A pointer that moved less than this (client pixels) between down and up was a click, not a drag. */
const DRAG_SLOP = 4;
const WHEEL_SENSITIVITY = 0.0015;
const BADGE_W = 76;
const BADGE_H = 16;

const edgePath = (e: LaidEdge) => e.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");

/** Stroke colour by what the edge carries (a pipe, a mixed belt), dash by how sure its rate is (Decision 2). */
function edgeClass(e: LaidEdge["edge"]) {
  if (e.mixed) return "stroke-warn";
  return e.kind === "pipe" ? "stroke-info" : e.rate === "unknown" ? "stroke-line" : "stroke-muted";
}
const edgeDash = (rate: LaidEdge["edge"]["rate"]) => (rate === "measured" ? undefined : rate === "estimated" ? "8 5" : "2 5");

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

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    dragged.current = false;
    let last = { x: event.clientX, y: event.clientY };
    let moved = 0;
    const onMove = (e: PointerEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const scale = rect ? toStage(rect, stageRef.current, 0, 0).scale : 1;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      last = { x: e.clientX, y: e.clientY };
      if (moved > DRAG_SLOP) {
        dragged.current = true;
        setView((v) => panBy(v, dx / scale, dy / scale));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
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
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span>Item</span>
          <select value={activeItem} onChange={(e) => setItem(e.target.value)} className="min-h-touch">
            <option value={ALL_ITEMS}>All items</option>
            {items.map((i) => (
              <option key={i.className} value={i.className}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Zoom" className="flex gap-2">
          <button type="button" onClick={() => setView((v) => zoomCentre(v, ZOOM_STEP, stage))} disabled={view.k >= MAX_ZOOM} className="min-h-touch">
            Zoom in
          </button>
          <button type="button" onClick={() => setView((v) => zoomCentre(v, 1 / ZOOM_STEP, stage))} disabled={view.k <= MIN_ZOOM} className="min-h-touch">
            Zoom out
          </button>
          <button type="button" onClick={() => setView(fit)} className="min-h-touch">
            Fit to view
          </button>
        </div>
        {reach !== null && (
          <span role="status" className="text-sm text-muted">
            {reach.nodes.size} of {layout.nodes.length} groups carry or feed this item.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div
          role="group"
          tabIndex={0}
          aria-label="Graph viewport. Plus and minus zoom, arrow keys pan, 0 fits the graph."
          aria-keyshortcuts="+ - 0 ArrowUp ArrowDown ArrowLeft ArrowRight"
          onKeyDown={onKeyDown}
          className="relative min-w-0 flex-1"
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
                      strokeWidth={e.edge.mixed ? 3 : 2}
                      strokeDasharray={edgeDash(e.edge.rate)}
                      markerEnd={`url(#${markerId})`}
                      className={edgeClass(e.edge)}
                    />
                    <text x={e.labelX} y={e.labelY} textAnchor="middle" dominantBaseline="central" strokeWidth={4} className="fill-fg stroke-surface text-xs [paint-order:stroke]">
                      {e.label}
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
                    <text x={12} y={22} className="fill-fg-strong text-sm font-semibold">
                      {n.title}
                    </text>
                    {n.lines.map((line, i) => (
                      <text key={i} x={12} y={22 + 18 * (i + 1)} className="fill-muted text-xs">
                        {line}
                      </text>
                    ))}
                    {finding > 0 && (
                      <g transform={`translate(${n.width - BADGE_W - 8} ${-BADGE_H / 2})`}>
                        <rect width={BADGE_W} height={BADGE_H} rx={8} className="fill-warn-solid" />
                        <text x={BADGE_W / 2} y={BADGE_H / 2} textAnchor="middle" dominantBaseline="central" className="fill-fg-strong text-xs font-semibold">
                          Bottleneck
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
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
          <div className="lg:w-graph-panel lg:shrink-0">
            <GroupPanel key={openNode.key} id={panelId} node={openNode} findings={findings} onClose={close} />
          </div>
        )}
      </div>

      <Legend />
    </div>
  );
}

/** What the line styles mean, in the words of the tables (ADR-0050 Decision 2). */
function Legend() {
  return (
    <p className="m-0 text-sm text-muted">
      Solid line: measured rate. Dashed line: estimated, shown as &quot;about&quot;. Dotted line: rate unknown, no number. Amber line:
      mixed belt. Blue line: pipe. Drag to pan, scroll or use the buttons to zoom.
    </p>
  );
}
