import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Bottleneck, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import { cn } from "../../lib/cn";
import { useReducedMotion } from "../../overview/reducedMotion";
import { bottleneckCountText, carrierWord, siteFindings, UNKNOWN_FLOW_NOTE } from "../plannerText";
import { GroupPanel } from "./GroupPanel";
import { factoryScene, flowTitle, overviewScene, sceneSummary, siteScene, type Card, type CanvasFlow, type FactoryView, type Scene } from "./canvasScene";
import { minedRates, reachFor, siteItems } from "./graphModel";
import type { FactoryModel } from "./hierarchy";
import { BuildingGlyph, GLYPH_BOX } from "./buildingGlyphs";
import type { GlyphKind } from "./buildingIcons";
import {
  BUILDING_ICON_GAP,
  BUILDING_ICON_SIZE,
  CHAR_W_BODY,
  COUNT_BADGE_H,
  FRAME_HEADER_H,
  ICON_TOP,
  LABEL_LINE_H,
  LABEL_PAD,
  NODE_PAD_X,
  PILL_H,
  cardLineY,
  countBadgeWidth,
  isHeadingLine,
  isTransport,
  layoutScene,
  FOCUS_CARD_H,
  FOCUS_CARD_W,
  FOCUS_LAYOUT_BUDGET_MS,
  type LaidEdge,
  type LaidFrame,
  type LaidNode,
  type SiteLayout,
} from "./layoutSite";
import { MOTION_OPTIONS, motionOn, readItemFocus, useCollapsedUpstream, useMotionPref, useStorageDetail, type MotionPref } from "./plannerPrefs";
import { TransportGlyph } from "./transportGlyphs";
import { GLYPH_MODES } from "./transportModes";
import { MIN_LASSO_POINTS, cardsInLasso, lassoPath, toLayout } from "./lasso";
import { BADGE_H, BADGE_W, suggestionTag } from "./cardBadges";
import { roundedOrthogonalPath } from "./edgeShapes";
import {
  BUBBLE_D,
  BUBBLE_ICON,
  CHIP_H,
  CHIP_W,
  bubbleDetail,
  bubbleName,
  bubbleOffsets,
  bubbleStops,
  chipName,
  edgeKeyOf,
  stopId,
  type BubbleDetail,
  type BubbleItem,
  type BubbleStop,
  type ItemFocus,
} from "./bubbleRow";
import { BubbleButtons, ItemList } from "./ItemFocusLayer";
import { ItemCard } from "./ItemCard";
import { bubbleCentre, bubbleRowOrigin, itemCardText } from "./itemCardText";
import { tweenMs, useTween } from "./useTween";
import { itemIconUrl } from "./itemIcons";
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
  type Point,
  type Stage,
  type View,
} from "./viewport";

const ALL_ITEMS = "";
/** A pointer that moved less than this (client pixels) between down and up was a click, not a drag. */
const DRAG_SLOP = 4;
const WHEEL_SENSITIVITY = 0.0015;
/** The upstream control on a card: a pill of this height at the card's bottom-left, with a hit area up to the touch size. */
const PILL_MIN_W = 24;
const PILL_HIT = 44;
/** The Collapse button in a frame's header. */
const COLLAPSE_W = 76;
/** A glyph crosses its edge at this many units a second, within these bounds; at most this many edges move at once. */
const GLYPH_SPEED = 40;
const GLYPH_MIN_S = 4;
const GLYPH_MAX_S = 16;
const MAX_MOVING = 40;
/** A lasso adds a point once the pointer is this far (stage units) from the last one. */
const LASSO_STEP = 3;
/** The Keep pill on a suggested factory's card. */
const KEEP_W = 56;
/** The check on a selected card's corner. */
const CHECK_R = 10;


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

/** The groups picked to designate (ADR-0055 Decision 5), shared with the Groups table's ticks. */
export interface CanvasSelection {
  selected: ReadonlySet<string>;
  replace: (nodeKeys: ReadonlySet<string>) => void;
}

/** The overview's automatic factories shown as suggestions, and the Keep form for one (owners and admins only). */
export interface CanvasSuggestions {
  keys: ReadonlySet<string>;
  keepForm?: ((factoryKey: string, onClose: (saved: boolean) => void) => ReactNode) | undefined;
}

export interface SiteGraphProps {
  graph: ProductionGraph;
  target: GraphTarget;
  findings: readonly Bottleneck[] | undefined;
  /** A factory card was chosen on the overview. */
  onOpenFactory?: (key: string) => void;
  /** Given, the canvas has a Select mode: a lasso (or a click) picks the groups of the cards it takes. */
  selection?: CanvasSelection | undefined;
  suggestions?: CanvasSuggestions | undefined;
  /** ADR-0055 Decision 12 (#727), the overview only: factory keys picked to merge; Shift- or Ctrl-click picks one. */
  factoryPicks?: CanvasSelection | undefined;
  /**
   * In an opened factory that can be split: the group panel's "Pop out" moves that group into its own factory. It rejects
   * when the write fails, and the panel shows why.
   */
  onPopOut?: ((nodeKey: string) => Promise<void>) | undefined;
}

/** Whether a card can be picked: it stands for groups that are drawn (a fold's are hidden, a factory is not a group). */
const pickable = (card: Card) => (card.kind === "group" || card.kind === "bubble") && card.nodeKeys.length > 0;
const isPicked = (card: Card, selected: ReadonlySet<string>) => pickable(card) && card.nodeKeys.every((k) => selected.has(k));

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
 * ringed in the picture. The Tables view is the full text alternative. With a selection, Select mode (or Shift+drag)
 * draws a lasso that picks the cards whose centre it encloses (ADR-0055 Decision 5); in Select mode a click (or a card's
 * button) picks or unpicks one card instead of opening it. Suggested factories are dashed, with Keep.
 */
