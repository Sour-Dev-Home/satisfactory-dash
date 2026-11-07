import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { QueryClientContext } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { whenIdle } from "../../lib/idle";
import { ServerContext } from "../../servers/ServerContext";
import { initialTourState, isLastStep, tourReducer } from "./controller";
import { markTourSeen, shouldAutoStart } from "./persistence";
import { padBox, scrollToShow, SHEET_MAX_SHARE, sheetAtTop, type Box, type Size } from "./placePopover";
import { AttachedPopover, SheetPopover } from "./Popover";
import { Spotlight } from "./Spotlight";
import { stepLine, tabLabel, TOUR_STEPS, type TourStep } from "./steps";
import { tabTarget } from "./tabTarget";
import { registerTourHost, startTour, stopTour, useTour } from "./tourStore";
import { isTypingField, pressTarget, revealByKeyPath, tabStopOf, watchDone } from "./tryIt";
import { findReadyTarget, targetSelector, TOUR_SETTLE_MS, TOUR_TARGET_WAIT_MS, waitForTarget } from "./waitForTarget";
import { warmTour, type WarmContext } from "./warm";

/** The banner's "Take the tour" button: where focus goes when the tour ends and where it was is gone. */
export const BANNER_TOUR_TARGET = "demo-banner-tour";

/**
 * The demo's guided tour (ADR-0065), a lazy chunk mounted by the Shell in the demo build only. It starts by itself on
 * the first visit to exactly `/app` (marking it seen at the start), and again whenever the banner's button starts it.
 */
export default function TourHost({
  steps = TOUR_STEPS,
  settleMs = TOUR_SETTLE_MS,
  warm = warmTour,
  schedule = whenIdle,
}: {
  steps?: readonly TourStep[];
  /** How long a new page's target must keep still before its step shows (tests pass 0). */
  settleMs?: number;
  /** Warms the tour's pages when it starts (tests pass a stub). */
  warm?: (steps: readonly TourStep[], context: WarmContext) => void;
  /** When the warming runs; returns a cancel (tests run it at once). */
  schedule?: (task: () => void) => () => void;
}) {
  const { active, run } = useTour();
  const { pathname } = useLocation();
  const firstPath = useRef(pathname);
  useEffect(() => registerTourHost(), []);
  useEffect(() => {
    if (!shouldAutoStart(firstPath.current)) return;
    markTourSeen();
    startTour();
  }, []);
  if (!active || steps.length === 0) return null;
  return createPortal(<TourRun key={run} steps={steps} settleMs={settleMs} warm={warm} schedule={schedule} />, document.body);
}

/**
 * The step's page's tab in the top nav, scrolled into the nav's view (a phone's nav scrolls sideways; instant, and only
 * the nav, never the page), or null where there is no such tab. A tab with no box (hidden behind a menu) gets no hole.
 */
function findTab(path: string): Element | null {
  const tab = document.querySelector(targetSelector(tabTarget(path)));
  if (tab === null) return null;
  const nav = tab.parentElement;
  if (nav !== null && typeof nav.scrollTo === "function") {
    const t = tab.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    if (t.left < n.left) nav.scrollTo({ left: nav.scrollLeft - (n.left - t.left), behavior: "instant" });
    else if (t.right > n.right) nav.scrollTo({ left: nav.scrollLeft + (t.right - n.right), behavior: "instant" });
  }
  return tab;
}

/** A CSS length token in px (`8px`), or the fallback where no stylesheet is loaded (unit tests). */
function tokenPx(name: string, fallback: number): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

const WIDE_QUERY = "(min-width: 40rem)"; // Tailwind's `sm`

function useWide(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY) : null;
    list?.addEventListener("change", onChange);
    return () => list?.removeEventListener("change", onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

const readViewport = (): Size => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });

