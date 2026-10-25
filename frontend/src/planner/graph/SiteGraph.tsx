import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Bottleneck, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import { cn } from "../../lib/cn";
import { useReducedMotion } from "../../overview/reducedMotion";
import { bottleneckCountText, carrierWord, siteFindings } from "../plannerText";
import { GroupPanel } from "./GroupPanel";
import { factoryScene, flowTitle, overviewScene, sceneSummary, siteScene, type Card, type CanvasFlow, type FactoryView, type Scene } from "./canvasScene";
import { reachFor, siteItems } from "./graphModel";
import type { FactoryModel } from "./hierarchy";
import {
  BUILDING_ICON_SIZE,
  CHAR_W_BODY,
  FRAME_HEADER_H,
  LABEL_LINE_H,
  LINE_H,
  NODE_PAD_X,
  TITLE_H,
  isTransport,
  layoutScene,
  type LaidEdge,
  type LaidFrame,
  type LaidNode,
} from "./layoutSite";
import { MOTION_OPTIONS, motionOn, useCollapsedUpstream, useMotionPref, useStorageDetail, type MotionPref } from "./plannerPrefs";
import { TransportGlyph } from "./transportGlyphs";
import { GLYPH_MODES } from "./transportModes";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  FALLBACK_STAGE,
  ZOOM_STEP,
  canvasHeight,
  clippedEdges,
  fitView,
  isClipped,
  isInView,
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
/** The upstream control on a card: a pill of this height at the card's bottom-left, with a hit area up to the touch size. */
const PILL_H = 24;
const PILL_MIN_W = 24;
const PILL_HIT = 44;
/** The Collapse button in a frame's header. */
const COLLAPSE_W = 76;
/** A glyph crosses its edge at this many units a second, within these bounds; at most this many edges move at once. */
const GLYPH_SPEED = 40;
const GLYPH_MIN_S = 4;
const GLYPH_MAX_S = 16;
const MAX_MOVING = 40;

const edgePath = (points: readonly { x: number; y: number }[]) => points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");

type EdgeStyle = Pick<CanvasFlow, "mixed" | "carrier" | "rate">;

/** Stroke colour by what the edge carries (a pipe, a mixed belt), dash by how sure its rate is (Decision 2). */
function edgeClass(e: EdgeStyle) {
  if (e.mixed) return "stroke-warn";
  return e.carrier === "pipe" ? "stroke-info" : e.rate === "unknown" ? "stroke-line" : "stroke-muted";
}
const edgeDash = (rate: CanvasFlow["rate"]) => (rate === "measured" ? undefined : rate === "estimated" ? "8 5" : "2 5");
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
function ToolButton({ name, icon, onClick, disabled, pressed }: { name: string; icon: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed} className="inline-flex min-h-touch min-w-touch items-center justify-center">
      <svg {...ICON_PROPS} className="size-5 sm:hidden">
        {icon}
      </svg>
      <span className="sr-only sm:not-sr-only">{name}</span>
    </button>
  );
}

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
/** Whether the tab is showing: nothing animates in a hidden one (ADR-0055 Decision 6). */
const usePageVisible = () =>
  useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => true,
  );

/** What the canvas shows: one site (an older backend), the factory overview, or one opened factory. */
export type GraphTarget = { kind: "site"; site: PlannerSite } | { kind: "overview"; models: readonly FactoryModel[] } | { kind: "factory"; model: FactoryModel };

/** A set with `key` added or removed. */
function toggled<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

/**
 * ADR-0050 Decision 3 and 4, ADR-0055 Decision 6, the canvas: dagre's layout of a scene drawn as SVG. The first level is
 * the factories; an opened factory shows its bubbles (a recipe from one source tree), which open in place into their
 * groups inside a frame, and a card's upstream can be hidden behind a "+N". Pan (drag, arrows), zoom (wheel, buttons, +
 * and -), fit, an item filter that lights what carries the item upstream and downstream, and a side panel for a group's
 * machines. The picture is `role="img"`; the keyboard reaches each card through a list of real buttons beside it (an
 * image's children are presentational, so buttons inside it would be hidden from assistive tech), and the focused card is
 * ringed in the picture. The Tables view is the full text alternative.
 */
