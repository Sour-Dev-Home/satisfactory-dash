import { Skeleton, SkeletonStatus } from "../ui/Skeleton";

/**
 * The Overview's cards while their reads load (#494): the Health and Players row, then the Power
 * card, each about the size of the loaded card (a phone stacks them taller than a wide screen's
 * side-by-side row). The status panel under them has its own, in StatusView.
 */
export function OverviewSkeleton() {
  return (
    <section aria-busy="true" className="grid gap-4">
      <SkeletonStatus>Loading the overview…</SkeletonStatus>
      <div className="grid gap-4 md:grid-cols-[minmax(0,var(--spacing-overview-rail))_minmax(0,1fr)] lg:grid-cols-2">
        <Skeleton className="h-120 rounded-card md:h-80 lg:h-78" />
        <Skeleton className="h-41 rounded-card md:h-auto" />
      </div>
      <Skeleton className="h-34 rounded-card" />
    </section>
  );
}
