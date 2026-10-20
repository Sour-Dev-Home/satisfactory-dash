import type { Ref } from "react";
import { formatTickRate } from "../../format";
import { DataAge } from "../../components/DataAge";
import { cn } from "../../lib/cn";
import { Rivets } from "./Rivets";
import { StationTiles, type OverviewSection } from "./StationTiles";
import { tickTone, toneClass } from "./tick";
import { TickGauge } from "./TickGauge";
import { wordColor, wordFor, type Shown } from "./words";

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
      className={cn("size-9 flex-none", outlined ? "text-muted" : wordColor(health))}
      fill={outlined ? "none" : "currentColor"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
    >
      <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" />
    </svg>
  );
}

/** How fresh the status is: its snapshot's time, and whether the backend says it's late. */
export type Age = { observedAt: string; late: boolean };

function TickRow({ tick, age }: { tick: Tick; age?: Age }) {
  // flex-none: beside the status from lg, the gauge keeps its size and the status text wraps instead.
  if (tick === null) return <p className="mb-0 flex-none text-sm text-muted">Server tick: no game running.</p>;
  const slow = tick.health === "slow";
  return (
    <div className="flex flex-none items-end gap-3">
      <TickGauge rate={tick.rate} health={tick.health} />
      <p className="mb-0 grid text-sm">
        <span className="text-muted">Server tick</span>
        <span className="text-base font-semibold text-fg-strong">{formatTickRate(tick.rate)}</span>
        <span className={slow ? cn("font-semibold", toneClass(tickTone(tick))) : "text-muted"}>{slow ? "Slow" : "Healthy"}</span>
        {age && (
          <span className="text-muted">
            <DataAge observedAt={age.observedAt} late={age.late} />
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * The Health card: the one place the overall state is said (#442), with the server tick beside it
 * and Server, Power and Factory as station tiles below (the owner's calls). Only shows what health.ts
 * derived and what the backend classified (tickHealth). A dismissed warning stays in the card,
 * quietly, until something changes.
 */
export function HealthCard({
  overall,
  tick,
  age,
  sections = [],
  hidden = false,
  onDismiss,
  headingRef,
}: {
  overall: { health: Shown; headline: string };
  /** Left out while the status loads or fails: the card then shows no tick. */
  tick?: Tick;
  /** The status snapshot's age, shown with the tick ("Updated 8 s ago"). */
  age?: Age;
  /** Server, Power and Factory, as station tiles. */
  sections?: OverviewSection[];
  /** The operator hid this warning (see canDismiss): shown neutral, without the headline. */
  hidden?: boolean;
  /** Shows the Hide button: "hide until something changes" (a warning only; see canDismiss). */
  onDismiss?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <section
      aria-labelledby="health-heading"
      // Square between md and lg (its grid column is the narrow rail). On a phone, and from lg up where
      // it takes half the row (#329, option A), just as tall as its content: a half-width square would
      // make the whole row about 500 px tall.
      className="relative grid content-start gap-3 rounded-card border border-line bg-surface p-5 md:aspect-square lg:aspect-auto"
    >
      <Rivets />
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
      {/* Stacked in the narrow column; from lg up, where the card takes half the row (#329), the
          status and the tick gauge sit side by side so the card's width isn't left empty (the owner's
          pick, after the ui review). Reading order stays status first. */}
      {/* No wrapping from lg: a long headline wraps inside the status block (min-w-0, flex-1) while the
          gauge keeps its size, so the two never fall onto separate lines at the lg boundary (ui review). */}
      <div className="grid gap-3 lg:flex lg:items-center lg:justify-between lg:gap-4">
        <div className="flex min-w-0 items-center gap-3 lg:flex-1">
          <Heart health={overall.health} quiet={hidden} />
          <p role="status" className="mb-0 grid">
            <span
              data-statement=""
              className={cn(
                "font-display text-4xl leading-none font-bold tracking-wide uppercase",
                hidden ? "text-muted" : wordColor(overall.health),
              )}
            >
              {wordFor(overall.health)}
            </span>
            <span className={hidden ? "text-sm text-muted" : "text-sm text-fg-strong"}>
              {hidden ? "Warning hidden until something changes." : overall.headline}
            </span>
          </p>
        </div>
        {tick !== undefined && <TickRow tick={tick} age={age} />}
      </div>
      <StationTiles sections={sections} />
    </section>
  );
}
