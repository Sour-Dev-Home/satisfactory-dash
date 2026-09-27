import type { ReactNode } from "react";

/**
 * The Overview's cards (the owner's cards brief): one column on a phone; from md up a narrow
 * column for the small, square Health card and the rest for Players; from lg up two equal columns
 * (#329, the owner's pick A), so Players is sized to its content instead of a wide, half-empty card.
 */
export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,var(--spacing-overview-rail))_minmax(0,1fr)] lg:grid-cols-2">
      {children}
    </div>
  );
}
