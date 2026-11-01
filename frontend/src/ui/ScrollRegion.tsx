import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useScrollCue } from "../lib/useScrollCue";

export const SCROLL_MORE = "Scroll for more";

/**
 * A capped-height scroll region for a long table (the map's "in view" lists). Focusable and labelled by its
 * heading, so keyboard users can scroll it (axe scrollable-region-focusable). While rows are cut below, its bottom
 * edge fades into the panel's surface and a muted "Scroll for more" line says so in words (not by the fade alone); at the end both go, the
 * line kept as an invisible placeholder so nothing jumps. Nothing shows when the rows fit. No motion.
 */
export function ScrollRegion({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  const { attach, onScroll, overflows, more } = useScrollCue<HTMLDivElement>();
  return (
    <div className="grid gap-1">
      <div className="relative">
        <div ref={attach} onScroll={onScroll} tabIndex={0} role="region" aria-labelledby={labelledBy} className="max-h-80 overflow-auto">
          {children}
        </div>
        {/* An overlay, not a mask on the region: a mask would clip the region's focus ring (drawn outside its box). */}
        {more && (
          <div
            aria-hidden="true"
            data-scroll-fade=""
            className="pointer-events-none absolute inset-x-0 bottom-0 h-scroll-fade bg-linear-to-t from-surface to-transparent"
          />
        )}
      </div>
      {overflows && (
        // The table itself is what a screen reader reads; the line is a visual cue for cut-off rows.
        <p aria-hidden="true" className={cn("text-xs text-muted", !more && "invisible")}>
          {SCROLL_MORE}
        </p>
      )}
    </div>
  );
}
