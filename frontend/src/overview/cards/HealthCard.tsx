import type { Ref } from "react";
import { cn } from "../../lib/cn";
import { WORD, WORD_COLOR, type Shown } from "./words";

export type { Shown };

/** The badge behind the icon: the solid colours carry white marks at WCAG AA. */
const BADGE: Record<Shown, string> = {
  ok: "bg-ok-solid text-white",
  paused: "bg-info-solid text-white",
  degraded: "bg-warn-solid text-white",
  unavailable: "bg-idle-solid text-white",
  outage: "bg-bad-solid text-white",
  pending: "bg-surface-2 text-fg-strong",
};

/** Our own marks (the cards brief): a tick when all clear, dots while loading, else "!". */
function HealthIcon({ health }: { health: Shown }) {
  const kind = health === "ok" ? "ok" : health === "pending" ? "pending" : "alert";
  return (
    <svg
      viewBox="0 0 12 12"
      data-icon={kind}
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "ok" && <path d="M2.5 6.5l2.2 2.2 4.8-5" />}
      {kind === "alert" && (
        <>
          <path d="M6 2.5v4.5" />
          <circle cx="6" cy="9.5" r="0.4" fill="currentColor" />
        </>
      )}
      {kind === "pending" && (
        <g fill="currentColor" stroke="none">
          <circle cx="2.5" cy="6" r="1" />
          <circle cx="6" cy="6" r="1" />
          <circle cx="9.5" cy="6" r="1" />
        </g>
      )}
    </svg>
  );
}

/**
 * The Health card: the overall answer to "is everything OK?" (health.ts), a card of its own
 * beside Players (the owner's call, replacing the full-width bar). Only shows what health.ts
 * derived. A dismissed warning stays in the card, quietly, until something changes.
 */
export function HealthCard({
  overall,
  hidden = false,
  onDismiss,
  headingRef,
}: {
  overall: { health: Shown; headline: string };
  /** The operator hid this warning (see canDismiss): shown neutral, without the headline. */
  hidden?: boolean;
  /** Shows the Hide button: "hide until something changes" (a warning only; see canDismiss). */
  onDismiss?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <section
      aria-labelledby="health-heading"
      className="grid content-start gap-3 rounded-card border border-line bg-surface p-5"
    >
      {/* 44 px whether or not Hide shows, like Players' header: the two cards' bodies line up. */}
      <div className="flex min-h-[44px] items-center gap-3">
        {/* tabIndex -1: focus lands here after the warning is hidden (OverviewPanel). */}
        <h3 id="health-heading" ref={headingRef} tabIndex={-1} className="mb-0">
          Health
        </h3>
        {onDismiss && !hidden && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Hide this warning until something changes"
            title="Hide until something changes"
            className="ml-auto min-w-[44px] text-sm"
          >
            Hide
          </button>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-12 flex-none place-items-center rounded-full",
            hidden ? "bg-surface-2 text-muted" : BADGE[overall.health],
          )}
        >
          <HealthIcon health={overall.health} />
        </span>
        <p role="status" className="mb-0 grid gap-0.5">
          <span className={cn("text-2xl font-semibold", hidden ? "text-muted" : WORD_COLOR[overall.health])}>
            {WORD[overall.health]}
          </span>
          <span className={hidden ? "text-sm text-muted" : "text-fg-strong"}>
            {hidden ? "Warning hidden until something changes." : overall.headline}
          </span>
        </p>
      </div>
    </section>
  );
}
