import { PanelSkeleton, Skeleton } from "../ui/Skeleton";

/**
 * The power history while it loads (#494), about the loaded panel's size: its heading, one circuit's
 * heading and figures, the chart's slot and the readings line under it.
 */
export function PowerHistorySkeleton() {
  return (
    <PanelSkeleton label="Loading power history…" rows={0}>
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-16 sm:h-8" />
      <Skeleton className="h-chart-slot-phone sm:h-chart-slot" />
      <Skeleton className="h-5 w-32" />
    </PanelSkeleton>
  );
}