export default function SiteGraph({
  graph,
  target,
  findings,
  onOpenFactory,
}: {
  graph: ProductionGraph;
  target: GraphTarget;
  findings: readonly Bottleneck[] | undefined;
  /** A factory card was chosen on the overview. */
  onOpenFactory?: (key: string) => void;
}) {
  // View state of this session: which bubbles differ from their default, which folds are open; and the viewer's saved
  // choices: whose upstream is hidden, storage shown, motion.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useCollapsedUpstream();
  const [storageDetail, setStorageDetail] = useStorageDetail();
  const [motionPref, setMotionPref] = useMotionPref();
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const animate = motionOn(motionPref, reduced);

  const view: FactoryView = useMemo(() => ({ flipped, unfolded, collapsed, storageDetail }), [flipped, unfolded, collapsed, storageDetail]);
  const scene: Scene = useMemo(
    () => (target.kind === "site" ? siteScene(target.site, graph) : target.kind === "overview" ? overviewScene(graph, target.models) : factoryScene(graph, target.model, view)),
    [target, graph, view],
  );
  const layout = useMemo(() => layoutScene(scene, graph.topologyHash), [scene, graph.topologyHash]);
  const nodeByKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n])), [graph]);
  const laidByKey = useMemo(() => new Map(layout.nodes.map((n) => [n.key, n])), [layout]);
  const items = useMemo(() => siteItems(layout.flows), [layout]);
  const ids = useId();
  const markerId = `${ids}-arrow`;
  const panelId = `${ids}-panel`;
  const transports = useMemo(() => layout.edges.filter((e) => isTransport(e.flow)), [layout]);
  const modes = useMemo(() => GLYPH_MODES.filter((m) => transports.some((e) => e.flow.carrier === m)), [transports]);

  // The SVG's measured size is the stage (1 unit = 1 CSS px); jsdom has no ResizeObserver and keeps the fallback.
  const [stage, setStage] = useState<Stage>(FALLBACK_STAGE);
  const fit = useMemo(() => fitView(layout.width, layout.height, stage), [layout.width, layout.height, stage]);
  const canvasH = canvasHeight(layout.width, layout.height, stage.width);
  // Until the user pans or zooms the view is the fit, so it follows the measured size; after that it is theirs.
  const [moved, setMoved] = useState<View | null>(null);
  const viewport = moved ?? fit;
  const viewRef = useRef(viewport);
  const stageRef = useRef(stage);
  useEffect(() => {
    viewRef.current = viewport;
    stageRef.current = stage;
  });
  const setView = (change: View | ((v: View) => View)) => setMoved(typeof change === "function" ? change(viewRef.current) : change);
  const [item, setItem] = useState(ALL_ITEMS);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const dragged = useRef(false);

  // A filter item that left the scene (a poll changed the edges) falls back to "all items".
  const activeItem = items.some((i) => i.className === item) ? item : ALL_ITEMS;
  const reach = useMemo(() => (activeItem === ALL_ITEMS ? null : reachFor(activeItem, layout.flows)), [activeItem, layout]);
  // An open group that left the graph (a poll) shows no panel.
  const openNode = openKey === null || !laidByKey.has(openKey) ? undefined : nodeByKey.get(openKey);
  const clipped = clippedEdges(viewport, layout, stage);
  const overflowing = isClipped(clipped);
  const panelRef = useRef<HTMLDivElement>(null);

  // From lg the panel is a drawer over the canvas's right side: bring the opened group into the part left of it.
  useEffect(() => {
    const panel = panelRef.current;
    const n = openKey === null ? undefined : laidByKey.get(openKey);
    if (!panel || !n || getComputedStyle(panel).position !== "absolute") return;
    const visibleStage = stageBesidePanel(stageRef.current, panel.offsetWidth);
    setView((v) => revealRect(v, n, visibleStage));
  }, [openKey, laidByKey]);

  // A bubble that just opened: if the user has moved the view, bring its frame into sight.
  const revealFrame = useRef<string | null>(null);
  useEffect(() => {
    const key = revealFrame.current;
    const frame = key === null ? undefined : layout.frames.find((f) => f.bubbleKey === key);
    if (frame === undefined) return;
    revealFrame.current = null;
    setView((v) => revealRect(v, frame, stageRef.current));
  }, [layout]);

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

  const close = () => {
    const key = openKey;
    setOpenKey(null);
    if (key !== null) buttons.current.get(key)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      // One thing at a time: the panel, then the last card whose upstream was hidden.
      if (openKey !== null) {
        close();
        return;
      }
      const last = [...collapsed].pop();
      if (last !== undefined) {
        event.preventDefault();
        setCollapsed(toggled(collapsed, last));
        return;
      }
    }
    const next = keyView(viewport, event.key, fit, stage);
    if (next === null) return;
    event.preventDefault();
    setView(next);
  };

  // What a card does when chosen: a factory opens, a bubble opens in place, a fold shows its trees, a group opens its panel.
  const activate = (card: Card) => {
    // A drag that ends on a card is not a click on it.
    if (dragged.current) return;
    if (card.kind === "factory") onOpenFactory?.(card.key);
    else if (card.kind === "bubble" && card.bubbleKey !== undefined) {
      setFlipped(toggled(flipped, card.bubbleKey));
      revealFrame.current = card.bubbleKey;
    } else if (card.kind === "fold") setUnfolded(toggled(unfolded, card.key));
    else setOpenKey(card.key);
  };
  const collapseBubble = (bubbleKey: string) => {
    if (dragged.current) return;
    setFlipped(toggled(flipped, bubbleKey));
  };
  const toggleUpstream = (key: string) => {
    if (dragged.current) return;
    setCollapsed(toggled(collapsed, key));
  };
  const focusNode = (n: LaidNode) => {
    setFocusKey(n.key);
    setView((v) => revealRect(v, n, stageRef.current));
  };
  /** "Collapse all" when most are open, "Expand all" otherwise: each flips every bubble to the other state. */
  const everyBubbleOpen = scene.bubbleKeys.length > 0 && scene.cards.every((c) => c.kind !== "bubble");
  const setAllBubbles = (open: boolean) => {
    // A bubble is open by default in a small factory, collapsed in a big one: `flipped` holds what differs from that.
    setFlipped(open === scene.openByDefault ? new Set() : new Set(scene.bubbleKeys));
  };

  const lit = (key: string) => reach === null || reach.nodes.has(key);
  const findingsByCard = useMemo(() => {
    const counts = new Map<string, number>();
    if (findings === undefined) return counts;
    for (const card of scene.cards) {
      const nodes = card.nodeKeys.flatMap((k) => nodeByKey.get(k) ?? []);
      counts.set(card.key, siteFindings(nodes, findings).length);
    }
    return counts;
  }, [scene, nodeByKey, findings]);
  const findingsOf = (key: string) => findingsByCard.get(key) ?? 0;
  // Tab order follows the picture: left to right, then top to bottom.
  const tabOrder = useMemo(() => [...layout.nodes].sort((a, b) => a.x - b.x || a.y - b.y || a.key.localeCompare(b.key)), [layout]);
  const loops = useMemo(() => scene.cards.filter((c) => c.loop).length, [scene]);

  // The transport glyphs that move: only those whose edge is in view, at most MAX_MOVING, and never in a hidden tab.
  const moving = useMemo(() => {
    const set = new Set<number>();
    if (!animate || !visible) return set;
    for (const e of transports) {
      if (set.size >= MAX_MOVING) break;
      if (e.points.length < 2) continue;
      const xs = e.points.map((p) => p.x);
      const ys = e.points.map((p) => p.y);
      const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      if (isInView(viewport, stage, box)) set.add(e.index);
    }
    return set;
  }, [animate, visible, transports, viewport, stage]);

  // The drawing eases in when its shape changes (a card opened, closed or hid its upstream), not on a poll's new rates.
  const shape = useMemo(() => `${scene.cards.map((c) => c.key).join("|")}#${scene.flows.length}`, [scene]);

  const canSwitchStorage = scene.hasStorage;
  const canFold = scene.bubbleKeys.length > 0;

  return (
    <div className="grid gap-3">
      {/* One row on a phone: the item, then icon buttons; the filter's status, when there is one, takes the next line. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-40 flex-1 basis-0 items-center gap-2 sm:flex-none sm:basis-auto">
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
            disabled={viewport.k >= MAX_ZOOM}
            icon={<path d="M12 5v14M5 12h14" />}
          />
          <ToolButton name="Zoom out" onClick={() => setView((v) => zoomCentre(v, 1 / ZOOM_STEP, stage))} disabled={viewport.k <= MIN_ZOOM} icon={<path d="M5 12h14" />} />
          <ToolButton name="Fit to view" onClick={() => setView(fit)} icon={<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />} />
        </div>
        {(canFold || canSwitchStorage) && (
          <div role="group" aria-label="Detail" className="flex gap-2">
            {canFold && (
              <ToolButton
                name={everyBubbleOpen ? "Collapse all" : "Expand all"}
                onClick={() => setAllBubbles(!everyBubbleOpen)}
                icon={everyBubbleOpen ? <path d="M8 4l4 4 4-4M8 20l4-4 4 4" /> : <path d="M8 8l4-4 4 4M8 16l4 4 4-4" />}
              />
            )}
            {canSwitchStorage && (
              <ToolButton
                name="Storage detail"
                pressed={storageDetail}
                onClick={() => setStorageDetail(!storageDetail)}
                icon={<path d="M4 7h16v4H4zM5 11v8h14v-8M10 15h4" />}
              />
            )}
          </div>
        )}
        {transports.length > 0 && <MotionSelect value={motionPref} onChange={setMotionPref} />}
        {reach !== null && (
          <span role="status" className="w-full text-sm text-muted sm:w-auto">
            {reach.nodes.size} of {layout.nodes.length} {scene.level === "overview" ? "factories" : scene.level === "site" ? "groups" : "cards"} carry or feed this item.
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
            aria-label={sceneSummary(scene, loops)}
            viewBox={`0 0 ${stage.width} ${stage.height}`}
            height={canvasH}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onPointerDown}
            // A pan must not start a text selection or drag a building icon away as an image.
            onDragStart={(e) => e.preventDefault()}
            className="max-h-map min-h-map-min w-full cursor-grab touch-none select-none rounded-card border border-line bg-surface"
          >
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            <g key={shape} transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`} className={cn(animate && "animate-graph-in")}>
              {layout.frames.map((f) => (
                <Frame key={f.key} frame={f} onCollapse={() => collapseBubble(f.bubbleKey)} />
              ))}
              {layout.edges.map((e) => {
                const on = reach === null || reach.edges.has(e.index);
                const from = laidByKey.get(e.flow.from);
                const to = laidByKey.get(e.flow.to);
                return <Edge key={e.index} edge={e} markerId={markerId} dim={!on} moving={moving.has(e.index)} from={from?.title ?? ""} to={to?.title ?? ""} />;
              })}
              {layout.nodes.map((n) => (
                <CardView
                  key={n.key}
                  node={n}
                  finding={findingsOf(n.key)}
                  ringed={openKey === n.key || focusKey === n.key}
                  dim={!lit(n.key)}
                  onActivate={() => activate(n.card)}
                  onToggleUpstream={() => toggleUpstream(n.key)}
                />
              ))}
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
          {/* The keyboard's way into the cards: real buttons, visually hidden, ringing the focused card in the picture. */}
          <ul aria-label={scene.level === "overview" ? "Factories in the graph" : scene.level === "site" ? "Groups in the graph" : "Cards in the graph"} className="m-0 list-none p-0">
            {tabOrder.map((n) => {
              const card = n.card;
              const count = findingsOf(n.key);
              const name = `${cardButtonName(card)}${card.loop ? ", in a loop" : ""}${count > 0 ? `, ${bottleneckCountText(count)}` : ""}`;
              return (
                <li key={n.key}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) buttons.current.set(n.key, el);
                      else buttons.current.delete(n.key);
                    }}
                    aria-label={name}
                    aria-expanded={card.kind === "group" ? openKey === n.key : card.kind === "factory" ? undefined : false}
                    aria-controls={card.kind === "group" && openKey === n.key ? panelId : undefined}
                    onClick={() => {
                      dragged.current = false;
                      activate(card);
                    }}
                    onFocus={() => focusNode(n)}
                    onBlur={() => setFocusKey((k) => (k === n.key ? null : k))}
                    className="sr-only"
                  />
                </li>
              );
            })}
          </ul>
          {(layout.frames.length > 0 || tabOrder.some((n) => n.card.upstream !== undefined)) && (
            <ul aria-label="Open and close parts of the graph" className="m-0 list-none p-0">
              {layout.frames.map((f) => (
                <li key={f.key}>
                  <button type="button" onClick={() => setFlipped(toggled(flipped, f.bubbleKey))} className="sr-only">
                    {`Collapse ${f.title}`}
                  </button>
                </li>
              ))}
              {tabOrder.flatMap((n) =>
                n.card.upstream === undefined
                  ? []
                  : [
                      <li key={n.key}>
                        <button type="button" aria-pressed={n.card.upstream.collapsed} onClick={() => setCollapsed(toggled(collapsed, n.key))} className="sr-only">
                          {upstreamName(n.card)}
                        </button>
                      </li>,
                    ],
              )}
            </ul>
          )}
        </div>
        {openNode && (
          <div ref={panelRef} className="rounded-card bg-surface lg:absolute lg:inset-y-0 lg:right-0 lg:w-graph-panel lg:overflow-y-auto">
            <GroupPanel key={openNode.key} id={panelId} node={openNode} findings={findings} onClose={close} />
          </div>
        )}
      </div>

      <Legend modes={modes} />
    </div>
  );
}

