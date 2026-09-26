import type { ReactNode } from "react";

/**
 * The Overview's cards (the owner's cards brief): one column on a phone; from md up a narrow
 * column for the small, square Health card and the rest for Players.
 */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">{children}</div>;
}
