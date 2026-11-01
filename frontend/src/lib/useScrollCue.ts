import { useCallback, useEffect, useState } from "react";

/** Rounding slack: a sub-pixel difference between the content and the box is not overflow. */
const SLACK_PX = 1;

export interface ScrollCue {
  /** The content is taller than the box, so some of it is cut off. */
  overflows: boolean;
  /** There is still content below what is shown (not scrolled to the end yet). */
  more: boolean;
}

const NONE: ScrollCue = { overflows: false, more: false };

/** Whether a vertical scroller cuts its content, and whether any is still below, from its measurements. */
export function scrollCue(scrollTop: number, clientHeight: number, scrollHeight: number): ScrollCue {
  const hidden = scrollHeight - clientHeight;
  if (hidden <= SLACK_PX) return NONE;
  return { overflows: true, more: hidden - scrollTop > SLACK_PX };
}

/**
 * Tracks a vertical scroll region's cue: measured when it mounts and whenever the region or its content resizes (a
 * ResizeObserver on both, where the browser has one), and on scroll (pass `onScroll`). `attach` is a callback ref, so
 * a region that mounts later (a table that was empty) is picked up.
 */
export function useScrollCue<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [cue, setCue] = useState<ScrollCue>(NONE);
  const measure = useCallback(() => {
    if (!el) return;
    const next = scrollCue(el.scrollTop, el.clientHeight, el.scrollHeight);
    setCue((prev) => (prev.overflows === next.overflows && prev.more === next.more ? prev : next));
  }, [el]);
  useEffect(() => {
    // A ResizeObserver reports each target once when it starts observing, which is the first measurement.
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [el, measure]);
  return { attach: setEl, onScroll: measure, ...cue };
}
