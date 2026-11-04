import { PanelSkeleton, Skeleton } from "../ui/Skeleton";
import { BottleneckSummarySkeleton } from "./BottleneckSummary";

/**
 * The Factory page while the factory loads (#494): the bottleneck card in its reserved box, the table's panel (filters
 * and search, a few rows) and the production history's panel (range row, item picker, figures, chart). Each is about the
 * size of the loaded one, so the reveal moves little below it. No "Since yesterday": it is drawn only when it has news
 * (ADR-0064), which is not known yet.
 */
export function FactorySkeleton() {
  return (
    <>
      <BottleneckSummarySkeleton />
      <PanelSkeleton label="Loading factory…" rows={0}>
        {/* The filter bar (FactoryPanel's FilterBar, ADR-0064): filters and search on one row from sm, two on a phone,
            with its padding and rule. */}
        <div className="grid gap-2 sm:border-b sm:border-line sm:py-2">
          <Skeleton className="h-touch w-full max-w-96" />
          <Skeleton className="h-touch w-full max-w-64 sm:hidden" />
        </div>
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
    </>
  );
}
