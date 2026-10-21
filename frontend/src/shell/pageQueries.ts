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
    case "/app/map":
      return [queries.factory(serverId)].map(asPageQuery);
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
