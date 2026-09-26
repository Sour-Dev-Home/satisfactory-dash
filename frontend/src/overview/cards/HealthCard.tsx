import type { Ref } from "react";
import { formatTickRate } from "../../format";
import { cn } from "../../lib/cn";
import { TickGauge } from "./TickGauge";
import { WORD, WORD_COLOR, type Shown } from "./words";

export type { Shown };

/** The server tick, from the status snapshot: `null` when no game is running. */
export type Tick = { rate: number; health: "healthy" | "slow" } | null;

/**
 * Our own heart (the owner's call), in the state's colour: filled once there's an answer,
 * outlined while loading or when the warning is hidden. The words beside it carry the meaning.
 */
function Heart({ health, quiet }: { health: Shown; quiet: boolean }) {
  const outlined = quiet || health === "pending";
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="heart"
      data-filled={!outlined}
      className={cn("size-9 flex-none", outlined ? "text-muted" : WORD_COLOR[health])}
      fill={outlined ? "none" : "currentColor"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
    >
      <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" />
    </svg>
  );
}

function TickRow({ tick }: { tick: Tick }) {
  if (tick === null) return <p className="mb-0 text-sm text-muted">Server tick: no game running.</p>;
  const slow = tick.health === "slow";
  return (
    <div className="flex items-end gap-3">
      <TickGauge rate={tick.rate} />
      <p className="mb-0 grid text-sm">
        <span className="text-muted">Server tick</span>
        <span className="text-base font-semibold text-fg-strong">{formatTickRate(tick.rate)}</span>
        <span className={slow ? "font-semibold text-bad" : "text-muted"}>{slow ? "Slow" : "Healthy"}</span>
      </p>
    </div>
  );
}

/**
 * The Health card: the overall answer to "is everything OK?" (health.ts) and the server tick,
 * a small square beside Players (the owner's calls). Only shows what health.ts derived and what
 * the backend classified (tickHealth). A dismissed warning stays in the card, quietly, until
 * something changes.
 */
export function HealthCard({
  overall,
  tick,
  hidden = false,
  onDismiss,
  headingRef,
}: {
  overall: { health: Shown; headline: string };
  /** Left out while the status loads or fails: the card then shows no tick. */
  tick?: Tick;
  /** The operator hid this warning (see canDismiss): shown neutral, without the headline. */
  hidden?: boolean;
  /** Shows the Hide button: "hide until something changes" (a warning only; see canDismiss). */
  onDismiss?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <section
      aria-labelledby="health-heading"
      // Square from md up (its grid column is narrow); on a phone, just as tall as its content.
      className="grid content-start gap-3 rounded-card border border-line bg-surface p-5 md:aspect-square"
    >
      {/* 44 px whether or not Hide shows, like Players' header: the two cards' bodies line up. */}
      <div className="flex min-h-touch items-center gap-3">
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
            className="ml-auto min-w-touch text-sm"
          >
            Hide
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Heart health={overall.health} quiet={hidden} />
        <p role="status" className="mb-0 grid">
          <span className={cn("text-xl font-semibold", hidden ? "text-muted" : WORD_COLOR[overall.health])}>
            {WORD[overall.health]}
          </span>
          <span className={hidden ? "text-sm text-muted" : "text-sm text-fg-strong"}>
            {hidden ? "Warning hidden until something changes." : overall.headline}
          </span>
        </p>
      </div>
      {tick !== undefined && <TickRow tick={tick} />}
    </section>
  );
}
