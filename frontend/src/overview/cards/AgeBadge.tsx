import { formatTime } from "../../format";
import { cn } from "../../lib/cn";
import { useNow } from "../../lib/useNow";
import { dataAgeText } from "../../components/dataAgeText";

/** Under this many seconds the status reads "live"; the backend polls well inside it. */
const LIVE_UNDER_S = 15;

/** The badge's coarse label: `live`, `< 1 min`, then whole minutes, so it changes rarely. */
function coarseAge(observedAt: string, now: number): "live" | "< 1 min" | `${number} min` | "unknown" {
  const observed = Date.parse(observedAt);
  if (Number.isNaN(observed)) return "unknown";
  const seconds = Math.floor(Math.max(0, now - observed) / 1000);
  if (seconds < LIVE_UNDER_S) return "live";
  if (seconds < 60) return "< 1 min";
  return `${Math.floor(seconds / 60)} min`;
}

/**
 * How fresh the status is, in the card header (#616): a dot and a coarse label in a fixed-width slot,
 * so a label change never moves the Hide button. The exact age ("Updated 8 s ago") is the tooltip and
 * visually hidden text; `late` (the backend's call, never this clock) turns it amber. Not a live
 * region: it counts up every second.
 */
export function AgeBadge({ observedAt, late }: { observedAt: string; late: boolean }) {
  const now = useNow();
  const label = late ? "late" : coarseAge(observedAt, now);
  const exact = dataAgeText(observedAt, now);
  return (
    <span
      data-age=""
      title={`${exact} (${formatTime(observedAt)})`}
      className={cn(
        "inline-flex min-w-20 items-center gap-1.5 text-sm tabular-nums transition-colors ease-in-out",
        late ? "text-warn" : "text-muted",
      )}
    >
      <span
        aria-hidden="true"
        data-dot=""
        className={cn(
          "size-2 flex-none rounded-full transition-colors ease-in-out",
          late ? "bg-warn" : label === "live" ? "bg-ok" : "bg-muted",
        )}
      />
      <span aria-hidden="true" data-age-label="">
        {label}
      </span>
      <time dateTime={observedAt} className="sr-only">
        {exact}
        {late ? ": newer data is overdue" : ""}
      </time>
    </span>
  );
}
