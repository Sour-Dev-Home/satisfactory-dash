import type { ReactNode } from "react";

/**
 * The Overview's cards (the owner's cards brief): one column on a phone, two from md up
 * (Health, then Players beside it).
 */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>;
}
