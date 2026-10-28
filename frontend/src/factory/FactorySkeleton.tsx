import { PanelSkeleton, Skeleton } from "../ui/Skeleton";
import { BottleneckSummarySkeleton } from "./BottleneckSummary";
import { BottlenecksSkeleton } from "./BottlenecksPanel";
import { SinceYesterdaySkeleton } from "./FactoryHistory";

/**
 * The Factory page while the factory loads (#494): the bottleneck summary and "Since yesterday" in their reserved boxes, the table's
 * panel (summary, filters, search, a few rows) and the production history's panel (range row, item
 * picker, figures, chart). Each is about the size of the loaded one, so the reveal moves little below it.
 */
export function FactorySkeleton() {
  return (
    <>
      <BottleneckSummarySkeleton />
      <SinceYesterdaySkeleton />
      <PanelSkeleton label="Loading factory…" rows={0}>
        <Skeleton className="h-5 w-full max-w-64" />
        {/* The filter bar: nav and search on one row from sm, two on a phone (ADR-0062 F.4), then the filters. */}
        <Skeleton className="h-touch w-full max-w-64 sm:hidden" />
        <Skeleton className="h-touch w-full max-w-96" />
        <Skeleton className="h-touch w-full max-w-64" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-11" />
        ))}
        <Skeleton className="h-5 w-32" />
      </PanelSkeleton>
      <PanelSkeleton label="Loading production history…" rows={0}>
        <Skeleton className="h-touch w-full max-w-96" />
        <Skeleton className="h-touch w-full max-w-48" />
        <Skeleton className="h-lh" />
        <Skeleton className="h-chart-slot-phone sm:h-chart-slot" />
        <Skeleton className="h-5 w-32" />
      </PanelSkeleton>
      <BottlenecksSkeleton />
    </>
  );
}
