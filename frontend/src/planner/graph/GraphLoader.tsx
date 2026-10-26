import { lazy, Suspense } from "react";
import { Skeleton, SkeletonStatus } from "../../ui/Skeleton";
import type { SiteGraphProps } from "./SiteGraph";

// dagre (about 17 kB gzip) and the canvas are only needed once a site's graph is shown: a separate chunk, as the Map's
// Leaflet is. React.lazy caches a failed import for good, so on failure swap in a fresh lazy component and the
// section's Try again imports again (the same pattern as MapPanel).
const loadGraph = () =>
  import("./SiteGraph").catch((error: unknown) => {
    SiteGraph = lazy(loadGraph);
    throw error;
  });
let SiteGraph = lazy(loadGraph);

/** Reserves the canvas's height while its chunk loads. */
function GraphSkeleton() {
  return (
    <>
      <SkeletonStatus>Loading the graph…</SkeletonStatus>
      <Skeleton className="h-map min-h-map-min rounded-card" />
    </>
  );
}

export function LazySiteGraph(props: SiteGraphProps) {
  return (
    <Suspense fallback={<GraphSkeleton />}>
      <SiteGraph {...props} />
    </Suspense>
  );
}
