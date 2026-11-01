import { useCallback, useEffect, useRef } from "react";

/**
 * One tween for the planner's make-room glide and cross-fade (ADR-0060 Decision 4): a single requestAnimationFrame loop
 * that hands `t` (0 to 1, eased) to a callback, which writes attributes through refs, not React state, so a frame costs no
 * render. The duration is a motion token read from CSS, which reduced motion sets to 0s in one place; at 0 the callback
 * gets `t = 1` at once and only the state changes.
 */

/** `--ease-standard` (index.css), mirrored here as its cubic-bezier points; a test keeps the two equal. */
export const EASE_STANDARD = [0.2, 0, 0, 1] as const;
/** The token the glide lasts. */
export const TWEEN_TOKEN = "--duration-slow";

/** A cubic-bezier easing as a function of progress: solves x(s) = t by bisection, returns y(s). */
export function cubicBezier([x1, y1, x2, y2]: readonly [number, number, number, number]): (t: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

export const easeStandard = cubicBezier(EASE_STANDARD);

/** A token's duration ("240ms", "0.3s") in milliseconds; 0 when it is missing or odd, so nothing animates. */
export function durationOf(value: string): number {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
  if (!match) return 0;
  return Number(match[1]) * (match[2] === "s" ? 1000 : 1);
}

/** The glide's duration now, from the root's computed style (0 without a document). */
export function tweenMs(): number {
  if (typeof document === "undefined") return 0;
  return durationOf(getComputedStyle(document.documentElement).getPropertyValue(TWEEN_TOKEN));
}

/** Run one tween at a time: `run(ms, frame)` cancels any running one, calls `frame(0)` now and then each frame to 1. */
export function useTween(): { run: (ms: number, frame: (t: number) => void, done?: () => void) => void; cancel: () => void } {
  const id = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (id.current !== null) cancelAnimationFrame(id.current);
    id.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const run = useCallback(
    (ms: number, frame: (t: number) => void, done?: () => void) => {
      cancel();
      if (!(ms > 0) || typeof requestAnimationFrame === "undefined") {
        frame(1);
        done?.();
        return;
      }
      const start = performance.now();
      frame(0);
      const step = (now: number) => {
        const p = Math.min(1, Math.max(0, (now - start) / ms));
        frame(easeStandard(p));
        if (p < 1) id.current = requestAnimationFrame(step);
        else {
          id.current = null;
          done?.();
        }
      };
      id.current = requestAnimationFrame(step);
    },
    [cancel],
  );
  return { run, cancel };
}
