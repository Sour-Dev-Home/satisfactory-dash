import { BOTTLENECKS_DEFAULT_LIMIT } from "@satisfactory-dash/shared";
import { queries } from "../api/queries";
import { useSettledQuery } from "../api/settled";
import { useSelectedServer } from "../servers/ServerContext";

/** The Factory page's one bottlenecks read: the full list and the summary above the table share it (one cache entry). */
export function useBottlenecks() {
  const server = useSelectedServer();
  return useSettledQuery(queries.bottlenecks(server.id, BOTTLENECKS_DEFAULT_LIMIT));
}

/**
 * The full list's fragment (/app/factory#bottlenecks): the summary at the top of the page links here. The Planner's links
 * name the heading (`#bottlenecks-heading`); both jump to the section.
 */
export const BOTTLENECKS_ANCHOR = "bottlenecks";
export const isBottlenecksAnchor = (id: string) => id === BOTTLENECKS_ANCHOR || id === "bottlenecks-heading";

/** How many causes the summary names; the full list below has the rest (ADR-0062 F.1). */
export const BOTTLENECK_SUMMARY_CAP = 3;
