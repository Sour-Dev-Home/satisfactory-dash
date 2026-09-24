import { Link } from "react-router";
import { cn } from "../lib/cn";
import { CardGrid } from "./cards/CardGrid";
import { HealthCard, type Shown } from "./cards/HealthCard";
import type { SectionState } from "./health";

export interface OverviewSection {
  name: string;
  /** The section's own page, when it has one. */
  to?: string;
  state: SectionState;
}

const WORD: Record<Shown, string> = {
  ok: "Operational",
  paused: "Paused",
  degraded: "Degraded",
  unavailable: "Unavailable",
  outage: "Outage",
  pending: "Checking…",
};

const WORD_COLOR: Record<Shown, string> = {
  ok: "text-ok",
  paused: "text-info",
  degraded: "text-warn",
  unavailable: "text-muted",
  outage: "text-bad",
  pending: "text-muted",
};

function shown(state: SectionState): { health: Shown; summary: string } {
  if (state === "pending") return { health: "pending", summary: "Loading…" };
  if (state === "error") return { health: "unavailable", summary: "Couldn't load this section" };
  return state;
}

/** Direction B2: the cards (Health first: "is everything OK?"), then one row per section. */
export function OverviewPanel({
  overall,
  sections,
  bannerHidden = false,
  onDismiss,
}: {
  overall: { health: Shown; headline: string };
  sections: OverviewSection[];
  /** The operator dismissed this banner (a warning only; see canDismiss). */
  bannerHidden?: boolean;
  /** Shows the × when given: "hide until something changes". */
  onDismiss?: () => void;
}) {
  return (
    <section aria-labelledby="overview-heading" className="grid gap-4">
      {/* tabIndex -1: the shell moves focus here after navigation (Shell.tsx). */}
      <h2 id="overview-heading" tabIndex={-1} className="sr-only">
        Overview
      </h2>
      {/* Rendered only with a card in it: an empty grid would still add a gap. */}
      {!bannerHidden && (
        <CardGrid>
          <HealthCard overall={overall} onDismiss={onDismiss} />
        </CardGrid>
      )}
      <ul aria-label="Sections" className="divide-y divide-line rounded-card border border-line bg-surface">
        {sections.map((section) => {
          const { health, summary } = shown(section.state);
          const body = (
            <>
              <span className="grid min-w-0 gap-0.5">
                <span className="font-semibold text-fg-strong">{section.name}</span>
                <span className="text-sm text-muted">{summary}</span>
              </span>
              <span className={cn("ml-auto flex flex-none items-center gap-2 text-sm font-medium", WORD_COLOR[health])}>
                <span aria-hidden="true" className="size-2 rounded-full bg-current" />
                {WORD[health]}
              </span>
            </>
          );
          const row = "flex min-h-[44px] items-center gap-4 px-5 py-4";
          return (
            <li key={section.name}>
              {section.to ? (
                <Link to={section.to} className={cn(row, "text-inherit no-underline hover:bg-surface-2")}>
                  {body}
                </Link>
              ) : (
                <div className={row}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
