import { cn } from "../../lib/cn";

/**
 * One player slot, drawn by us (the cards brief: no clipart, no icon font). Filled = a
 * connected player, outlined = a free slot. Colour comes from `currentColor`, so callers use
 * token classes; SVG presentation attributes only, never `style=` (the CSP).
 */
export function StickFigure({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 36"
      aria-hidden="true"
      focusable="false"
      data-slot={filled ? "connected" : "free"}
      className={cn("h-9 w-6", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="6.5" r="4.5" fill={filled ? "currentColor" : "none"} />
      {/* Body, arms, legs: one path, so a filled figure is a solid silhouette. */}
      <path
        d="M12 12v11M5 16.5l7-2.5 7 2.5M12 23l-5 10M12 23l5 10"
        strokeWidth={filled ? 3 : 2}
      />
    </svg>
  );
}
