import type { ReactNode } from "react";

/**
 * The Overview's cards (the owner's cards brief): one column on a phone, two from md up. A
 * card that spans the row (Health) says so itself (`md:col-span-2`).
 */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>;
}