export default function SiteGraph({ graph, target, findings, onOpenFactory, selection, suggestions, factoryPicks, onPopOut }: SiteGraphProps) {
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
  const overview = useMemo(() => layoutScene(scene, graph.topologyHash), [scene, graph.topologyHash]);
  const rates = useMemo(() => minedRates(graph.edges), [graph.edges]);
  // Item focus (ADR-0060 builds PR 3 and 4), behind its flag, here because the picture makes room for the focused line.
  // A focus whose line (or item) left the graph (a poll) clears: lines are found by key, not index.
  const [itemFocusOn] = useState(readItemFocus);
  const [itemFocus, setItemFocus] = useState<ItemFocus | null>(null);
  const overviewByKey = useMemo(() => new Map(overview.edges.map((e) => [edgeKeyOf(e.flow), e])), [overview]);
  const focusEdge = itemFocus === null ? undefined : overviewByKey.get(itemFocus.edgeKey);
  const focus = itemFocusOn && focusEdge !== undefined && focusEdge.bubbles.all.some((i) => i.key === itemFocus!.item) ? itemFocus : null;
  // Make room (Decision 3): the focused line's box is laid out at the detail card's size. A layout over the budget is not
  // drawn: focus then only dims. Both layouts are remembered, so moving between them costs nothing after the first time.
  const roomFor = focus?.edgeKey ?? null;
  const room = useMemo(
    () => (roomFor === null ? null : layoutScene(scene, graph.topologyHash, { edgeKey: roomFor, width: FOCUS_CARD_W, height: FOCUS_CARD_H })),
    [scene, graph.topologyHash, roomFor],
  );
  const layout = room !== null && room.placeMs <= FOCUS_LAYOUT_BUDGET_MS ? room : overview;
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
  // One object per detail step, so a zoom inside a step does not change any bubble's props.
  const { full, iconSize } = bubbleDetail(viewport.k, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const detail = useMemo((): BubbleDetail => ({ full, iconSize }), [full, iconSize]);
  const viewRef = useRef(viewport);
  const stageRef = useRef(stage);
  const layoutRef = useRef(layout);
  const selectionRef = useRef(selection);
  useEffect(() => {
    viewRef.current = viewport;
    stageRef.current = stage;
    layoutRef.current = layout;
    selectionRef.current = selection;
  });
  const setView = (change: View | ((v: View) => View)) => setMoved(typeof change === "function" ? change(viewRef.current) : change);
  const [item, setItem] = useState(ALL_ITEMS);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Item focus's other state: the line whose "+k" list is open, the bubble stop that holds the tab stop and the one the
  // keyboard is on (ringed), and what the status line last said.
  const [listKey, setListKey] = useState<string | null>(null);
  const [activeStop, setActiveStop] = useState<string | null>(null);
  const [keyStop, setKeyStop] = useState<BubbleStop | null>(null);
  const [announced, setAnnounced] = useState("");
  // The card of a focus just left, while it shrinks back to its bubble.
  const [closingCard, setClosingCard] = useState<ItemFocus | null>(null);
  const bubbleButtons = useRef(new Map<string, HTMLButtonElement>());
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const dragged = useRef(false);
  // Select mode (only with a selection) and the lasso being drawn, in layout units; the ref is what the window listeners see.
  const [selecting, setSelecting] = useState(false);
  // Select mode: in a factory it picks groups (a click, or a lasso); on the overview it picks factories for a merge (a
  // click or a tap, the owner 2026-10-27: Shift-click alone left a phone, and anyone not told, no way to pick).
  const overviewPicks = factoryPicks !== undefined && scene.level === "overview";
  const selectMode = selecting && (selection !== undefined || overviewPicks);
  const pickingFactories = selectMode && overviewPicks;
  const [lasso, setLasso] = useState<readonly Point[] | null>(null);
  const lassoRef = useRef<{ id: number; points: Point[]; add: boolean } | null>(null);
  // The suggested factory whose Keep form is open, and the hidden Keep buttons that focus returns to.
  const [keeping, setKeeping] = useState<string | null>(null);
  const keepButtons = useRef(new Map<string, HTMLButtonElement>());
  // A cancelled Keep form hands focus back to that factory's Keep button once the form is gone.
  // A new object each time, so cancelling the same factory's form twice still refocuses.
  const [refocusKeep, setRefocusKeep] = useState<{ key: string } | null>(null);
  useEffect(() => {
    if (refocusKeep !== null) keepButtons.current.get(refocusKeep.key)?.focus();
  }, [refocusKeep]);

  // A filter item that left the scene (a poll changed the edges) falls back to "all items".
  const activeItem = items.some((i) => i.className === item) ? item : ALL_ITEMS;
  const reach = useMemo(() => (activeItem === ALL_ITEMS ? null : reachFor(activeItem, layout.flows)), [activeItem, layout]);
  // The drawn lines by key, where they are now (the focused layout's when it makes room).
  const edgeByKey = useMemo(() => new Map(layout.edges.map((e) => [edgeKeyOf(e.flow), e])), [layout]);
  const listEdge = itemFocusOn && listKey !== null ? edgeByKey.get(listKey) : undefined;
  // Forget what a poll took away, so a line that comes back does not reopen its list (and take the keyboard), and say so
  // when focus ended that way. Adjusting state while rendering, guarded so it settles in one extra pass.
  if (listKey !== null && listEdge === undefined) setListKey(null);
  if (itemFocus !== null && focus === null) {
    setItemFocus(null);
    if (itemFocusOn) setAnnounced("Overview");
  }

  // The glide between the overview and the room-making layout (ADR-0060 Decisions 3 and 4). The view moves by the focused
  // line's shift, so its bubble stays where it was on screen (never a zoom); the cards slide from where they were, and the
  // lines and frames cross-fade, old over new, since paths of different shapes cannot be interpolated. Each frame writes
  // attributes through the DOM, not React state. Reduced motion (or Motion: Off) skips straight to the end.
  const { run: runTween, cancel: cancelTween } = useTween();
  const drawingRef = useRef<SVGGElement>(null);
  const freshRef = useRef<SVGGElement>(null);
  const ghostRef = useRef<SVGGElement>(null);
  const [ghost, setGhost] = useState<{ layout: SiteLayout; dx: number; dy: number } | null>(null);
  const roomShown = layout === room ? roomFor : null;
  const shown = useRef({ layout, room: roomShown });
  // React only rewrites a card's transform when its prop changes, so after the glide's own writes every card is put back
  // where the picture *now* has it: a glide cut short leaves no card mid-way, and a poll that moved cards during a glide
  // is not undone by the glide's end (which knew only the layout it started for).
  const settle = useCallback(() => {
    const now = new Map(shown.current.layout.nodes.map((n) => [n.key, n]));
    for (const el of drawingRef.current?.querySelectorAll<SVGGElement>("[data-node]") ?? []) {
      const n = now.get(el.getAttribute("data-node") ?? "");
      if (n !== undefined) el.setAttribute("transform", `translate(${n.x} ${n.y})`);
    }
    freshRef.current?.removeAttribute("opacity");
    setGhost(null);
  }, []);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { layout, room: roomShown };
    // Only a change of room starts a glide: a poll or a pan does not.
    if (before.room === roomShown || before.layout === layout) return;
    cancelTween();
    settle();
    const anchor = roomShown ?? before.room;
    const from = before.layout.edges.find((e) => edgeKeyOf(e.flow) === anchor);
    const to = layout.edges.find((e) => edgeKeyOf(e.flow) === anchor);
    if (from === undefined || to === undefined) return;
    const dx = to.labelX - from.labelX;
    const dy = to.labelY - from.labelY;
    setView((v) => ({ ...v, x: v.x - dx * v.k, y: v.y - dy * v.k }));
    const ms = animate ? tweenMs() : 0;
    const drawing = drawingRef.current;
    if (ms <= 0 || drawing === null) return;
    setGhost({ layout: before.layout, dx, dy });
    // In the new picture's frame, a card that was at p is at p + (dx, dy): it slides from there to its new place.
    const was = new Map(before.layout.nodes.map((n) => [n.key, { x: n.x + dx, y: n.y + dy }]));
    const now = new Map(layout.nodes.map((n) => [n.key, n]));
    const gliding = [...drawing.querySelectorAll<SVGGElement>("[data-node]")].flatMap((el) => {
      const end = now.get(el.getAttribute("data-node") ?? "");
      const start = end === undefined ? undefined : was.get(end.key);
      return end === undefined || start === undefined || Math.hypot(end.x - start.x, end.y - start.y) < 1 ? [] : [{ el, start, end }];
    });
    runTween(
      ms,
      (t) => {
        for (const m of gliding) m.el.setAttribute("transform", `translate(${m.start.x + (m.end.x - m.start.x) * t} ${m.start.y + (m.end.y - m.start.y) * t})`);
        freshRef.current?.setAttribute("opacity", String(t));
        ghostRef.current?.setAttribute("opacity", String(1 - t));
      },
      settle,
    );
  }, [layout, roomShown, animate, runTween, cancelTween, settle]);
  // An open group that left the graph (a poll) shows no panel.
  const openNode = openKey === null || !laidByKey.has(openKey) ? undefined : nodeByKey.get(openKey);
  const clipped = clippedEdges(viewport, layout, stage);
  const overflowing = isClipped(clipped);
  const panelRef = useRef<HTMLDivElement>(null);

  // From lg the panel is a drawer over the canvas's right side: bring the opened group into the part left of it. Once,
  // when it opens: a later layout (a refetch of any read the page shows) must not move a view the user may have panned.
  useEffect(() => {
    const panel = panelRef.current;
    const n = openKey === null ? undefined : layoutRef.current.nodes.find((node) => node.key === openKey);
    if (!panel || !n || getComputedStyle(panel).position !== "absolute") return;
    const visibleStage = stageBesidePanel(stageRef.current, panel.offsetWidth);
    setView((v) => revealRect(v, n, visibleStage));
  }, [openKey]);

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
      const drawing = lassoRef.current;
      if (drawing !== null && drawing.id === e.pointerId) {
        pointers.current.set(e.pointerId, next);
        travelled.current += Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y);
        const p = toLayout(viewRef.current, toStagePoint(next));
        const last = drawing.points[drawing.points.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * viewRef.current.k >= LASSO_STEP) {
          drawing.points.push(p);
          setLasso([...drawing.points]);
        }
        return;
      }
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
      const drawing = lassoRef.current;
      if (drawing === null || drawing.id !== e.pointerId) return;
      lassoRef.current = null;
      setLasso(null);
      const pick = selectionRef.current;
      // Too short to be a shape: a click, which the card's own handler takes. Any drag past the slop is not a click.
      if (travelled.current > DRAG_SLOP) dragged.current = true;
      if (e.type === "pointercancel" || pick === undefined || travelled.current <= DRAG_SLOP || drawing.points.length < MIN_LASSO_POINTS) return;
      const taken = layoutRef.current.nodes.filter((n) => pickable(n.card));
      const inside = new Set(cardsInLasso(taken, drawing.points));
      const keys = new Set(drawing.add ? pick.selected : []);
      for (const n of taken) if (inside.has(n.key)) for (const k of n.card.nodeKeys) keys.add(k);
      pick.replace(keys);
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
    if (event.pointerType !== "touch") {
      // The drag moves on the window, so the browser would otherwise select the page's text the pointer passes over.
      // Cancelling the press also cancels its focus, so the viewport takes focus itself: the keys still pan and zoom.
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      viewportRef.current?.focus({ preventScroll: true });
    }
    if (pointers.current.size === 0) {
      dragged.current = false;
      travelled.current = 0;
      // One pointer in Select mode, or with Shift held, draws a lasso instead of panning; Shift adds to what is picked.
      if (selection !== undefined && (selectMode || event.shiftKey)) {
        const rect = svgRef.current?.getBoundingClientRect();
        const s = rect ? toStage(rect, stageRef.current, event.clientX, event.clientY) : { x: event.clientX, y: event.clientY };
        lassoRef.current = { id: event.pointerId, points: [toLayout(viewport, s)], add: event.shiftKey };
      }
    } else if (lassoRef.current !== null) {
      // A second finger: the gesture is a pinch, not a lasso.
      lassoRef.current = null;
      setLasso(null);
    }
    // A third finger is not tracked: two define the gesture.
    if (pointers.current.size < 2) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const close = () => {
    const key = openKey;
    setOpenKey(null);
    if (key !== null) buttons.current.get(key)?.focus();
  };

  // Item focus (ADR-0060 Decisions 2 and 5). A focused item outside the first three is reached through its line's chip.
  const titleOf = (key: string) => laidByKey.get(key)?.title ?? "";
  const itemStop = (f: ItemFocus): string => {
    const e = edgeByKey.get(f.edgeKey);
    return e !== undefined && e.bubbles.items.some((i) => i.key === f.item) ? stopId(f.edgeKey, f.item) : stopId(f.edgeKey, null);
  };
  const leaveFocus = () => {
    if (focus === null) return;
    // The card runs its morph backwards to the bubble, then goes (at once with no motion).
    setClosingCard(focus);
    setItemFocus(null);
    setAnnounced("Overview");
    bubbleButtons.current.get(itemStop(focus))?.focus();
  };
  // "Show the whole path" (owner answer 1): the item filter lights the item's supply path, which focus's dimming would hide.
  const showPath = (className: string) => {
    if (dragged.current) return;
    setItem(className);
    leaveFocus();
  };
  // A focus's detail card (Decision 4): where its line is now, the item, its words, the bubble it grows from, and whether
  // its supply path can be shown (an item the filter knows; never for an unknown item).
  const cardOf = (f: ItemFocus) => {
    const edge = edgeByKey.get(f.edgeKey);
    const item = edge?.bubbles.all.find((i) => i.key === f.item);
    if (edge === undefined || item === undefined) return null;
    const text = itemCardText(item, edge.flow, edge.bubbles.all.length - 1, titleOf(edge.flow.from), titleOf(edge.flow.to));
    const path = item.className !== null && items.some((i) => i.className === item.className) ? item.className : null;
    return { edge, item, text, from: bubbleCentre(edge, item.key), path };
  };
  const cardMs = animate ? tweenMs() : 0;
  // A closing card whose line (or item) a poll took away has nothing to shrink to, and its tween never ends: forget it, so it
  // does not come back when the line does.
  if (closingCard !== null && cardOf(closingCard) === null) setClosingCard(null);
  const card = (f: ItemFocus, closing: boolean) => {
    const c = cardOf(f);
    if (c === null) return null;
    return (
      <ItemCard
        key={`${closing ? "closing" : "open"}|${f.edgeKey}|${f.item}`}
        item={c.item}
        text={c.text}
        cx={c.edge.labelX}
        cy={c.edge.labelY}
        from={c.from}
        ms={cardMs}
        closing={closing}
        onClosed={() => setClosingCard(null)}
        onClose={() => {
          if (!dragged.current) leaveFocus();
        }}
        onShowPath={c.path === null ? undefined : () => showPath(c.path!)}
      />
    );
  };
  const openCard = focus === null ? null : cardOf(focus);
  const focusItem = (edgeKey: string, item: BubbleItem) => {
    if (dragged.current) return;
    if (focus !== null && focus.edgeKey === edgeKey && focus.item === item.key) {
      leaveFocus();
      return;
    }
    const e = edgeByKey.get(edgeKey);
    // Moving focus straight to another item shrinks the old card away while the new one grows (and drops any still closing).
    setClosingCard(focus);
    setItemFocus({ edgeKey, item: item.key });
    setAnnounced(`Focused ${item.name ?? "Item unknown"} from ${titleOf(e?.flow.from ?? "")} to ${titleOf(e?.flow.to ?? "")}`);
  };
  const closeList = () => {
    const key = listKey;
    setListKey(null);
    if (key !== null) bubbleButtons.current.get(stopId(key, null))?.focus();
  };
  const openList = (edgeKey: string) => {
    if (dragged.current) return;
    if (listKey === edgeKey) {
      closeList();
      return;
    }
    // The list takes the group panel's place beside the canvas.
    setOpenKey(null);
    setListKey(edgeKey);
  };
  const activateStop = (stop: BubbleStop) => {
    // A key press, not the end of a drag.
    dragged.current = false;
    if (stop.item === null) {
      openList(stop.edgeKey);
      return;
    }
    const item = edgeByKey.get(stop.edgeKey)?.bubbles.all.find((i) => i.key === stop.item);
    if (item !== undefined) focusItem(stop.edgeKey, item);
  };
  // A press on the canvas's background (not a bubble, a chip or a card) leaves focus; the end of a drag is not a press.
  const onCanvasClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (focus === null || dragged.current) return;
    if (event.target instanceof Element && event.target.closest("[data-bubble], [data-bubble-more], [data-card], [data-item-card]") !== null) return;
    leaveFocus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      // One thing at a time: a "+k" list, the focused item, the panel, then what is picked, then the last card whose
      // upstream was hidden.
      if (listEdge !== undefined) {
        event.preventDefault();
        closeList();
        return;
      }
      if (focus !== null) {
        event.preventDefault();
        leaveFocus();
        return;
      }
      if (openKey !== null) {
        close();
        return;
      }
      if (selection !== undefined && selection.selected.size > 0) {
        event.preventDefault();
        selection.replace(new Set());
        return;
      }
      if (factoryPicks !== undefined && factoryPicks.selected.size > 0) {
        event.preventDefault();
        factoryPicks.replace(new Set());
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
  const activate = (card: Card, additive = false) => {
    // A drag that ends on a card is not a click on it.
    if (dragged.current) return;
    // Shift- or Ctrl-click on the overview picks a factory for a merge instead of opening it.
    if ((additive || pickingFactories) && factoryPicks !== undefined && card.kind === "factory") {
      factoryPicks.replace(toggled(factoryPicks.selected, card.key));
      return;
    }
    if (selectMode && selection !== undefined && pickable(card)) {
      const next = new Set(selection.selected);
      const on = isPicked(card, selection.selected);
      for (const k of card.nodeKeys) if (on) next.delete(k);
      else next.add(k);
      selection.replace(next);
      return;
    }
    if (card.kind === "factory") onOpenFactory?.(card.key);
    else if (card.kind === "bubble" && card.bubbleKey !== undefined) {
      setFlipped(toggled(flipped, card.bubbleKey));
      revealFrame.current = card.bubbleKey;
    } else if (card.kind === "fold") setUnfolded(toggled(unfolded, card.key));
    else {
      // The group panel takes the "+k" list's place beside the canvas.
      setListKey(null);
      setOpenKey(card.key);
    }
  };
  const collapseBubble = (bubbleKey: string) => {
    if (dragged.current) return;
    setFlipped(toggled(flipped, bubbleKey));
  };
  const toggleUpstream = (key: string) => {
    if (dragged.current) return;
    setCollapsed(toggled(collapsed, key));
  };
  const keepCard = (key: string) => {
    if (dragged.current) return;
    setKeeping(key);
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

  // Focus is hop-1 (owner answer 1): only the focused line and its two cards stay lit; otherwise the item filter decides.
  const lit = (key: string) => (focus !== null && focusEdge !== undefined ? key === focusEdge.flow.from || key === focusEdge.flow.to : reach === null || reach.nodes.has(key));
  const edgeLit = (e: LaidEdge) => (focus !== null ? edgeKeyOf(e.flow) === focus.edgeKey : reach === null || e.parts.some((i) => reach.edges.has(i)));
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
  const stops = useMemo(() => (itemFocusOn ? bubbleStops(layout.edges, tabOrder.map((n) => n.key)) : []), [itemFocusOn, layout, tabOrder]);
  const stopNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const s of stops) {
      const e = edgeByKey.get(s.edgeKey);
      if (e === undefined) continue;
      const from = laidByKey.get(e.flow.from)?.title ?? "";
      const to = laidByKey.get(e.flow.to)?.title ?? "";
      const item = s.item === null ? undefined : e.bubbles.all.find((i) => i.key === s.item);
      names.set(s.id, item === undefined ? chipName(e.bubbles.more, from, to) : bubbleName(item, e.flow.unit, from, to));
    }
    return names;
  }, [stops, edgeByKey, laidByKey]);
  // The keyboard reaching a bubble brings its label into view, as a card's button does for its card.
  const focusStop = (stop: BubbleStop | null) => {
    setKeyStop(stop);
    if (stop === null) return;
    setActiveStop(stop.id);
    const e = edgeByKey.get(stop.edgeKey);
    if (e !== undefined) setView((v) => revealRect(v, { x: e.labelX - e.labelWidth / 2, y: e.labelY - e.labelHeight / 2, width: e.labelWidth, height: e.labelHeight }, stageRef.current));
  };
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
  const suggested = (key: string) => scene.level === "overview" && suggestions !== undefined && suggestions.keys.has(key);
  const factoryPicked = (card: Card) => card.kind === "factory" && factoryPicks !== undefined && factoryPicks.selected.has(card.key);
  const keepForm = suggestions?.keepForm;
  // A form for a card that is no longer a suggestion (switched off, kept elsewhere, gone from a poll) is dropped for good.
  // (React's adjust-state-during-render: it re-renders at once, before any child or effect sees the stale form.)
  const keepingGone = keeping !== null && !suggested(keeping);
  if (keepingGone) setKeeping(null);
  const closeKeep = (saved: boolean) => {
    if (!saved && keeping !== null) setRefocusKeep({ key: keeping });
    setKeeping(null);
  };

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
        {(selection !== undefined || overviewPicks) && (
          <div role="group" aria-label={selection !== undefined ? "Designate" : "Merge"} className="flex gap-2">
            <ToolButton
              name="Select"
              pressed={selectMode}
              onClick={() => setSelecting(!selecting)}
              icon={<path d="M12 4c4.4 0 8 2.2 8 5s-3.6 5-8 5-8-2.2-8-5 3.6-5 8-5zM7 13l-1 5 3-2" />}
            />
          </div>
        )}
        {transports.length > 0 && <MotionSelect value={motionPref} onChange={setMotionPref} />}
        {/* With item focus on, the status line stays mounted (a live region added with its words is often not read) and
            also says what focus did; the item filter's words show, focus's are for screen readers. */}
        {(reach !== null || itemFocusOn) && (
          <span role="status" className={reach === null ? "sr-only" : "w-full text-sm text-muted sm:w-auto"}>
            {reach !== null && (
              <>
                {reach.nodes.size} of {layout.nodes.length} {scene.level === "overview" ? "factories" : scene.level === "site" ? "groups" : "cards"} carry or feed this item.
              </>
            )}
            {itemFocusOn && announced !== "" && <span className="sr-only">{` ${announced}`}</span>}
          </span>
        )}
      </div>

      {keeping !== null && !keepingGone && keepForm !== undefined && keepForm(keeping, closeKeep)}

      {/* What a drag does now, or what to do about a drawing that runs past the canvas; the line keeps its height. */}
      <p className="m-0 h-lh text-sm text-muted">
        {pickingFactories
          ? (
              <>
                <span className="sm:hidden">Tap factories to pick them for a merge.</span>
                <span className="hidden sm:inline">Click factories to pick them for a merge; Escape clears.</span>
              </>
            )
          : selectMode
          ? (
              // One line at any width: a phone has no Shift or Escape, and one finger now draws, so two move the view.
              <>
                <span className="sm:hidden">Draw round cards to pick them; two fingers pan.</span>
                <span className="hidden sm:inline">Draw round cards to pick them, or click one. Shift adds; Escape clears.</span>
              </>
            )
          : overflowing
            ? "Drag or use the arrow keys to see more →"
            : factoryPicks !== undefined &&
              scene.level === "overview" && (
                // One line at any width: Select works everywhere; a keyboard or mouse also has Shift.
                <>
                  <span className="sm:hidden">Turn on Select to pick factories for a merge.</span>
                  <span className="hidden sm:inline">Turn on Select (or Shift-click) to pick factories for a merge.</span>
                </>
              )}
      </p>

      {/* From lg the group panel is a drawer over the canvas's right side (it never shrinks the canvas); below, it stacks. */}
      <div className="relative flex flex-col gap-3 lg:block">
        <div
          ref={viewportRef}
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
            onClick={itemFocusOn ? onCanvasClick : undefined}
            // A pan must not start a text selection or drag a building icon away as an image.
            onDragStart={(e) => e.preventDefault()}
            className={cn("max-h-map min-h-graph-min w-full touch-none select-none rounded-card border border-line bg-surface", selectMode && !pickingFactories ? "cursor-crosshair" : "cursor-grab")}
          >
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            <g ref={drawingRef} key={shape} transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`} className={cn(animate && "animate-graph-in")}>
              {/* During a make-room glide: the old lines and frames, where they were on screen, fading out. */}
              {ghost !== null && (
                <g ref={ghostRef} transform={`translate(${ghost.dx} ${ghost.dy})`} aria-hidden="true" data-ghost="" className="pointer-events-none">
                  {ghost.layout.frames.map((f) => (
                    <Frame key={f.key} frame={f} onCollapse={() => {}} />
                  ))}
                  {[EdgeLine, EdgeLabel].map((Layer, layer) => (
                    <g key={layer}>
                      {ghost.layout.edges.map((e) => (
                        <Layer key={e.index} edge={e} markerId={markerId} dim={false} moving={false} from="" to="" detail={detail} />
                      ))}
                    </g>
                  ))}
                </g>
              )}
              {/* The lines and frames of the picture now (faded in during a glide), then the cards over them. */}
              <g ref={freshRef}>
                {layout.frames.map((f) => (
                  <Frame key={f.key} frame={f} onCollapse={() => collapseBubble(f.bubbleKey)} />
                ))}
                {/* Every line first, then every label: a label is never under another edge's line (2026-10-27). */}
                {[EdgeLine, EdgeLabel].map((Layer, layer) => (
                  <g key={layer} data-edge-layer={layer === 0 ? "lines" : "labels"}>
                    {layout.edges.map((e) => {
                      const from = laidByKey.get(e.flow.from);
                      const to = laidByKey.get(e.flow.to);
                      const key = edgeKeyOf(e.flow);
                      const focusable = itemFocusOn
                        ? {
                            focused: focus !== null && focus.edgeKey === key ? focus.item : null,
                            ringed: keyStop !== null && keyStop.edgeKey === key ? keyStop.item ?? "+" : null,
                            onBubble: (item: BubbleItem) => focusItem(key, item),
                            onChip: () => openList(key),
                          }
                        : undefined;
                      return (
                        <Layer
                          key={e.index}
                          edge={e}
                          markerId={markerId}
                          dim={!edgeLit(e)}
                          moving={moving.has(e.index)}
                          from={from?.title ?? ""}
                          to={to?.title ?? ""}
                          detail={detail}
                          focusable={focusable}
                        />
                      );
                    })}
                  </g>
                ))}
              </g>
              {layout.nodes.map((n) => (
                <CardView
                  key={n.key}
                  node={n}
                  finding={findingsOf(n.key)}
                  ringed={openKey === n.key || focusKey === n.key}
                  picked={(selection !== undefined && isPicked(n.card, selection.selected)) || factoryPicked(n.card)}
                  suggested={suggested(n.key)}
                  dim={!lit(n.key)}
                  onActivate={(additive) => activate(n.card, additive)}
                  onToggleUpstream={() => toggleUpstream(n.key)}
                  onKeep={keepForm === undefined ? undefined : () => keepCard(n.key)}
                />
              ))}
              {/* Over the cards: the focused item's detail card, and one that is closing (shrinking back to its bubble). */}
              {closingCard !== null && card(closingCard, true)}
              {focus !== null && card(focus, false)}
              {lasso !== null && (
                <path d={lassoPath(lasso)} data-lasso="" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" className="pointer-events-none fill-info-soft stroke-info" />
              )}
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
              // In Select mode a pickable card's button picks it: a toggle, not an opener (on the overview, a factory).
              const picksFactory = pickingFactories && card.kind === "factory";
              const picks = (selectMode && pickable(card)) || picksFactory;
              const what = picksFactory ? card.description : cardButtonName(card);
              const name = `${what}${count > 0 ? `, ${bottleneckCountText(count)}` : ""}${suggested(n.key) ? ", suggestion" : ""}${factoryPicked(card) && !picksFactory ? ", selected" : ""}`;
              return (
                <li key={n.key}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) buttons.current.set(n.key, el);
                      else buttons.current.delete(n.key);
                    }}
                    aria-label={picks ? `Pick ${name}` : name}
                    aria-pressed={picksFactory ? factoryPicked(card) : picks && selection !== undefined ? isPicked(card, selection.selected) : undefined}
                    aria-expanded={picks ? undefined : card.kind === "group" ? openKey === n.key : card.kind === "factory" ? undefined : false}
                    aria-controls={!picks && card.kind === "group" && openKey === n.key ? panelId : undefined}
                    onClick={(e) => {
                      dragged.current = false;
                      activate(card, e.shiftKey || e.ctrlKey || e.metaKey);
                    }}
                    onFocus={() => focusNode(n)}
                    onBlur={() => setFocusKey((k) => (k === n.key ? null : k))}
                    className="sr-only"
                  />
                </li>
              );
            })}
          </ul>
          {keepForm !== undefined && tabOrder.some((n) => suggested(n.key)) && (
            <ul aria-label="Suggested factories" className="m-0 list-none p-0">
              {tabOrder.flatMap((n) =>
                suggested(n.key)
                  ? [
                      <li key={n.key}>
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) keepButtons.current.set(n.key, el);
                            else keepButtons.current.delete(n.key);
                          }}
                          onClick={() => setKeeping(n.key)}
                          onFocus={() => focusNode(n)}
                          onBlur={() => setFocusKey((k) => (k === n.key ? null : k))}
                          className="sr-only"
                        >
                          {`Keep ${n.card.label}`}
                        </button>
                      </li>,
                    ]
                  : [],
              )}
            </ul>
          )}
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
          <BubbleButtons
            stops={stops}
            names={stopNames}
            active={activeStop}
            focus={focus}
            listOpen={listEdge === undefined ? null : listKey}
            buttons={bubbleButtons}
            onActivate={activateStop}
            onFocusStop={focusStop}
          />
          {/* The open card for the keyboard and screen readers: its words, then its two controls (Decision 5). */}
          {openCard !== null && (
            <div role="group" aria-label={`${openCard.item.name ?? "Item unknown"} card`} className="sr-only">
              <p>{openCard.text.full}</p>
              <button type="button" onClick={leaveFocus}>
                {`Close ${openCard.item.name ?? "Item unknown"} card`}
              </button>
              {openCard.path !== null && (
                <button type="button" onClick={() => showPath(openCard.path!)}>
                  {`Show the whole path of ${openCard.item.name ?? "Item unknown"}`}
                </button>
              )}
            </div>
          )}
        </div>
        {listEdge !== undefined && listKey !== null && (
          <div className="rounded-card bg-surface lg:absolute lg:inset-y-0 lg:right-0 lg:w-graph-panel lg:overflow-y-auto">
            <ItemList
              key={listKey}
              id={`${panelId}-items`}
              flow={listEdge.flow}
              items={listEdge.bubbles.all}
              from={titleOf(listEdge.flow.from)}
              to={titleOf(listEdge.flow.to)}
              focus={focus}
              onFocusItem={(item) => {
                dragged.current = false;
                focusItem(listKey, item);
              }}
              onClose={closeList}
            />
          </div>
        )}
        {openNode && (
          <div ref={panelRef} className="rounded-card bg-surface lg:absolute lg:inset-y-0 lg:right-0 lg:w-graph-panel lg:overflow-y-auto">
            <GroupPanel
              key={openNode.key}
              id={panelId}
              node={openNode}
              facts={laidByKey.get(openNode.key)?.card.facts}
              rates={rates}
              findings={findings}
              onClose={close}
              onPopOut={onPopOut === undefined ? undefined : () => onPopOut(openNode.key)}
            />
          </div>
        )}
      </div>

      <Legend modes={modes} />
    </div>
  );
}

/** A card's keyboard name: what it is, and for a factory that choosing it opens it. */
function cardButtonName(card: Card): string {
  return card.kind === "factory" ? `Open factory: ${card.description}` : card.description;
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

/** A label's part in item focus (behind its flag): the focused item's key, the stop the keyboard is on ("+" the chip), and
 *  what a click on a bubble or the chip does. Absent with the flag off: the bubbles are then only a picture. */
type Focusable = { focused: string | null; ringed: string | null; onBubble: (item: BubbleItem) => void; onChip: () => void };

type EdgeProps = { edge: LaidEdge; markerId: string; dim: boolean; moving: boolean; from: string; to: string; detail: BubbleDetail; focusable?: Focusable | undefined };

/** A flow's line (one link, or a bundle's): drawn in the lines layer, under every label. */
function EdgeLine({ edge: e, markerId, dim, from, to }: EdgeProps) {
  return (
    <g data-edge={e.index} className={cn("transition-opacity", dim && "opacity-graph-dim")}>
      <title>{flowTitle(e.flow, from, to)}</title>
      <path d={roundedOrthogonalPath(e.points)} fill="none" strokeWidth={edgeWidth(e.flow.mixed)} strokeDasharray={edgeDash(e.flow.rate)} markerEnd={`url(#${markerId})`} className={edgeClass(e.flow)} />
    </g>
  );
}

