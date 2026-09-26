import { formatTime } from "../format";
import { cn } from "../lib/cn";
import { useNow } from "../lib/useNow";
import { dataAgeText } from "./dataAgeText";

/**
 * "Updated 8 s ago" for a view's data (ADR-0032 step 3), counting up each second; the exact time is
 * on the <time> element. `late` turns it into a warning. The caller decides it from the backend's
 * `stale` flag and a failed refresh, never from this clock, so a skewed PC clock can't make fresh
 * data look late. Not a live region: it changes every second, and the stale banner already
 * announces a lost connection.
 */
export function DataAge({ observedAt, late }: { observedAt: string; late: boolean }) {
  const now = useNow();
  return (
    <span data-age="" className={cn(late && "text-warn")}>
      <time dateTime={observedAt} title={formatTime(observedAt)}>
        {dataAgeText(observedAt, now)}
      </time>
      {late && <span>: newer data is overdue</span>}
    </span>
  );
}
