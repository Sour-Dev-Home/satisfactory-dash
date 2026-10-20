import { cn } from "../../lib/cn";

/**
 * One player slot (#442): a square tile, amber-outlined when someone is connected (with their
 * initials when the server names them), plain when the slot is free. Drawn by us, colours from token
 * classes, SVG attributes only, never `style=` (the CSP). Hidden: the card's sentence is the content.
 */
export function PlayerTile({ connected, label = "" }: { connected: boolean; label?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      aria-hidden="true"
      focusable="false"
      data-slot={connected ? "connected" : "free"}
      className="size-9 flex-none"
    >
      <rect
        x="1"
        y="1"
        width="34"
        height="34"
        rx="3"
        strokeWidth={connected ? 2 : 1.5}
        className={cn(connected ? "fill-canvas stroke-accent" : "fill-surface-2 stroke-line")}
      />
      {connected && label && (
        <text x="18" y="18" textAnchor="middle" dominantBaseline="central" className="fill-fg-strong font-display text-sm font-bold">
          {label}
        </text>
      )}
    </svg>
  );
}
