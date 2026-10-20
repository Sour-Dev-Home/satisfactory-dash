import { cn } from "../lib/cn";

/** One stripe per page (the header's), so a fixed id is unique. */
const PATTERN_ID = "hazard-stripe-pattern";

/**
 * The hazard stripe under the header (ADR-0041 item 4): amber on the canvas at reduced opacity.
 * Decorative only, never meaning, so it's hidden from assistive tech. An SVG pattern rather than a
 * CSS gradient, so the colour is the accent token's own class.
 */
export function HazardStripe({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" data-hazard-stripe="" className={cn("block h-1.5 w-full opacity-40", className)}>
      <defs>
        <pattern id={PATTERN_ID} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="12" className="fill-accent" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${PATTERN_ID})`} />
    </svg>
  );
}
