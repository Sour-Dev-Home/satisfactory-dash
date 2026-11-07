import type { QueryClient } from "@tanstack/react-query";
import { pageQueries, prefetchFresh } from "../../shell/pageQueries";
import type { TourStep } from "./steps";

/**
 * The lazy chunks of the tour's pages (ADR-0065 amendment, 2026-11-07): the power chart (uPlot), the planner's graph
 * (dagre) and the map's canvas (Leaflet). The same modules the pages import lazily, so the bundler gives both the one
 * chunk, and a chunk loaded here is in the browser's module map by the time the page asks for it.
 */
export const TOUR_CHUNKS: ReadonlyMap<string, () => Promise<unknown>> = new Map<string, () => Promise<unknown>>([
  ["/app/power", () => import("../../power/PowerChart")],
  ["/app/planner", () => import("../../planner/graph/SiteGraph")],
  ["/app/map", () => import("../../map/MapCanvas")],
]);

export interface WarmContext {
  /** The app's query client and the selected server; either missing (a test with no providers), no queries start. */
  client: QueryClient | undefined;
  serverId: string | undefined;
  chunks?: ReadonlyMap<string, () => Promise<unknown>>;
}

/**
 * Warms everything the tour will visit, once, when it starts: for each distinct step page, its lazy chunk and its
 * primary queries, the ones the nav links prefetch on hover (`shell/pageQueries.ts`). So a step on a new page meets a
 * page that is already loaded rather than one popping in. A failed chunk says nothing here: the page loads it again and
 * shows its own error.
 */
export function warmTour(steps: readonly TourStep[], { client, serverId, chunks = TOUR_CHUNKS }: WarmContext): void {
  for (const path of new Set(steps.map((s) => s.path))) {
    void chunks.get(path)?.().catch(() => {});
    if (client !== undefined && serverId !== undefined) prefetchFresh(client, pageQueries(path, serverId));
  }
}
