import { useQueries } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { AgeBadge } from "../components/AgeBadge";
import { useSelectedServer } from "../servers/ServerContext";
import { pageQueries } from "./pageQueries";

/** A response that says when its game data was read: every game read's envelope (`observedAt`, `stale`). */
function observed(data: unknown): { observedAt: string; stale: boolean } | null {
  if (typeof data !== "object" || data === null) return null;
  const { observedAt, stale } = data as { observedAt?: unknown; stale?: unknown };
  return typeof observedAt === "string" ? { observedAt, stale: stale === true } : null;
}

/**
 * ADR-0064 Decision 6: the page's one "how fresh" signal, beside the server picker, instead of an "Updated N s ago" line
 * in every panel (a panel now says its own age only when its data is late). It is the age of the page's first primary
 * read that carries one (`shell/pageQueries.ts`: status on the Overview, power, the factory, the graph...), read from
 * the cache only (`enabled: false`: this never fetches or polls; the page's panels do). `late` is the backend's `stale`
 * or a failed refresh, never this clock. Before the read lands, or on a page without one, it keeps the badge's width
 * empty, so the header never moves.
 */
export function PageAge() {
  const { pathname } = useLocation();
  const server = useSelectedServer();
  const results = useQueries({ queries: pageQueries(pathname, server.id).map((q) => ({ ...q, enabled: false })) });
  for (const result of results) {
    const age = observed(result.data);
    if (age !== null) {
      return (
        <span data-page-age="">
          <AgeBadge observedAt={age.observedAt} late={age.stale || result.isRefetchError} />
        </span>
      );
    }
  }
  return <span data-page-age="" aria-hidden="true" className="inline-flex min-w-20" />;
}