/**
 * A flow's label with a halo: a bubble per item it carries (its icon, up to three, then a "+k" chip) over the short rate
 * text (ADR-0060 Decision 1), and for a transport the mode's glyph (moving along the line when it may). Above every line.
 * The words for each item stay in the `<title>` and the Tables view.
 */
function EdgeLabel({ edge: e, dim, moving, from, to, detail, focusable }: EdgeProps) {
  const transport = isTransport(e.flow);
  const seconds = Math.min(GLYPH_MAX_S, Math.max(GLYPH_MIN_S, e.length / GLYPH_SPEED));
  const row = e.bubbles;
  const top = e.labelY - e.labelHeight / 2 + LABEL_PAD / 2;
  // The same geometry the detail card's morph starts from (`bubbleCentre`).
  const { left, cy } = bubbleRowOrigin(e);
  const at = bubbleOffsets(row);
  return (
    <g data-edge-label={e.index} className={cn("transition-opacity", dim && "opacity-graph-dim")}>
      <title>{flowTitle(e.flow, from, to)}</title>
      {/* In the box the layout reserved for it: a pill over its own line, so the line stops at the bubbles. */}
      <rect
        x={e.labelX - e.labelWidth / 2}
        y={e.labelY - e.labelHeight / 2}
        width={e.labelWidth}
        height={e.labelHeight}
        rx={Math.min(e.labelHeight, e.labelWidth) / 2}
        data-label-pill=""
        className="fill-surface"
      />
      {row.items.map((item, i) => (
        <ItemBubble
          key={item.key}
          item={item}
          cx={left + at.bubbles[i]}
          cy={cy}
          detail={detail}
          focused={focusable?.focused === item.key}
          ringed={focusable?.ringed === item.key}
          onClick={focusable === undefined ? undefined : () => focusable.onBubble(item)}
        />
      ))}
      {at.chip !== null && (
        <g data-bubble-more={row.more} onClick={focusable?.onChip} className={cn(focusable !== undefined && "cursor-pointer")}>
          <rect
            x={left + at.chip - CHIP_W / 2}
            y={cy - CHIP_H / 2}
            width={CHIP_W}
            height={CHIP_H}
            rx={CHIP_H / 2}
            className={cn("fill-icon-chip", focusable?.ringed === "+" ? "stroke-accent" : "stroke-line")}
          />
          {detail.full && (
            <text x={left + at.chip} y={cy} textAnchor="middle" dominantBaseline="central" className="fill-surface text-xs">
              {`+${row.more}`}
            </text>
          )}
        </g>
      )}
      {detail.full && row.rateText !== null && (
        <text x={e.textX} y={top + BUBBLE_D + LABEL_LINE_H / 2} textAnchor="middle" dominantBaseline="central" strokeWidth={4} className="fill-fg stroke-surface text-sm paint-stroke-first">
          {row.rateText}
        </text>
      )}
      {/* After the label: at rest the glyph stands inside its own pill, left of the words; moving, it travels the line. */}
      {transport && (
        <g transform={moving ? undefined : `translate(${e.mid.x} ${e.mid.y})`} data-moving={moving}>
          <TransportGlyph mode={e.flow.carrier} />
          {moving && <animateMotion path={roundedOrthogonalPath(e.points)} dur={`${seconds}s`} repeatCount="indefinite" calcMode="linear" />}
        </g>
      )}
    </g>
  );
}

