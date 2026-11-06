import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { placePopover, sheetAtTop, type Box, type Size } from "./placePopover";
import type { TourStep } from "./steps";

export interface TourPanelProps {
  step: TourStep;
  /** 1-based. */
  number: number;
  count: number;
  onBack: () => void;
  onNext: () => void;
  onExit: () => void;
}

/**
 * The tour's words and buttons (ADR-0065 Decision 9): a non-modal dialog (the page must stay usable for try-it steps),
 * named by its heading and described by its words. Focus moves to the heading on each step; Tab and Shift+Tab wrap
 * through its buttons; Escape leaves the tour while focus is inside.
 */
function TourPanel({ step, number, count, onBack, onNext, onExit, className }: TourPanelProps & { className?: string }) {
  const titleId = useId();
  const bodyId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const last = number === count;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [step.id]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onExit();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    if (items.length === 0) return;
    const first = items[0];
    const end = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === heading.current)) {
      e.preventDefault();
      end.focus();
    } else if (!e.shiftKey && at === end) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-tour-popover=""
      onKeyDown={onKeyDown}
      className={cn("pointer-events-auto grid gap-2 bg-surface text-fg", className)}
    >
      <p className="mb-0 text-xs font-semibold tracking-wide text-muted uppercase">
        Step {number} of {count}
      </p>
      <h2 id={titleId} ref={heading} tabIndex={-1} className="mb-0 text-lg">
        {step.title}
      </h2>
      <p id={bodyId} className="mb-0 text-sm">
        {step.body}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onExit} className="mr-auto">
          Skip tour
        </button>
        <button type="button" onClick={onBack} disabled={number === 1}>
          Back
        </button>
        <button type="button" onClick={onNext} className="border-accent bg-accent text-on-accent hover:not-disabled:border-accent">
          {last ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}

/** A first guess at the panel's size, used for the one layout pass before it is measured. */
const SIZE_GUESS: Size = { width: 352, height: 200 };

/**
 * From `sm` up: the panel beside the target, in an SVG `<foreignObject>` placed by its attributes (as the planner's
 * CanvasOverlay places its card), with an accent arrow pointing at the target. The panel's width is a token
 * (`w-tour-popover`); its size is measured (a ResizeObserver) and written back to the attributes. Must be drawn inside
 * the Spotlight's SVG.
 */
export function AttachedPopover({ target, viewport, ...panel }: TourPanelProps & { target: Box | null; viewport: Size }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(SIZE_GUESS);
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const measure = () =>
      setSize((s) => (s.width === el.offsetWidth && s.height === el.offsetHeight ? s : { width: el.offsetWidth, height: el.offsetHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const place = placePopover(target, size, viewport);
  return (
    <>
      {place.arrow !== null && <path aria-hidden="true" data-tour-arrow={place.side} d={place.arrow} className="fill-accent" />}
      <foreignObject x={place.x} y={place.y} width={size.width} height={size.height} data-side={place.side} className="overflow-visible">
        <div ref={box} className="w-tour-popover">
          <TourPanel key={panel.step.id} {...panel} className="animate-reveal rounded-card border border-accent p-4 shadow-lg" />
        </div>
      </foreignObject>
    </>
  );
}

/** Below `sm`: a sheet across the bottom (or the top, when the target is low on the screen), no arrow (Decision 2). */
export function SheetPopover({ target, viewport, ...panel }: TourPanelProps & { target: Box | null; viewport: Size }) {
  const top = sheetAtTop(target, viewport);
  return (
    <SheetFrame top={top}>
      <TourPanel key={panel.step.id} {...panel} className="animate-reveal p-4" />
    </SheetFrame>
  );
}

function SheetFrame({ top, children }: { top: boolean; children: ReactNode }) {
  return (
    <div
      data-tour-sheet={top ? "top" : "bottom"}
      className={cn(
        "pointer-events-auto fixed inset-x-0 max-h-tour-sheet overflow-y-auto border-accent bg-surface shadow-lg",
        top ? "top-0 border-b" : "bottom-0 border-t",
      )}
    >
      {children}
    </div>
  );
}
