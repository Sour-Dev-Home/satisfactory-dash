import type { ReactNode } from "react";
import { holePath, overlaps, type Box, type Size } from "./placePopover";

/** The clipPath's id; `.tour-scrim` in index.css refers to it. */
export const TOUR_HOLE_ID = "tour-hole";

/**
 * The tour's scrim, hole and ring (ADR-0065 Decision 2). The scrim covers the viewport, dimmed and blurred by
 * `.tour-scrim` (index.css), and is clipped by `#tour-hole`: the viewport less a rounded box at the target (evenodd).
 * The clip cuts hit-testing too, so the target stays live and a click anywhere else lands on the scrim and does nothing.
 * Everything is placed by SVG attributes (the CSP forbids inline styles): only the path's `d` and the ring's box change.
 * `children` are drawn in the same full-viewport SVG (the attached popover and its arrow).
 *
 * `tab` is a second, quieter hole round the step's page in the top nav (ADR-0065 amendment, 2026-11-07), so the visitor
 * sees which tab holds what is highlighted: a thin muted ring, not the accent one, so the target stays the main focus. It
 * is dropped where it would overlap the target's hole (evenodd would dim the overlap again).
 */
export function Spotlight({
  viewport,
  hole,
  tab = null,
  radius,
  children,
}: {
  viewport: Size;
  hole: Box | null;
  tab?: Box | null;
  radius: number;
  children?: ReactNode;
}) {
  const tabHole = tab !== null && (hole === null || !overlaps(tab, hole)) ? tab : null;
  const holes = [hole, tabHole].filter((b): b is Box => b !== null);
  return (
    <>
      <div aria-hidden="true" data-tour-scrim="" className="tour-scrim pointer-events-auto fixed inset-0" />
      <svg data-tour-overlay="" width={viewport.width} height={viewport.height} className="pointer-events-none fixed inset-0 size-full overflow-visible">
        <defs>
          <clipPath id={TOUR_HOLE_ID} clipPathUnits="userSpaceOnUse">
            <path clipRule="evenodd" d={holePath(viewport, holes, radius)} />
          </clipPath>
        </defs>
        {tabHole !== null && (
          <rect
            aria-hidden="true"
            data-tour-tab-ring=""
            x={tabHole.x}
            y={tabHole.y}
            width={tabHole.width}
            height={tabHole.height}
            rx={radius}
            className="fill-none stroke-muted stroke-1"
          />
        )}
        {hole !== null && (
          <rect
            aria-hidden="true"
            data-tour-ring=""
            x={hole.x}
            y={hole.y}
            width={hole.width}
            height={hole.height}
            rx={radius}
            className="fill-none stroke-accent stroke-2"
          />
        )}
        {children}
      </svg>
    </>
  );
}