function useViewport(): Size {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const onResize = () => setViewport((v) => {
      const next = readViewport();
      return v.width === next.width && v.height === next.height ? v : next;
    });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

/** The target's box, read every frame while it shows (a page fades in, the planner's canvas pans); `onLost` once it goes. */
function useTargetBox(target: Element | null, onLost: (el: Element) => void): Box | null {
  // The box with the element it was read from: a new target never shows, even for one frame, at the last one's place.
  const [read, setRead] = useState<{ el: Element; box: Box } | null>(null);
  const lost = useRef(onLost);
  useEffect(() => {
    lost.current = onLost;
  });
  // The first read in a layout effect: the frame that first paints a new target paints it at its own box.
  useLayoutEffect(() => {
    if (target === null) return;
    let frame = 0;
    const tick = () => {
      if (!target.isConnected) {
        lost.current(target);
        return;
      }
      const r = target.getBoundingClientRect();
      const box = { x: r.x, y: r.y, width: r.width, height: r.height };
      setRead((was) => (was !== null && was.el === target && sameBox(was.box, box) ? was : { el: target, box }));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return target === null || read === null || read.el !== target ? null : read.box;
}

/**
 * The box of the tab for `path` (null for none), found and scrolled into the nav's view each time `step` changes, then
 * read every frame as the target's is. Null where the tab has no box.
 */
function useTabBox(path: string | null, step: number | null): Box | null {
  const [read, setRead] = useState<{ path: string; step: number | null; box: Box | null } | null>(null);
  useLayoutEffect(() => {
    if (path === null) return;
    const tab = findTab(path);
    let frame = 0;
    const tick = () => {
      const r = tab?.isConnected === true ? tab.getBoundingClientRect() : null;
      const box = r === null || r.width <= 0 || r.height <= 0 ? null : { x: r.x, y: r.y, width: r.width, height: r.height };
      setRead((was) =>
        was !== null && was.path === path && was.step === step && (was.box === box || (was.box !== null && box !== null && sameBox(was.box, box)))
          ? was
          : { path, step, box },
      );
      if (tab !== null) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [path, step]);
  return path === null || read === null || read.path !== path || read.step !== step ? null : read.box;
}

/**
 * Scrolls a step's target into view, instantly (ADR-0065 amendment, 2026-11-07). Where the padded target and its page's
 * tab fit on screen together (leaving a phone's bottom sheet clear), the page moves the least that shows both, so the
 * tab's hole is seen; otherwise the target is centred as before, and the step line still names the tab.
 */
function bringIntoView(el: Element, path: string): void {
  const pad = tokenPx("--spacing-tour-pad", 8);
  const r = el.getBoundingClientRect();
  const target = padBox({ x: r.x, y: r.y, width: r.width, height: r.height }, pad);
  const tabEl = document.querySelector(targetSelector(tabTarget(path)));
  const t = tabEl?.getBoundingClientRect();
  const tab = t === undefined || t.width <= 0 || t.height <= 0 ? null : { x: t.x, y: t.y, width: t.width, height: t.height };
  const height = document.documentElement.clientHeight;
  const wide = typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
  // A phone's sheet sits at the bottom while the target is in the top 60% of the screen, which fitting it there keeps so.
  const reserve = { top: 0, bottom: wide ? 0 : height * SHEET_MAX_SHARE };
  const to = scrollToShow(target, tab, height, window.scrollY, reserve);
  if (to === null) {
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", behavior: "instant" });
    return;
  }
  if (Math.abs(to - window.scrollY) >= 1) window.scrollTo({ top: to, behavior: "instant" });
}

function TourRun({
  steps,
  settleMs,
  warm,
  schedule,
}: {
  steps: readonly TourStep[];
  settleMs: number;
  warm: (steps: readonly TourStep[], context: WarmContext) => void;
  schedule: (task: () => void) => () => void;
}) {
  const count = steps.length;
  // Everything the tour will visit is warmed once, as it starts: each page's lazy chunk and its primary queries.
  const client = useContext(QueryClientContext);
  const serverId = useContext(ServerContext)?.id;
  // Once the first page's own reads have gone (`whenIdle`): the tour starts on the Overview as it loads, and the warming
  // must not hold it back. Steps 1-3 are on the Overview, so the rest is warm long before step 4.
  const warmed = useRef(false);
  useEffect(
    () =>
      schedule(() => {
        if (warmed.current) return;
        warmed.current = true;
        warm(steps, { client, serverId });
      }),
    [schedule, warm, steps, client, serverId],
  );
  const centred = useCallback((i: number) => steps[i]?.target === undefined, [steps]);
  const reducer = useMemo(() => tourReducer(count, centred), [count, centred]);
  const [state, dispatch] = useReducer(reducer, centred, initialTourState);
  const step = steps[state.index];
  const navigate = useNavigate();
  const location = useLocation();
  // Read through refs: the router hands out a new navigate on every location change, and the step's effect must run on a
  // new step only, or a click through the hole that changes the page would be undone.
  const here = useRef(location.pathname + location.search);
  const go = useRef(navigate);
  // The page of the step on screen, read when the next step begins: a step on a new page waits for its target to settle.
  const shownPath = useRef<string | null>(null);
  useEffect(() => {
    here.current = location.pathname + location.search;
    go.current = navigate;
    shownPath.current = state.shown === null ? null : (steps[state.shown]?.path ?? null);
  });
  const [target, setTarget] = useState<Element | null>(null);
  // The target as last set, read by `onLost`: the previous step's element can be seen gone (its page unmounted) on a frame
  // after the next step's target was found but before React rendered it, and must not knock the new step to fallback.
  const targetRef = useRef<Element | null>(null);

  // Each step goes to its page, then waits for its target (Decision 4). The last step's box stays on screen meanwhile.
  useEffect(() => {
    const want = step.path + (step.search ?? "");
    if (here.current !== want) void go.current(want);
    // A step about the whole page has no target: the reducer shows it centred at once, so nothing is awaited.
    if (step.target === undefined) return undefined;
    const own = step.target;
    // A target only clicks show (the planner's Graph view, then its group panel; the address keeps neither): each opener
    // in turn, once ready, gets a bubbling click (as "Do it for me" does), unless the target or a later opener is there.
    const openers = step.openedBy === undefined ? [] : typeof step.openedBy === "string" ? [step.openedBy] : step.openedBy;
    let opening: (() => void) | undefined;
    const open = (i: number) => {
      const id = openers.at(i);
      if (id === undefined) return;
      opening = waitForTarget(id, {
        onFound: (el) => {
          const later = [own, ...openers.slice(i + 1)];
          if (later.every((t) => findReadyTarget(t) === null)) el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          open(i + 1);
        },
        onTimeout: () => open(i + 1),
      });
    };
    open(0);
    // A target on a new page (or one only a click shows) is shown once its box has kept still for `settleMs`: a lazy chunk
    // mounting or a chart laying out moves it for a few frames after the page reveals. On the same page it shows at once.
    const settles = shownPath.current !== step.path || openers.length > 0;
    const cancel = waitForTarget(own, {
      settleMs: settles ? settleMs : 0,
      onFound: (el) => {
        // A card drawn inside the planner's canvas is panned into view through its keyboard path first (a phone's canvas
        // can leave it off the screen; the page cannot scroll it there).
        if (step.keyTarget !== undefined) revealByKeyPath(step.keyTarget);
        bringIntoView(el, step.path);
        targetRef.current = el;
        setTarget(el);
        dispatch({ type: "found" });
      },
      onTimeout: () => {
        targetRef.current = null;
        setTarget(null);
        dispatch({ type: "timeout" });
      },
    });
    return () => {
      opening?.();
      cancel();
    };
  }, [step, settleMs]);

  // A try-it step (Decision 6) is seen done by what appears or changes, and the tour then moves on by itself. Next stays
  // enabled meanwhile: moving on without doing it is fine (step 10's openers then open the panel instead).
  const [doneInto, setDoneInto] = useState<number | null>(null);
  const [pressedAt, setPressedAt] = useState<number | null>(null);
  useEffect(() => {
    if (step.kind !== "try" || step.done === undefined) return undefined;
    const stop = watchDone(step.done, () => {
      setDoneInto(steps.indexOf(step) + 1);
      dispatch({ type: "next" });
    });
    return stop;
  }, [step, steps]);


  const onLost = useCallback((el: Element) => {
    if (targetRef.current !== el) return;
    targetRef.current = null;
    setTarget(null);
    dispatch({ type: "lost" });
  }, []);
  const targetBox = useTargetBox(target, onLost);
  const viewport = useViewport();
  const wide = useWide();
  const [pad] = useState(() => tokenPx("--spacing-tour-pad", 8));
  const [tabPad] = useState(() => tokenPx("--spacing-tour-tab-pad", 2));
  const [radius] = useState(() => tokenPx("--radius-card", 10));
  // Going to a new page: the last step's hole, ring and popover would sit over a page changing underneath, so until the new
  // step shows there is only the plain scrim, and focus waits on a holder inside the tour (below).
  const changingPage = state.phase === "waiting" && state.shown !== null && steps[state.shown]?.path !== step.path;
  const hole = changingPage || state.phase === "fallback" || targetBox === null ? null : padBox(targetBox, pad);

  // The tab of the shown step's page gets its own, quieter hole (ADR-0065 amendment, 2026-11-07).
  const tabPath = changingPage || state.shown === null ? null : (steps[state.shown]?.path ?? null);
  const tabBox = useTabBox(tabPath, state.shown);
  // On a phone a sheet at the top would cover the tab's hole; the sheet's step line names the tab instead (ui-reviewer).
  const tabUnderSheet = !wide && tabBox !== null && sheetAtTop(hole, viewport) && tabBox.y < viewport.height * SHEET_MAX_SHARE;
  const tab = tabBox === null || tabUnderSheet ? null : padBox(tabBox, tabPad);

  const exit = useCallback(() => {
    const to = stopTour() ?? document.querySelector<HTMLElement>(targetSelector(BANNER_TOUR_TARGET));
    to?.focus();
  }, []);
  // Finish is the last step's Next: it ends the tour as Skip does, and writes nothing more (the start marked it seen).
  const onNext = useCallback(() => {
    setDoneInto(null);
    setPressedAt(null);
    if (isLastStep(state, count) && state.shown === state.index) exit();
    else dispatch({ type: "next" });
  }, [state, count, exit]);
  const onBack = useCallback(() => {
    setDoneInto(null);
    setPressedAt(null);
    dispatch({ type: "back" });
  }, []);

  // A try-it step showing its target: Do it for me, and Tab reaching the target (Decisions 6 and 9).
  const trying = step.kind === "try" && state.phase === "showing" && state.shown === state.index && target !== null ? target : null;
  const tabStop = useCallback(() => (trying === null ? null : tabStopOf(trying, step.keyTarget)), [trying, step]);
  const onDoForMe = useCallback(() => {
    if (trying === null) return;
    const index = state.index;
    // Focus waits on the heading (the button turns disabled; a panel that opens may take focus, as a real click's would).
    document.querySelector<HTMLElement>("[data-tour-popover] h2")?.focus({ preventScroll: true });
    // Pressed once only. Already ticked: nothing to press, so the step is as good as done.
    if (!pressTarget(trying)) {
      dispatch({ type: "next" });
      return;
    }
    setPressedAt(index);
  }, [trying, state.index]);
  // Do it for me pressed and nothing registered (the page did not answer): the step goes on as a Next step would.
  useEffect(() => {
    if (pressedAt === null || pressedAt !== state.index) return undefined;
    const timer = setTimeout(() => dispatch({ type: "next" }), TOUR_TARGET_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pressedAt, state.index]);
  const offerDoForMe = trying !== null && step.doForMe === true;
  const doForMePressed = pressedAt === state.index;

  // While a new page loads, focus waits on this holder, inside the tour: the popover that had it is gone, and focus left on
  // <body> would be taken by the new page's heading (the shell's move on navigation), out of the tour.
  const holder = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (changingPage) holder.current?.focus({ preventScroll: true });
  }, [changingPage]);

  // Escape leaves the tour from anywhere on the page, not only the popover (Decision 9), unless something handled it first
  // (the planner's group panel stops it; its canvas marks it handled) or focus is typing in a field. On a try-it step, Tab
  // from the target goes back into the popover, closing the loop the popover's own Tab opens.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") {
        // Typing in a field, or inside another open native dialog (the command palette): Escape is theirs.
        if (isTypingField(e.target) || (e.target instanceof Element && e.target.closest("dialog[open]") !== null)) return;
        e.preventDefault();
        exit();
        return;
      }
      if (e.key !== "Tab") return;
      // Waiting for the next page: Tab stays on the holder rather than reaching the page behind the scrim (test-hunter).
      if (holder.current !== null && document.activeElement === holder.current) {
        e.preventDefault();
        return;
      }
      const stop = tabStop();
      if (stop === null || document.activeElement !== stop) return;
      const buttons = [...document.querySelectorAll<HTMLElement>("[data-tour-popover] button:not(:disabled)")];
      const to = e.shiftKey ? buttons.at(-1) : buttons.at(0);
      if (to === undefined) return;
      e.preventDefault();
      to.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [exit, tabStop]);

  const shown = state.shown === null ? null : steps[state.shown];
  const panel =
    shown === null || state.shown === null || changingPage
      ? null
      : {
          step: shown,
          number: state.shown + 1,
          count,
          onBack,
          onNext,
          onExit: exit,
          onDoForMe: offerDoForMe ? onDoForMe : undefined,
          doForMePressed,
          tabStop: trying === null ? undefined : tabStop,
          target: hole,
          viewport,
        };

  return (
    <div data-tour-root="" data-tour-phase={state.phase} className="pointer-events-none fixed inset-0 z-(--z-tour)">
      <Spotlight viewport={viewport} hole={hole} tab={tab} radius={radius}>
        {wide && panel !== null && <AttachedPopover {...panel} />}
      </Spotlight>
      {!wide && panel !== null && <SheetPopover {...panel} />}
      {changingPage && (
        <div
          ref={holder}
          role="dialog"
          aria-label="Guided tour"
          aria-busy="true"
          tabIndex={-1}
          data-tour-waiting=""
          className="sr-only"
        >
          Opening the next page.
        </div>
      )}
      <p role="status" className="sr-only">
        {/* After a try-it step is done, one announcement: "Done." with the next step's place, not two. */}
        {shown === null || state.shown === null || state.phase === "waiting"
          ? ""
          : `${doneInto === state.shown ? "Done. " : ""}${stepLine(state.shown + 1, count, tabLabel(shown.path))}`}
      </p>
    </div>
  );
}
