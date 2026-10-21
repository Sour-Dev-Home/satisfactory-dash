import { useEffect, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { PageRevealContext } from "./skeletonClock";
import { usePageReveal, type PageQuery } from "./usePageReveal";

/**
 * The body of a page: its panels are mounted at once (so every query starts and every panel lays
 * itself out, skeletons at their final size) but kept `invisible` until `usePageReveal` says go;
 * then all of it fades in together with `animate-reveal`, no stagger. `invisible` rather than
 * transparent: nothing is painted, so no layout shift is reported for what the user can't see.
 * Panels' skeleton clocks start at the reveal (PageRevealContext). `onRevealed` runs once then,
 * for the shell to move focus to the page's heading.
 */
export function PageReveal({
  queries,
  scope,
  onRevealed,
  className,
  children,
}: {
  queries: PageQuery[];
  scope: string;
  onRevealed?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const revealed = usePageReveal(queries, scope);
  useEffect(() => {
    if (revealed) onRevealed?.();
  }, [revealed, onRevealed]);
  return (
    <PageRevealContext.Provider value={revealed}>
      <div
        data-page-reveal={revealed ? "revealed" : "waiting"}
        aria-busy={revealed ? undefined : true}
        className={cn(className, revealed ? "animate-reveal" : "invisible")}
      >
        {children}
      </div>
    </PageRevealContext.Provider>
  );
}
