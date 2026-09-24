import { cn } from "../../lib/cn";
import type { Health } from "../health";

/** A health level, or still loading. */
export type Shown = Health | "pending";

const BANNER: Record<Shown, string> = {
  ok: "bg-ok-solid text-white",
  paused: "bg-info-solid text-white",
  degraded: "bg-warn-solid text-white",
  unavailable: "bg-idle-solid text-white",
  outage: "bg-bad-solid text-white",
  pending: "bg-surface-2 text-fg-strong",
};

/**
 * The Health card: the overall answer to "is everything OK?" (health.ts), one slim line whose
 * colour carries the level (the owner's call). Only shows what health.ts derived.
 */
export function HealthCard({
  overall,
  onDismiss,
}: {
  overall: { health: Shown; headline: string };
  /** Shows the ×: "hide until something changes" (a warning only; see canDismiss). */
  onDismiss?: () => void;
}) {
  const allClear = overall.health === "ok";
  return (
    // Spans the card grid's row: it's the headline for the cards under it.
    <div className={cn("flex items-center gap-3 rounded-card py-1 pr-1 pl-4 font-semibold md:col-span-2", BANNER[overall.health])}>
      <span aria-hidden="true" className="grid size-5 flex-none place-items-center rounded-full bg-white/20 text-xs">
        {allClear ? "✓" : overall.health === "pending" ? "…" : "!"}
      </span>
      <p role="status" className="min-h-[44px] flex-1 content-center">
        {overall.headline}
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide this warning until something changes"
          title="Hide until something changes"
          // 44 x 44 hit area (min-w-[44px] plus the base button min-height). The faint chip
          // makes it read as a control on the coloured bar, not an icon.
          className="grid min-w-[44px] flex-none place-items-center rounded-md border-0 bg-white/10 px-0 text-lg text-inherit hover:bg-white/20"
        >
          ×
        </button>
      )}
    </div>
  );
}
