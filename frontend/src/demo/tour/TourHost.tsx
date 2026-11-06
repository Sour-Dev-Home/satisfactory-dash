import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { initialTourState, isLastStep, tourReducer } from "./controller";
import { markTourSeen, shouldAutoStart } from "./persistence";
import { padBox, type Box, type Size } from "./placePopover";
import { AttachedPopover, SheetPopover } from "./Popover";
import { Spotlight } from "./Spotlight";
import { TOUR_STEPS, type TourStep } from "./steps";
import { registerTourHost, startTour, stopTour, useTour } from "./tourStore";
import { findReadyTarget, targetSelector, waitForTarget } from "./waitForTarget";

/** The banner's "Take the tour" button: where focus goes when the tour ends and where it was is gone. */
export const BANNER_TOUR_TARGET = "demo-banner-tour";

/**
 * The demo's guided tour (ADR-0065), a lazy chunk mounted by the Shell in the demo build only. It starts by itself on
 * the first visit to exactly `/app` (marking it seen at the start), and again whenever the banner's button starts it.
 */
export default function TourHost({ steps = TOUR_STEPS }: { steps?: readonly TourStep[] }) {
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
  return createPortal(<TourRun key={run} steps={steps} />, document.body);
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
function useTargetBox(target: Element | null, onLost: () => void): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  const lost = useRef(onLost);
  useEffect(() => {
    lost.current = onLost;
  });
  useEffect(() => {
    if (target === null) return;
    let frame = 0;
    const read = () => {
      if (!target.isConnected) {
        lost.current();
        return;
      }
      const r = target.getBoundingClientRect();
      const next = { x: r.x, y: r.y, width: r.width, height: r.height };
      setBox((b) => (sameBox(b, next) ? b : next));
      frame = requestAnimationFrame(read);
    };
    read();
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return target === null ? null : box;
}

function TourRun({ steps }: { steps: readonly TourStep[] }) {
  const count = steps.length;
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
  useEffect(() => {
    here.current = location.pathname + location.search;
    go.current = navigate;
  });
  const [target, setTarget] = useState<Element | null>(null);

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
    const cancel = waitForTarget(own, {
      onFound: (el) => {
        if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", behavior: "instant" });
        setTarget(el);
        dispatch({ type: "found" });
      },
      onTimeout: () => {
        setTarget(null);
        dispatch({ type: "timeout" });
      },
    });
    return () => {
      opening?.();
      cancel();
    };
  }, [step]);

  const onLost = useCallback(() => {
    setTarget(null);
    dispatch({ type: "lost" });
  }, []);
  const targetBox = useTargetBox(target, onLost);
  const viewport = useViewport();
  const wide = useWide();
  const [pad] = useState(() => tokenPx("--spacing-tour-pad", 8));
  const [radius] = useState(() => tokenPx("--radius-card", 10));
  const hole = state.phase === "fallback" || targetBox === null ? null : padBox(targetBox, pad);

  const exit = useCallback(() => {
    const to = stopTour() ?? document.querySelector<HTMLElement>(targetSelector(BANNER_TOUR_TARGET));
    to?.focus();
  }, []);
  // Finish is the last step's Next: it ends the tour as Skip does, and writes nothing more (the start marked it seen).
  const onNext = useCallback(() => {
    if (isLastStep(state, count) && state.shown === state.index) exit();
    else dispatch({ type: "next" });
  }, [state, count, exit]);
  const onBack = useCallback(() => dispatch({ type: "back" }), []);

  const shown = state.shown === null ? null : steps[state.shown];
  const panel =
    shown === null || state.shown === null
      ? null
      : { step: shown, number: state.shown + 1, count, onBack, onNext, onExit: exit, target: hole, viewport };

  return (
    <div data-tour-root="" data-tour-phase={state.phase} className="pointer-events-none fixed inset-0 z-(--z-tour)">
      <Spotlight viewport={viewport} hole={hole} radius={radius}>
        {wide && panel !== null && <AttachedPopover {...panel} />}
      </Spotlight>
      {!wide && panel !== null && <SheetPopover {...panel} />}
      <p role="status" className="sr-only">
        {shown === null || state.phase === "waiting" ? "" : `Step ${(state.shown ?? 0) + 1} of ${count}`}
      </p>
    </div>
  );
}
