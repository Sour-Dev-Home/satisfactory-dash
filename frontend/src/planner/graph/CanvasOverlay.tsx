import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { OverlayPlace } from "./overlayPlacement";

/**
 * The canvas's floating card (the group panel, a line's "+k" list), non-modal, over the canvas. The CSP forbids inline
 * styles, so it is placed by SVG attributes: an overlay `<svg>` the canvas's size (1 unit = 1 CSS px, like the stage), and
 * a `<foreignObject>` at `place`'s x, y, width and height holding the HTML. The overlay lets the pointer through to the
 * canvas; only the card takes it.
 *
 * The content fills the frame as a column: a header that stays put (`data-overlay-header`, with Close) and one scrolling
 * body (`data-overlay-body`, whose one child is the content). Its natural height (the frame with the body unscrolled) is
 * measured and reported, so the card is as tall as its content up to `place.maxHeight`, then the body scrolls. Once
 * scrolled the frame says `data-scrolled` (the header draws its bottom rule); while more is below, a fade marks the edge.
 */
export function CanvasOverlay({ place, onHeight, children }: { place: OverlayPlace; onHeight: (height: number) => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ scrolled: false, more: false });
  const read = useCallback(() => {
    const body = box.current?.querySelector("[data-overlay-body]");
    if (body == null) return;
    const next = { scrolled: body.scrollTop > 0, more: body.scrollHeight - body.scrollTop - body.clientHeight > 1 };
    setScroll((s) => (s.scrolled === next.scrolled && s.more === next.more ? s : next));
  }, []);
  useLayoutEffect(() => {
    const frame = box.current;
    const body = frame?.querySelector("[data-overlay-body]");
    const content = body?.firstElementChild;
    if (frame == null || body == null || content == null) return;
    // The frame's height less what the body shows, plus all the body holds: the height with nothing scrolled away.
    const measure = () => {
      onHeight(frame.offsetHeight - body.clientHeight + (content as HTMLElement).offsetHeight);
      read();
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(content);
    return () => observer.disconnect();
  }, [onHeight, read]);
  return (
    <svg data-overlay="" className="pointer-events-none absolute inset-0 size-full overflow-visible">
      {/* overflow-visible: a foreignObject clips to its box, which would cut the card's shadow. */}
      <foreignObject x={place.x} y={place.y} width={place.width} height={place.height} data-side={place.side} className="overflow-visible">
        <div
          ref={box}
          data-scrolled={scroll.scrolled || undefined}
          onScrollCapture={read}
          className="group pointer-events-auto relative h-full max-w-graph-panel overflow-hidden rounded-card border border-info-edge bg-surface shadow-lg"
        >
          {children}
          <div
            aria-hidden="true"
            data-overlay-more={scroll.more || undefined}
            className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-scroll-fade bg-linear-to-t from-surface to-transparent transition-opacity", scroll.more ? "opacity-100" : "opacity-0")}
          />
        </div>
      </foreignObject>
    </svg>
  );
}
