import type { QueryClient } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { sinceYesterdayQueries } from "../factory/FactoryHistory";
import { asPageQuery, type PageQuery } from "../ui/usePageReveal";

/**
 * A page's primary queries (#494): the ones its first reveal waits for (up to the budget), and the
 * ones its nav link prefetches on hover or focus. They are the same options the panels run, so the
 * keys are the cache's own. A panel's other reads (names, the live power chart) are left out: they
 * show their skeleton or their gap rather than hold the page.
 */
export function pageQueries(path: string, serverId: string): PageQuery[] {
  switch (path) {
    case "/app":
      return [queries.status(serverId), queries.power(serverId), queries.factory(serverId)].map(asPageQuery);
    case "/app/power":
      return [queries.power(serverId)].map(asPageQuery);
    case "/app/factory": {
      const since = sinceYesterdayQueries(serverId);
      return [queries.factory(serverId), since.history, since.transitions].map(asPageQuery);
    }
    case "/app/planner":
      return [queries.productionGraph(serverId)].map(asPageQuery);
    case "/app/map":
      // The world layers are on by default (the data-derived base map), so the reveal waits for them too.
      return [queries.factory(serverId), queries.mapRails(serverId), queries.mapResourceNodes(serverId), queries.mapLive(serverId)].map(asPageQuery);
    case "/app/settings":
      return [
        queries.settings(serverId),
        queries.agentStatus(serverId),
        queries.alertStatus(serverId),
        queries.alertRules(serverId),
        queries.alertDestinations(serverId),
      ].map(asPageQuery);
    case "/app/servers":
      return [queries.managedServers()].map(asPageQuery);
    default:
      return [];
  }
}

/** A prefetch skips a read newer than this, so hovering back and forth doesn't refetch every time. */
export const PREFETCH_FRESH_MS = 10_000;

/**
 * The command bar's reads (`palette/CommandBar.tsx`): the server list (Change server), power (the circuits) and the
 * factory (machines and items). Its Search button prefetches them on hover or focus, so the first search has them.
 */
export function paletteQueries(serverId: string): PageQuery[] {
  return [queries.servers(), queries.power(serverId), queries.factory(serverId)].map(asPageQuery);
}

/** Starts each query, unless the cache has a read newer than its own staleTime or PREFETCH_FRESH_MS. */
export function prefetchFresh(client: QueryClient, list: PageQuery[]): void {
  for (const query of list) {
    const own = typeof query.staleTime === "number" ? query.staleTime : 0;
    void client.prefetchQuery({ queryKey: query.queryKey, queryFn: query.queryFn, staleTime: Math.max(own, PREFETCH_FRESH_MS) });
  }
}
