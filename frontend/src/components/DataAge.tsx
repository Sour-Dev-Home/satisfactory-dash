import { formatTime } from "../format";
import { cn } from "../lib/cn";
import { useNow } from "../lib/useNow";
import { dataAge } from "./dataAgeText";

/**
 * "Updated 8 s ago" for a view's data (ADR-0032 step 3), counting up each second; the exact time is
 * on the <time> element. Past twice the view's poll interval it turns into a warning: a dashboard
 * that says honestly its numbers are old never feels weird. Not a live region: it changes every
 * second, and the stale banner already announces a lost connection.
 */
export function DataAge({ observedAt, pollMs }: { observedAt: string; pollMs: number }) {
  const now = useNow();
  const { text, late } = dataAge(observedAt, now, pollMs);
  return (
    <span data-age="" className={cn(late && "text-warn")}>
      <time dateTime={observedAt} title={formatTime(observedAt)}>
        {text}
      </time>
      {late && <span>: newer data is overdue</span>}
    </span>
  );
}