/** A card's keyboard name: what it is, and for a factory that choosing it opens it. */
function cardButtonName(card: Card): string {
  return card.kind === "factory" ? `Open factory: ${card.label}` : card.label;
}

/** The hidden button's name for hiding or showing what a card post-dominates. */
function upstreamName(card: Card): string {
  const n = card.upstream?.count ?? 0;
  const groups = `${n} ${n === 1 ? "group" : "groups"}`;
  return card.upstream?.collapsed ? `Show ${groups} hidden behind ${card.label}` : `Hide ${groups} that only ${n === 1 ? "feeds" : "feed"} ${card.label}`;
}

function MotionSelect({ value, onChange }: { value: MotionPref; onChange: (pref: MotionPref) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span>Motion</span>
      <select value={value} onChange={(e) => onChange(e.target.value as MotionPref)} className="min-h-touch">
        {MOTION_OPTIONS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A flow: the line, its label with a halo, and for a transport the mode's glyph on the middle (moving when it may). */
function Edge({ edge: e, markerId, dim, moving, from, to }: { edge: LaidEdge; markerId: string; dim: boolean; moving: boolean; from: string; to: string }) {
  const path = edgePath(e.points);
  const transport = isTransport(e.flow);
  const seconds = Math.min(GLYPH_MAX_S, Math.max(GLYPH_MIN_S, e.length / GLYPH_SPEED));
  return (
    <g className={cn("transition-opacity", dim && "opacity-graph-dim")}>
      <title>{flowTitle(e.flow, from, to)}</title>
      <path d={path} fill="none" strokeWidth={edgeWidth(e.flow.mixed)} strokeDasharray={edgeDash(e.flow.rate)} markerEnd={`url(#${markerId})`} className={edgeClass(e.flow)} />
      {transport && (
        <g transform={moving ? undefined : `translate(${e.mid.x} ${e.mid.y})`} data-moving={moving}>
          <TransportGlyph mode={e.flow.carrier} />
          {moving && <animateMotion path={path} dur={`${seconds}s`} repeatCount="indefinite" calcMode="linear" />}
        </g>
      )}

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
}

/**
 * An expanded bubble's frame: a dashed box round its groups. Its title and a Collapse button sit on tabs that straddle the
 * top edge (half above it, in the gap dagre leaves between frames, half in the frame's own padding), like a fieldset legend.
 */
function Frame({ frame: f, onCollapse }: { frame: LaidFrame; onCollapse: () => void }) {
  const room = Math.max(4, Math.floor((f.width - 4 * NODE_PAD_X - COLLAPSE_W) / CHAR_W_BODY));
  const title = f.title.length > room ? `${f.title.slice(0, room - 1)}…` : f.title;
  const tabY = -FRAME_HEADER_H / 2;
  return (
    <g transform={`translate(${f.x} ${f.y})`} data-frame={f.bubbleKey}>
      <rect width={f.width} height={f.height} rx={10} strokeWidth={1} strokeDasharray="6 4" className="fill-surface stroke-line" />
      <title>{f.title}</title>
      <rect x={NODE_PAD_X} y={tabY} width={title.length * CHAR_W_BODY + NODE_PAD_X} height={FRAME_HEADER_H} className="fill-surface" />
      <text x={NODE_PAD_X + NODE_PAD_X / 2} y={0} dominantBaseline="central" className="fill-fg text-sm">
        {title}
      </text>
      <g transform={`translate(${f.width - COLLAPSE_W - NODE_PAD_X} ${tabY})`} onClick={onCollapse} className="cursor-pointer">
        {/* An invisible target up to the touch size round the pill (the hidden "Collapse" button is the keyboard's way in). */}
        <rect y={(FRAME_HEADER_H - PILL_HIT) / 2} width={COLLAPSE_W} height={PILL_HIT} className="fill-transparent" />
        <rect width={COLLAPSE_W} height={FRAME_HEADER_H} rx={FRAME_HEADER_H / 2} strokeWidth={1} className="fill-surface-2 stroke-line" />
        <text x={COLLAPSE_W / 2} y={FRAME_HEADER_H / 2} textAnchor="middle" dominantBaseline="central" className="fill-fg text-sm">
          Collapse
        </text>
      </g>
    </g>
  );
}

function CardView({
  node: n,
  finding,
  ringed,
  dim,
  onActivate,
  onToggleUpstream,
}: {
  node: LaidNode;
  finding: number;
  ringed: boolean;
  dim: boolean;
  onActivate: () => void;
  onToggleUpstream: () => void;
}) {
  const card = n.card;
  const stacked = card.kind === "bubble" || card.kind === "fold";
  const up = card.upstream;
  const pillText = up === undefined ? "" : up.collapsed ? `+${up.count}` : "−";
  const pillW = Math.max(PILL_MIN_W, pillText.length * CHAR_W_BODY + 16);
  return (
    <g transform={`translate(${n.x} ${n.y})`} onClick={onActivate} data-card={card.kind} className={cn("cursor-pointer transition-opacity", dim && "opacity-graph-dim")}>
      <title>{card.label}</title>
      {/* A pile of cards behind a bubble or a fold: more than one thing is in it. */}
      {stacked && <rect x={5} y={5} width={n.width} height={n.height} rx={8} strokeWidth={1} className="fill-surface stroke-line" />}
      <rect width={n.width} height={n.height} rx={8} strokeWidth={ringed ? 3 : 1} className={cn("fill-surface-2", ringed ? "stroke-accent" : "stroke-line")} />
      {n.iconUrl !== undefined && (
        <g aria-hidden="true">
          <rect x={NODE_PAD_X} y={TITLE_H - 15} width={BUILDING_ICON_SIZE} height={BUILDING_ICON_SIZE} rx={4} className="fill-icon-chip" />
          <image href={n.iconUrl} x={NODE_PAD_X} y={TITLE_H - 15} width={BUILDING_ICON_SIZE} height={BUILDING_ICON_SIZE} />
        </g>
      )}
      <text x={n.titleX} y={TITLE_H} className="fill-fg-strong text-base font-semibold">
        {n.title}
      </text>
      {/* Muted (5.6:1 on the card) only for the recipe, the first lines; the rates and states read in full colour. */}
      {n.lines.map((line, i) => (
        <text key={i} x={NODE_PAD_X} y={TITLE_H + LINE_H * (i + 1)} className={cn("text-sm", i < n.recipeLines ? "fill-muted" : "fill-fg")}>
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
      {/* Collapse upstream: a minus hides what only feeds this card, and leaves a "+N" that shows it again. The invisible
          rect behind the pill widens its hit area towards the touch size; the hidden button is the keyboard's way in. */}
      {up !== undefined && (
        <g
          transform={`translate(8 ${n.height - PILL_H / 2})`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleUpstream();
          }}
          data-upstream={up.collapsed ? "collapsed" : "open"}
          className="cursor-pointer"
        >
          <title>{upstreamName(card)}</title>
          <rect x={-8} y={(PILL_H - PILL_HIT) / 2} width={Math.max(pillW + 16, PILL_HIT)} height={PILL_HIT} className="fill-transparent" />
          <rect width={pillW} height={PILL_H} rx={PILL_H / 2} strokeWidth={1} className="fill-surface-2 stroke-line" />
          <text x={pillW / 2} y={PILL_H / 2} textAnchor="middle" dominantBaseline="central" className="fill-fg text-sm font-semibold">
            {pillText}
          </text>
        </g>
      )}
    </g>
  );
}

/** The line styles, drawn as samples with the words of the tables (ADR-0050 Decision 2), and the glyphs a transport can wear. */
const LEGEND: readonly { label: string; edge: EdgeStyle }[] = [
  { label: "measured", edge: { mixed: false, carrier: "belt", rate: "measured" } },
  { label: "about (estimated)", edge: { mixed: false, carrier: "belt", rate: "estimated" } },
  { label: "unknown", edge: { mixed: false, carrier: "belt", rate: "unknown" } },
  { label: "mixed belt", edge: { mixed: true, carrier: "belt", rate: "measured" } },
  { label: "pipe", edge: { mixed: false, carrier: "pipe", rate: "measured" } },
];

function Legend({ modes }: { modes: readonly string[] }) {
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
      {modes.map((mode) => (
        <li key={mode} className="flex items-center gap-2">
          <svg aria-hidden="true" viewBox="-15 -15 30 30" className="size-6 shrink-0">
            <TransportGlyph mode={mode} />
          </svg>
          <span>{carrierWord(mode).toLowerCase()}</span>
        </li>
      ))}
    </ul>
  );
}
