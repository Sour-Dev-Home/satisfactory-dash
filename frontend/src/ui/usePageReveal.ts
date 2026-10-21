import { useEffect, useState } from "react";
import { useQueries, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { loadMs, LOAD_TOKENS } from "./loadTiming";

/** What a page needs to watch or prefetch a query: its key and function (what `queryOptions` returns). */
export type PageQuery = UseQueryOptions<unknown, Error, unknown, QueryKey>;

/** `queryOptions(...)` results of any data type, as the one shape a page lists (the cast is the only place the types are erased). */
export const asPageQuery = (options: unknown): PageQuery => options as PageQuery;

/**
 * One reveal per page (#494). True once every one of the page's primary queries has an answer (data
 * or a final error), or the reveal budget (`--duration-reveal-budget`) has passed since the page
 * opened, whichever is first. A page whose data is all cached is revealed on its first render. Once
 * revealed it stays revealed for `scope` (the selected server): a later refetch or a query going
 * back to pending never hides the page again. `queries` are the same options the panels run, so
 * this adds no request; it only watches them.
 */
export function usePageReveal(queries: PageQuery[], scope: string): boolean {
  const settled = useQueries({
    queries,
    combine: (results) => results.every((r) => !r.isPending),
  });
  const [revealedFor, setRevealedFor] = useState<string>();
  const [budgetOverFor, setBudgetOverFor] = useState<string>();
  useEffect(() => {
    const timer = setTimeout(() => setBudgetOverFor(scope), loadMs(LOAD_TOKENS.revealBudget));
    return () => clearTimeout(timer);
  }, [scope]);
  const ready = settled || budgetOverFor === scope;
  // Latched during render (React's pattern for state derived from a changing value): the page
  // that is ready now must not flicker back to hidden on the next render.
  if (ready && revealedFor !== scope) setRevealedFor(scope);
  return ready || revealedFor === scope;
}