/**
 * One item's bubble on a line: its icon on a disc, or, when its class has none (or the file fails to load), the item name's
 * initials, or "?" for an unknown item. Never blank. Below `BUBBLE_DETAIL_ZOOM` only the disc.
 */
function ItemBubble({
  item,
  cx,
  cy,
  detail,
  focused = false,
  ringed = false,
  onClick,
}: {
  item: BubbleItem;
  cx: number;
  cy: number;
  detail: BubbleDetail;
  /** The item in focus mode: a thick accent ring. */
  focused?: boolean;
  /** The keyboard is on its button: the accent ring. */
  ringed?: boolean;
  /** Focus it (item focus on); a picture only otherwise. */
  onClick?: (() => void) | undefined;
}) {
  const url = item.className === null ? undefined : itemIconUrl(item.className, detail.iconSize);
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  const picture = detail.full && url !== undefined && url !== failedUrl;
  return (
    <g
      aria-hidden="true"
      data-bubble={item.className ?? "unknown"}
      data-icon={!detail.full ? "disc" : picture ? "image" : "text"}
      data-focused={focused || undefined}
      onClick={onClick}
      className={cn(onClick !== undefined && "cursor-pointer")}
    >
      <circle cx={cx} cy={cy} r={BUBBLE_D / 2} strokeWidth={focused ? 3 : 1} className={cn("fill-icon-chip", focused || ringed ? "stroke-accent" : "stroke-line")} />
      {picture ? (
        <image href={url} x={cx - BUBBLE_ICON / 2} y={cy - BUBBLE_ICON / 2} width={BUBBLE_ICON} height={BUBBLE_ICON} onError={() => setFailedUrl(url)} />
      ) : (
        detail.full && (
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="fill-surface text-xs">
            {item.text}
          </text>
        )
      )}
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

/**
 * A card's picture: the building's icon on its chip, or, when its class has none (or the file fails to load), the glyph for
 * its kind on the same chip. Never a bare box.
 */
function CardIcon({ iconUrl, glyph }: { iconUrl: string | undefined; glyph: GlyphKind }) {
  const [failed, setFailed] = useState(false);
  const picture = iconUrl !== undefined && !failed;
  return (
    <g aria-hidden="true" data-icon={picture ? "image" : "glyph"}>
      <rect x={NODE_PAD_X} y={ICON_TOP} width={BUILDING_ICON_SIZE} height={BUILDING_ICON_SIZE} rx={6} className="fill-icon-chip" />
      {picture ? (
        <image href={iconUrl} x={NODE_PAD_X} y={ICON_TOP} width={BUILDING_ICON_SIZE} height={BUILDING_ICON_SIZE} onError={() => setFailed(true)} />
      ) : (
        <g transform={`translate(${NODE_PAD_X + BUILDING_ICON_SIZE / 2} ${ICON_TOP + BUILDING_ICON_SIZE / 2}) scale(${BUILDING_ICON_SIZE / GLYPH_BOX})`}>
          <BuildingGlyph kind={glyph} />
        </g>
      )}
    </g>
  );
}

function CardView({
  node: n,
  finding,
  ringed,
  picked,
  suggested,
  dim,
  onActivate,
  onToggleUpstream,
  onKeep,
}: {
  node: LaidNode;
  finding: number;
  ringed: boolean;
  /** Picked to designate: tinted, with a check on its corner (not colour alone). */
  picked: boolean;
  /** An automatic factory shown as a suggestion: a dashed outline, a "Suggestion" tag and Keep. */
  suggested: boolean;
  dim: boolean;
  /** `additive`: Shift, Ctrl or Cmd was held (a pick on the overview, not an open). */
  onActivate: (additive: boolean) => void;
  onToggleUpstream: () => void;
  onKeep: (() => void) | undefined;
}) {
  const card = n.card;
  const stacked = card.kind === "bubble" || card.kind === "fold";
  const up = card.upstream;
  const pillText = up === undefined ? "" : up.collapsed ? `+${up.count}` : "−";
  const pillW = Math.max(PILL_MIN_W, pillText.length * CHAR_W_BODY + 16);
  const { tagX, showTag } = suggestionTag(suggested, finding > 0, n.width);
  return (
    <g
      transform={`translate(${n.x} ${n.y})`}
      onClick={(e) => onActivate(e.shiftKey || e.ctrlKey || e.metaKey)}
      data-card={card.kind}
      data-node={n.key}
      data-picked={picked || undefined}
      data-suggested={suggested || undefined}
      className={cn("cursor-pointer transition-opacity", dim && "opacity-graph-dim")}
    >
      <title>{suggested ? `${card.description} (suggestion)` : card.description}</title>
      {/* A pile of cards behind a bubble or a fold: more than one thing is in it. */}
      {stacked && <rect x={5} y={5} width={n.width} height={n.height} rx={8} strokeWidth={1} className="fill-surface stroke-line" />}
      <rect
        width={n.width}
        height={n.height}
        rx={8}
        strokeWidth={ringed || picked ? 3 : suggested ? 2 : 1}
        // Dotted, so a suggestion never reads as an opened bubble's dashed frame.
        strokeDasharray={suggested && !ringed ? "2 3" : undefined}
        className={cn("fill-surface-2", ringed ? "stroke-accent" : picked ? "stroke-info" : suggested ? "stroke-muted" : "stroke-line")}
      />
      {picked && <rect width={n.width} height={n.height} rx={8} className="pointer-events-none fill-info-soft" />}
      <CardIcon iconUrl={n.iconUrl} glyph={card.glyph} />
      {picked && (
        // Just outside the corner, clear of the icon chip.
        <g aria-hidden="true" data-check="" transform={`translate(${-CHECK_R / 2} ${-CHECK_R / 2})`}>
          <circle r={CHECK_R} className="fill-info-solid stroke-surface" strokeWidth={2} />
          <path d="M-4.5 0 L-1.5 3 L4.5 -3.5" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="stroke-fg-strong" />
        </g>
      )}
      {showTag && (
        <g transform={`translate(${tagX} ${-BADGE_H / 2})`} data-suggestion-tag="">
          <rect width={BADGE_W} height={BADGE_H} rx={8} strokeWidth={1} className="fill-surface stroke-muted" />
          <text x={BADGE_W / 2} y={BADGE_H / 2} textAnchor="middle" dominantBaseline="central" className="fill-fg text-sm">
            Suggestion
          </text>
        </g>
      )}
      {card.count !== undefined && (
        <g transform={`translate(${NODE_PAD_X + BUILDING_ICON_SIZE + BUILDING_ICON_GAP} ${ICON_TOP + (BUILDING_ICON_SIZE - COUNT_BADGE_H) / 2})`} data-count={card.count}>
          <rect width={countBadgeWidth(card.count)} height={COUNT_BADGE_H} rx={COUNT_BADGE_H / 2} strokeWidth={1} className="fill-surface stroke-line" />
          <text x={countBadgeWidth(card.count) / 2} y={COUNT_BADGE_H / 2} textAnchor="middle" dominantBaseline="central" className="fill-fg-strong text-base font-semibold">
            {`×${card.count}`}
          </text>
        </g>
      )}
      {/* One line (a factory's name, then one line; an extractor's muted "(inferred from the node)" under it); the recipe, the other outputs and the rest are in the tooltip and the panel. */}
      {n.lines.map((line, i) => (
        <text
          key={i}
          x={NODE_PAD_X}
          y={cardLineY(i)}
          className={cn(isHeadingLine(card, i) ? "fill-fg-strong text-base font-semibold" : card.mutedFrom !== undefined && i >= card.mutedFrom ? "fill-muted text-sm" : "fill-fg text-sm")}
        >
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
          <rect width={pillW} height={PILL_H} rx={PILL_H / 2} strokeWidth={1} className="fill-surface-2 stroke-muted" />
          <text x={pillW / 2} y={PILL_H / 2} textAnchor="middle" dominantBaseline="central" className="fill-fg text-sm font-semibold">
            {pillText}
          </text>
        </g>
      )}
      {/* Keep a suggestion: a pill at the bottom-right, its hit area up to the touch size; the hidden "Keep" button is the
          keyboard's way in. */}
      {suggested && onKeep !== undefined && (
        <g
          transform={`translate(${n.width - KEEP_W - 8} ${n.height - PILL_H / 2})`}
          onClick={(e) => {
            e.stopPropagation();
            onKeep();
          }}
          data-keep=""
          className="cursor-pointer"
        >
          <title>{`Keep ${card.label}`}</title>
          <rect x={-8} y={(PILL_H - PILL_HIT) / 2} width={Math.max(KEEP_W + 16, PILL_HIT)} height={PILL_HIT} className="fill-transparent" />
          <rect width={KEEP_W} height={PILL_H} rx={PILL_H / 2} strokeWidth={1} className="fill-surface-2 stroke-info" />
          <text x={KEEP_W / 2} y={PILL_H / 2} textAnchor="middle" dominantBaseline="central" className="fill-fg text-sm font-semibold">
            Keep
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

/** The samples, then one line on why an item or a rate can be unknown (#728 step 5). */
function Legend({ modes }: { modes: readonly string[] }) {
  return (
    <div className="grid gap-1">
      <LegendSamples modes={modes} />
      <p className="m-0 text-sm text-muted">{UNKNOWN_FLOW_NOTE}</p>
    </div>
  );
}

function LegendSamples({ modes }: { modes: readonly string[] }) {
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
          <svg aria-hidden="true" viewBox="-15 -15 30 30" className="size-5 shrink-0">
            <TransportGlyph mode={mode} />
          </svg>
          <span>{carrierWord(mode).toLowerCase()}</span>
        </li>
      ))}
    </ul>
  );
}
