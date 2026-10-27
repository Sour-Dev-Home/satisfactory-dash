import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { OverlayPlace } from "./overlayPlacement";

/**
 * The canvas's floating card (the group panel, a line's "+k" list), non-modal, over the canvas. The CSP forbids inline
 * styles, so it is placed by SVG attributes: an overlay `<svg>` the canvas's size (1 unit = 1 CSS px, like the stage), and
 * a `<foreignObject>` at `place`'s x, y, width and height holding the HTML. The overlay lets the pointer through to the
 * canvas; only the card takes it. The content's height is measured and reported, so the card is as tall as it is (up to
 * `place.maxHeight`, then it scrolls inside).
 */
export function CanvasOverlay({ place, onHeight, children }: { place: OverlayPlace; onHeight: (height: number) => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = content.current;
    const frame = box.current;
    if (el === null || frame === null) return;
    // The content's height plus the frame's own border, so content that fits never scrolls by a pixel.
    const measure = () => onHeight(el.offsetHeight + frame.offsetHeight - frame.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeight]);
  return (
    <svg data-overlay="" className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <foreignObject x={place.x} y={place.y} width={place.width} height={place.height} data-side={place.side}>
        <div ref={box} className={cn("pointer-events-auto h-full overflow-y-auto overscroll-contain rounded-card border border-line bg-surface shadow-lg", place.side !== "bottom" && "max-w-graph-panel")}>
          <div ref={content}>{children}</div>
        </div>
      </foreignObject>
    </svg>
  );
}
